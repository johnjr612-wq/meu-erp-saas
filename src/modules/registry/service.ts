import "server-only";
import { writeAudit } from "@/lib/audit";
import type { TenantDb, TenantTx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import type { OrgContext } from "@/lib/session";
import type { ProductType, UnitOfMeasure } from "@/generated/prisma/enums";

/** Campos opcionais vazios no formulário chegam como undefined; no update viram null (limpar o campo). */
function nullify<T extends Record<string, unknown>>(obj: T, keys: (keyof T)[]) {
  const out: Record<string, unknown> = { ...obj };
  for (const k of keys) out[k as string] = obj[k] ?? null;
  return out;
}

const OPEN_ENTRY = { status: { in: ["OPEN", "PARTIAL"] as ("OPEN" | "PARTIAL")[] } };

// -----------------------------------------------------------------------------
// Produtos
// -----------------------------------------------------------------------------

export type ProductUpdate = {
  id: string;
  sku: string;
  name: string;
  type: ProductType;
  unit: UnitOfMeasure;
  priceCents: number;
  minStock: string;
};

async function productUsedInFormulas(tx: TenantTx, productId: string) {
  const [asOutput, asComponent] = await Promise.all([
    tx.formula.count({ where: { productId } }),
    tx.formulaItem.count({ where: { componentId: productId, formula: { deletedAt: null } } }),
  ]);
  return asOutput + asComponent > 0;
}

export async function updateProduct(db: TenantDb, ctx: OrgContext, input: ProductUpdate) {
  await db.$transaction(async (tx) => {
    const before = await tx.product.findFirst({ where: { id: input.id } });
    if (!before) throw new DomainError("Produto não encontrado.");

    if (input.sku !== before.sku && (await tx.product.findFirst({ where: { sku: input.sku }, select: { id: true } }))) {
      throw new DomainError(`O SKU ${input.sku} já está em uso.`);
    }
    if (input.unit !== before.unit && (await tx.stockMovement.count({ where: { productId: before.id } })) > 0) {
      throw new DomainError("A unidade não pode mudar depois que o produto teve movimentação de estoque.");
    }
    if (input.type !== before.type && (await productUsedInFormulas(tx, before.id))) {
      throw new DomainError("O tipo não pode mudar enquanto o produto estiver em uma fórmula.");
    }

    const { id, ...data } = input;
    const after = await tx.product.update({ where: { id }, data: { ...data, updatedBy: ctx.userId } });
    await writeAudit(tx, ctx, { entity: "Product", entityId: id, action: "UPDATE", before, after });
  });
}

export async function deleteProduct(db: TenantDb, ctx: OrgContext, id: string) {
  await db.$transaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id } });
    if (!product) throw new DomainError("Produto não encontrado.");
    if (!product.stockQuantity.isZero()) {
      throw new DomainError("Zere o estoque (ajuste) antes de excluir o produto.");
    }
    if (await productUsedInFormulas(tx, id)) {
      throw new DomainError("O produto está em uma fórmula. Remova-o da fórmula antes de excluir.");
    }
    const [openQuotes, plannedOrders] = await Promise.all([
      tx.salesOrderItem.count({ where: { productId: id, salesOrder: { status: "QUOTE", deletedAt: null } } }),
      tx.productionOrder.count({ where: { productId: id, status: "PLANNED" } }),
    ]);
    if (openQuotes > 0) throw new DomainError("O produto está em orçamentos em aberto.");
    if (plannedOrders > 0) throw new DomainError("O produto tem ordens de produção planejadas.");

    // Libera o SKU para reuso: o índice único (organização + SKU) inclui registros excluídos.
    const freedSku = `${product.sku}~${Date.now().toString(36)}`;
    await tx.product.update({
      where: { id },
      data: { sku: freedSku, deletedAt: new Date(), deletedBy: ctx.userId, updatedBy: ctx.userId },
    });
    await writeAudit(tx, ctx, { entity: "Product", entityId: id, action: "SOFT_DELETE", before: product });
  });
}

// -----------------------------------------------------------------------------
// Clientes e fornecedores
// -----------------------------------------------------------------------------

export type CustomerUpdate = {
  id: string;
  name: string;
  document?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
};

export async function updateCustomer(db: TenantDb, ctx: OrgContext, input: CustomerUpdate) {
  await db.$transaction(async (tx) => {
    const before = await tx.customer.findFirst({ where: { id: input.id } });
    if (!before) throw new DomainError("Cliente não encontrado.");
    const { id, ...rest } = input;
    const data = nullify(rest, ["document", "email", "phone", "address", "city", "state", "zipCode"]);
    const after = await tx.customer.update({ where: { id }, data: { ...data, updatedBy: ctx.userId } });
    await writeAudit(tx, ctx, { entity: "Customer", entityId: id, action: "UPDATE", before, after });
  });
}

export async function deleteCustomer(db: TenantDb, ctx: OrgContext, id: string) {
  await db.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id } });
    if (!customer) throw new DomainError("Cliente não encontrado.");
    const [openEntries, openQuotes] = await Promise.all([
      tx.financialEntry.count({ where: { customerId: id, ...OPEN_ENTRY } }),
      tx.salesOrder.count({ where: { customerId: id, status: "QUOTE" } }),
    ]);
    if (openEntries > 0) throw new DomainError("O cliente tem contas a receber em aberto.");
    if (openQuotes > 0) throw new DomainError("O cliente tem orçamentos em aberto.");

    await tx.customer.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: ctx.userId, updatedBy: ctx.userId },
    });
    await writeAudit(tx, ctx, { entity: "Customer", entityId: id, action: "SOFT_DELETE", before: customer });
  });
}

export type SupplierUpdate = { id: string; name: string; document?: string; email?: string; phone?: string };

export async function updateSupplier(db: TenantDb, ctx: OrgContext, input: SupplierUpdate) {
  await db.$transaction(async (tx) => {
    const before = await tx.supplier.findFirst({ where: { id: input.id } });
    if (!before) throw new DomainError("Fornecedor não encontrado.");
    const { id, ...rest } = input;
    const data = nullify(rest, ["document", "email", "phone"]);
    const after = await tx.supplier.update({ where: { id }, data: { ...data, updatedBy: ctx.userId } });
    await writeAudit(tx, ctx, { entity: "Supplier", entityId: id, action: "UPDATE", before, after });
  });
}

export async function deleteSupplier(db: TenantDb, ctx: OrgContext, id: string) {
  await db.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id } });
    if (!supplier) throw new DomainError("Fornecedor não encontrado.");
    if ((await tx.financialEntry.count({ where: { supplierId: id, ...OPEN_ENTRY } })) > 0) {
      throw new DomainError("O fornecedor tem contas a pagar em aberto.");
    }
    await tx.supplier.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: ctx.userId, updatedBy: ctx.userId },
    });
    await writeAudit(tx, ctx, { entity: "Supplier", entityId: id, action: "SOFT_DELETE", before: supplier });
  });
}
