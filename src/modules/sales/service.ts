import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/lib/audit";
import type { TenantDb } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import type { OrgContext } from "@/lib/session";
import { assertPlanLimit } from "@/modules/billing/service";
import { createEntryTx } from "@/modules/financial/service";
import { registerStockMovement } from "@/modules/inventory/service";

const Decimal = Prisma.Decimal;

/**
 * Cria um orçamento. Os preços SEMPRE vêm do cadastro do produto (nunca do cliente).
 */
export async function createSalesOrder(
  db: TenantDb,
  ctx: OrgContext,
  input: { customerId: string; discountCents: number; notes?: string; items: { productId: string; quantity: string }[] },
) {
  return db.$transaction(async (tx) => {
    await assertPlanLimit(tx, ctx, "salesOrdersPerMonth");

    const customer = await tx.customer.findFirst({ where: { id: input.customerId }, select: { id: true } });
    if (!customer) throw new DomainError("Cliente não encontrado.");

    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, type: "FINISHED_GOOD" },
      select: { id: true, priceCents: true },
    });
    const priceById = new Map(products.map((p) => [p.id, p.priceCents]));

    const items = input.items.map((item) => {
      const unitPriceCents = priceById.get(item.productId);
      if (unitPriceCents === undefined) throw new DomainError("Produto inválido no pedido.");
      const totalCents = new Decimal(item.quantity)
        .mul(unitPriceCents)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toNumber();
      return {
        organizationId: ctx.organizationId, // escrita aninhada: tenant explícito
        productId: item.productId,
        quantity: item.quantity,
        unitPriceCents,
        totalCents,
      };
    });

    const subtotalCents = items.reduce((sum, i) => sum + i.totalCents, 0);
    if (input.discountCents > subtotalCents) throw new DomainError("Desconto maior que o subtotal.");

    const last = await tx.salesOrder.aggregate({ _max: { number: true } });
    return tx.salesOrder.create({
      data: {
        organizationId: ctx.organizationId,
        number: (last._max.number ?? 0) + 1,
        customerId: customer.id,
        notes: input.notes,
        subtotalCents,
        discountCents: input.discountCents,
        totalCents: subtotalCents - input.discountCents,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
        items: { create: items },
      },
    });
  });
}

/** Confirma o pedido: baixa o estoque e gera a conta a receber, tudo atômico. */
export async function confirmSalesOrder(db: TenantDb, ctx: OrgContext, salesOrderId: string, dueDate: Date) {
  return db.$transaction(async (tx) => {
    const order = await tx.salesOrder.findFirst({ where: { id: salesOrderId }, include: { items: true } });
    if (!order) throw new DomainError("Pedido não encontrado.");
    if (order.status !== "QUOTE") throw new DomainError("Somente orçamentos podem ser confirmados.");

    for (const item of order.items) {
      await registerStockMovement(tx, ctx, {
        productId: item.productId,
        type: "OUT",
        quantity: item.quantity.toString(),
        reason: `Venda pedido #${order.number}`,
        referenceType: "SalesOrder",
        referenceId: order.id,
      });
    }

    if (order.totalCents > 0) {
      await createEntryTx(tx, ctx, {
        type: "RECEIVABLE",
        description: `Pedido de venda #${order.number}`,
        category: "Vendas",
        amountCents: order.totalCents,
        dueDate,
        customerId: order.customerId,
        salesOrderId: order.id,
      });
    }

    const updated = await tx.salesOrder.update({
      where: { id: order.id },
      data: { status: "CONFIRMED", confirmedAt: new Date(), updatedBy: ctx.userId },
    });
    await writeAudit(tx, ctx, { entity: "SalesOrder", entityId: order.id, action: "CONFIRM", before: order, after: updated });
    return updated;
  });
}

/** Cancela um orçamento (soft delete). Pedidos confirmados exigem devolução/estorno. */
export async function cancelSalesOrder(db: TenantDb, ctx: OrgContext, salesOrderId: string) {
  return db.$transaction(async (tx) => {
    const order = await tx.salesOrder.findFirst({ where: { id: salesOrderId } });
    if (!order) throw new DomainError("Pedido não encontrado.");
    if (order.status !== "QUOTE") {
      throw new DomainError("Pedidos confirmados não podem ser cancelados diretamente.");
    }
    const updated = await tx.salesOrder.update({
      where: { id: order.id },
      data: { status: "CANCELED", deletedAt: new Date(), deletedBy: ctx.userId, updatedBy: ctx.userId },
    });
    await writeAudit(tx, ctx, { entity: "SalesOrder", entityId: order.id, action: "SOFT_DELETE", before: order, after: updated });
  });
}
