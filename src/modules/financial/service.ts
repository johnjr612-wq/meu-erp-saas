import "server-only";
import type { FinancialEntryStatus, PaymentMethod } from "@/generated/prisma/enums";
import { writeAudit } from "@/lib/audit";
import type { TenantDb, TenantTx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import type { OrgContext } from "@/lib/session";

function statusFor(amountCents: number, paidAmountCents: number): FinancialEntryStatus {
  if (paidAmountCents <= 0) return "OPEN";
  if (paidAmountCents >= amountCents) return "PAID";
  return "PARTIAL";
}

export type CreateEntryInput = {
  type: "RECEIVABLE" | "PAYABLE";
  description: string;
  category?: string;
  amountCents: number;
  dueDate: Date;
  customerId?: string;
  supplierId?: string;
  salesOrderId?: string;
  documentNumber?: string;
};

/** Cria título dentro de uma transação existente (usado também por Vendas). */
export async function createEntryTx(tx: TenantTx, ctx: OrgContext, input: CreateEntryInput) {
  if (input.type === "RECEIVABLE" && input.supplierId) {
    throw new DomainError("Conta a receber não pode ter fornecedor.");
  }
  if (input.type === "PAYABLE" && input.customerId) {
    throw new DomainError("Conta a pagar não pode ter cliente.");
  }
  // Garante que cliente/fornecedor pertencem ao tenant (o client já filtra por org).
  if (input.customerId && !(await tx.customer.findFirst({ where: { id: input.customerId }, select: { id: true } }))) {
    throw new DomainError("Cliente não encontrado.");
  }
  if (input.supplierId && !(await tx.supplier.findFirst({ where: { id: input.supplierId }, select: { id: true } }))) {
    throw new DomainError("Fornecedor não encontrado.");
  }

  const entry = await tx.financialEntry.create({
    data: {
      organizationId: ctx.organizationId,
      ...input,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    },
  });
  await writeAudit(tx, ctx, { entity: "FinancialEntry", entityId: entry.id, action: "CREATE", after: entry });
  return entry;
}

export function createEntry(db: TenantDb, ctx: OrgContext, input: CreateEntryInput) {
  return db.$transaction((tx) => createEntryTx(tx, ctx, input));
}

/** Baixa total ou parcial de um título. */
export async function settleEntry(
  db: TenantDb,
  ctx: OrgContext,
  input: {
    entryId: string;
    bankAccountId: string;
    amountCents: number;
    method: PaymentMethod;
    paidAt: Date;
    externalId?: string;
  },
) {
  return db.$transaction(async (tx) => {
    const entry = await tx.financialEntry.findFirst({ where: { id: input.entryId } });
    if (!entry) throw new DomainError("Título não encontrado.");
    if (entry.status === "PAID" || entry.status === "CANCELED") {
      throw new DomainError("Título já quitado ou cancelado.");
    }

    const remaining = entry.amountCents - entry.paidAmountCents;
    if (input.amountCents > remaining) {
      throw new DomainError("Valor da baixa maior que o saldo em aberto.");
    }

    const bank = await tx.bankAccount.findFirst({ where: { id: input.bankAccountId }, select: { id: true } });
    if (!bank) throw new DomainError("Conta bancária não encontrada.");

    const payment = await tx.financialPayment.create({
      data: {
        organizationId: ctx.organizationId,
        entryId: entry.id,
        bankAccountId: bank.id,
        amountCents: input.amountCents,
        method: input.method,
        paidAt: input.paidAt,
        externalId: input.externalId,
        createdBy: ctx.userId,
      },
    });

    const paidAmountCents = entry.paidAmountCents + input.amountCents;
    const status = statusFor(entry.amountCents, paidAmountCents);
    const updated = await tx.financialEntry.update({
      where: { id: entry.id },
      data: {
        paidAmountCents,
        status,
        paidAt: status === "PAID" ? input.paidAt : null,
        updatedBy: ctx.userId,
      },
    });

    await writeAudit(tx, ctx, {
      entity: "FinancialEntry",
      entityId: entry.id,
      action: "SETTLE",
      before: entry,
      after: { ...updated, paymentId: payment.id },
    });
    return payment;
  });
}

/** Estorna uma baixa (sem deletar): marca reversedAt e recalcula o título. */
export async function reversePayment(db: TenantDb, ctx: OrgContext, paymentId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const payment = await tx.financialPayment.findFirst({ where: { id: paymentId } });
    if (!payment) throw new DomainError("Baixa não encontrada.");
    if (payment.reversedAt) throw new DomainError("Baixa já estornada.");

    const entry = await tx.financialEntry.findFirst({ where: { id: payment.entryId } });
    if (!entry) throw new DomainError("Título não encontrado.");
    if (entry.status === "CANCELED") throw new DomainError("Título cancelado.");

    await tx.financialPayment.update({
      where: { id: payment.id },
      data: { reversedAt: new Date(), reversedBy: ctx.userId, reversalReason: reason },
    });

    const paidAmountCents = entry.paidAmountCents - payment.amountCents;
    const updated = await tx.financialEntry.update({
      where: { id: entry.id },
      data: {
        paidAmountCents,
        status: statusFor(entry.amountCents, paidAmountCents),
        paidAt: null,
        updatedBy: ctx.userId,
      },
    });

    await writeAudit(tx, ctx, {
      entity: "FinancialPayment",
      entityId: payment.id,
      action: "REVERSE",
      before: payment,
      after: { reason, entry: updated },
    });
  });
}

/** Cancelamento = soft delete. Só títulos sem baixas ativas. */
export async function cancelEntry(db: TenantDb, ctx: OrgContext, entryId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const entry = await tx.financialEntry.findFirst({ where: { id: entryId } });
    if (!entry) throw new DomainError("Título não encontrado.");
    if (entry.paidAmountCents > 0) {
      throw new DomainError("Estorne as baixas antes de cancelar o título.");
    }

    const now = new Date();
    const updated = await tx.financialEntry.update({
      where: { id: entry.id },
      data: { status: "CANCELED", deletedAt: now, deletedBy: ctx.userId, updatedBy: ctx.userId },
    });
    await writeAudit(tx, ctx, {
      entity: "FinancialEntry",
      entityId: entry.id,
      action: "SOFT_DELETE",
      before: entry,
      after: { ...updated, reason },
    });
  });
}

/** Conciliação: vincula a baixa a uma transação do extrato/gateway. */
export async function reconcilePayment(db: TenantDb, ctx: OrgContext, paymentId: string, externalId: string) {
  return db.$transaction(async (tx) => {
    const payment = await tx.financialPayment.findFirst({ where: { id: paymentId } });
    if (!payment) throw new DomainError("Baixa não encontrada.");
    if (payment.reversedAt) throw new DomainError("Baixa estornada não pode ser conciliada.");
    if (payment.reconciledAt) throw new DomainError("Baixa já conciliada.");

    const updated = await tx.financialPayment.update({
      where: { id: payment.id },
      data: { externalId, reconciledAt: new Date(), reconciledBy: ctx.userId },
    });
    await writeAudit(tx, ctx, {
      entity: "FinancialPayment",
      entityId: payment.id,
      action: "RECONCILE",
      before: payment,
      after: updated,
    });
  });
}

/** Saldo atual de cada conta = saldo inicial + recebimentos − pagamentos (baixas não estornadas). */
export async function getBankBalances(db: TenantDb) {
  const [accounts, sums] = await Promise.all([
    db.bankAccount.findMany({ orderBy: { name: "asc" } }),
    db.financialPayment.groupBy({
      by: ["bankAccountId"],
      where: { reversedAt: null, entry: { type: "RECEIVABLE" } },
      _sum: { amountCents: true },
    }),
  ]);
  const outflows = await db.financialPayment.groupBy({
    by: ["bankAccountId"],
    where: { reversedAt: null, entry: { type: "PAYABLE" } },
    _sum: { amountCents: true },
  });

  const inMap = new Map(sums.map((s) => [s.bankAccountId, s._sum.amountCents ?? 0]));
  const outMap = new Map(outflows.map((s) => [s.bankAccountId, s._sum.amountCents ?? 0]));
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    balanceCents: a.openingBalanceCents + (inMap.get(a.id) ?? 0) - (outMap.get(a.id) ?? 0),
  }));
}
