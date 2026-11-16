import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { StockMovementType } from "@/generated/prisma/enums";
import type { TenantDb, TenantTx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import type { OrgContext } from "@/lib/session";

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

const INBOUND: StockMovementType[] = ["IN", "PRODUCTION_IN"];
const OUTBOUND: StockMovementType[] = ["OUT", "PRODUCTION_OUT"];

export type MovementInput = {
  productId: string;
  type: StockMovementType;
  /** Quantidade em string decimal. Em IN/OUT é o módulo; em ADJUSTMENT, com sinal. */
  quantity: string;
  unitCostCents?: number;
  lot?: string;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  /** Permite saldo negativo (padrão: false). */
  allowNegative?: boolean;
};

function signedQuantity(type: StockMovementType, quantity: string): Decimal {
  const q = new Decimal(quantity);
  if (type === "ADJUSTMENT") {
    if (q.isZero()) throw new DomainError("Ajuste não pode ser zero.");
    return q;
  }
  if (q.lte(0)) throw new DomainError("Quantidade deve ser positiva.");
  if (INBOUND.includes(type)) return q;
  if (OUTBOUND.includes(type)) return q.negated();
  throw new DomainError(`Tipo de movimentação inválido: ${type}`);
}

/**
 * ÚNICA forma de alterar saldo de estoque. Deve rodar dentro de uma transação.
 * Usa incremento atômico no banco (sem read-modify-write) e grava o ledger.
 * Entradas com custo recalculam o custo médio ponderado do produto.
 */
export async function registerStockMovement(tx: TenantTx, ctx: OrgContext, input: MovementInput) {
  const delta = signedQuantity(input.type, input.quantity);

  const before = await tx.product.findUnique({
    where: { id: input.productId },
    select: { stockQuantity: true, costCents: true },
  });
  if (!before) throw new DomainError("Produto não encontrado.");

  const updated = await tx.product.update({
    where: { id: input.productId },
    data: { stockQuantity: { increment: delta }, updatedBy: ctx.userId },
    select: { id: true, name: true, stockQuantity: true },
  });

  if (updated.stockQuantity.lt(0) && !input.allowNegative) {
    // lançar erro faz a transação inteira ser revertida
    const available = updated.stockQuantity.minus(delta);
    throw new DomainError(
      `Estoque insuficiente para "${updated.name}": necessário ${delta.abs().toString()}, disponível ${available.toString()}.`,
    );
  }

  // Custo médio ponderado em entradas com custo informado.
  if (delta.gt(0) && input.unitCostCents !== undefined && updated.stockQuantity.gt(0)) {
    const previousQty = Decimal.max(before.stockQuantity, 0);
    const totalValue = previousQty.mul(before.costCents).add(delta.mul(input.unitCostCents));
    const avgCost = totalValue.div(previousQty.add(delta)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    await tx.product.update({
      where: { id: input.productId },
      data: { costCents: avgCost.toNumber() },
    });
  }

  return tx.stockMovement.create({
    data: {
      organizationId: ctx.organizationId,
      productId: input.productId,
      type: input.type,
      quantity: delta,
      balanceAfter: updated.stockQuantity,
      unitCostCents: input.unitCostCents,
      lot: input.lot,
      reason: input.reason,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      createdBy: ctx.userId,
    },
  });
}

export async function createFormula(
  db: TenantDb,
  ctx: OrgContext,
  input: {
    productId: string;
    name: string;
    yieldQuantity: string;
    instructions?: string;
    items: { componentId: string; quantity: string }[];
  },
) {
  return db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: input.productId, type: "FINISHED_GOOD" },
      select: { id: true },
    });
    if (!product) throw new DomainError("Produto acabado não encontrado.");

    const componentIds = [...new Set(input.items.map((i) => i.componentId))];
    if (componentIds.length !== input.items.length) throw new DomainError("Insumo repetido na fórmula.");
    if (componentIds.includes(product.id)) throw new DomainError("O produto não pode ser insumo de si mesmo.");
    const found = await tx.product.count({ where: { id: { in: componentIds }, type: { not: "FINISHED_GOOD" } } });
    if (found !== componentIds.length) throw new DomainError("Insumo inválido na fórmula.");

    return tx.formula.create({
      data: {
        organizationId: ctx.organizationId,
        productId: product.id,
        name: input.name,
        yieldQuantity: input.yieldQuantity,
        instructions: input.instructions,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
        // escrita aninhada: tenant explícito
        items: {
          create: input.items.map((i) => ({
            organizationId: ctx.organizationId,
            componentId: i.componentId,
            quantity: i.quantity,
          })),
        },
      },
    });
  });
}

export async function createProductionOrder(
  db: TenantDb,
  ctx: OrgContext,
  input: { formulaId: string; quantity: string; lot: string; expiresAt?: Date },
) {
  return db.$transaction(async (tx) => {
    const formula = await tx.formula.findFirst({
      where: { id: input.formulaId },
      select: { id: true, productId: true },
    });
    if (!formula) throw new DomainError("Fórmula não encontrada.");

    const last = await tx.productionOrder.aggregate({ _max: { number: true } });
    return tx.productionOrder.create({
      data: {
        organizationId: ctx.organizationId,
        number: (last._max.number ?? 0) + 1,
        formulaId: formula.id,
        productId: formula.productId,
        quantity: input.quantity,
        lot: input.lot,
        expiresAt: input.expiresAt,
        createdBy: ctx.userId,
      },
    });
  });
}

/**
 * Conclui uma ordem de produção: consome os insumos proporcionalmente à
 * fórmula (PRODUCTION_OUT) e dá entrada no produto acabado (PRODUCTION_IN)
 * com custo = soma do custo dos insumos / quantidade produzida.
 */
export async function completeProductionOrder(db: TenantDb, ctx: OrgContext, productionOrderId: string) {
  return db.$transaction(async (tx) => {
    const order = await tx.productionOrder.findFirst({
      where: { id: productionOrderId },
      include: {
        formula: { include: { items: { include: { component: true } } } },
      },
    });
    if (!order) throw new DomainError("Ordem de produção não encontrada.");
    if (order.status !== "PLANNED") throw new DomainError("Somente ordens planejadas podem ser concluídas.");
    if (order.formula.items.length === 0) throw new DomainError("A fórmula não possui insumos.");

    const factor = order.quantity.div(order.formula.yieldQuantity);
    let totalCostCents = new Decimal(0);

    for (const item of order.formula.items) {
      const consumed = item.quantity.mul(factor).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
      totalCostCents = totalCostCents.add(consumed.mul(item.component.costCents));
      await registerStockMovement(tx, ctx, {
        productId: item.componentId,
        type: "PRODUCTION_OUT",
        quantity: consumed.toString(),
        lot: order.lot,
        reason: `Consumo OP #${order.number}`,
        referenceType: "ProductionOrder",
        referenceId: order.id,
      });
    }

    const unitCostCents = totalCostCents.div(order.quantity).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    await registerStockMovement(tx, ctx, {
      productId: order.productId,
      type: "PRODUCTION_IN",
      quantity: order.quantity.toString(),
      unitCostCents,
      lot: order.lot,
      reason: `Produção OP #${order.number}`,
      referenceType: "ProductionOrder",
      referenceId: order.id,
    });

    return tx.productionOrder.update({
      where: { id: order.id },
      data: { status: "COMPLETED", completedAt: new Date(), updatedBy: ctx.userId },
    });
  });
}
