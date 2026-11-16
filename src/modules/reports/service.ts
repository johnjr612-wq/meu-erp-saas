import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { TenantDb } from "@/lib/db";

/**
 * Relatórios. Datas tratadas em dias UTC (YYYY-MM-DD), o mesmo critério dos
 * campos de data do sistema (vencimento, data de pagamento informada).
 */

export type Period = { from: string; to: string }; // YYYY-MM-DD, inclusivo

const DAY = 24 * 60 * 60 * 1000;
export const toDay = (d: Date) => d.toISOString().slice(0, 10);
const startOf = (day: string) => new Date(`${day}T00:00:00Z`);
const endExclusive = (day: string) => new Date(startOf(day).getTime() + DAY);

// -----------------------------------------------------------------------------
// Fluxo de caixa
// -----------------------------------------------------------------------------

export type CashFlowRow = {
  day: string;
  inCents: number; // recebido (realizado)
  outCents: number; // pago (realizado)
  expectedInCents: number; // a receber em aberto com vencimento no dia
  expectedOutCents: number; // a pagar em aberto com vencimento no dia
  balanceCents: number; // saldo realizado acumulado ao fim do dia
  projectedBalanceCents: number; // saldo realizado + previsto acumulado
};

export async function getCashFlow(db: TenantDb, period: Period, today: string = toDay(new Date())) {
  const from = startOf(period.from);
  const to = endExclusive(period.to);

  const [accounts, paymentsBefore, payments, openEntries, overdue] = await Promise.all([
    db.bankAccount.aggregate({ _sum: { openingBalanceCents: true } }),
    // tudo o que entrou/saiu antes do período forma o saldo inicial
    db.financialPayment.findMany({
      where: { reversedAt: null, paidAt: { lt: from } },
      select: { amountCents: true, entry: { select: { type: true } } },
    }),
    db.financialPayment.findMany({
      where: { reversedAt: null, paidAt: { gte: from, lt: to } },
      select: { amountCents: true, paidAt: true, entry: { select: { type: true } } },
    }),
    db.financialEntry.findMany({
      where: { status: { in: ["OPEN", "PARTIAL"] }, dueDate: { gte: from, lt: to } },
      select: { type: true, amountCents: true, paidAmountCents: true, dueDate: true },
    }),
    // vencidos antes do período (ou antes de hoje) e ainda em aberto
    db.financialEntry.groupBy({
      by: ["type"],
      where: {
        status: { in: ["OPEN", "PARTIAL"] },
        dueDate: { lt: from < startOf(today) ? from : startOf(today) },
      },
      _sum: { amountCents: true, paidAmountCents: true },
      _count: true,
    }),
  ]);

  const signed = (type: string, cents: number) => (type === "RECEIVABLE" ? cents : -cents);
  const openingBalanceCents =
    (accounts._sum.openingBalanceCents ?? 0) +
    paymentsBefore.reduce((sum, p) => sum + signed(p.entry.type, p.amountCents), 0);

  const byDay = new Map<string, Omit<CashFlowRow, "balanceCents" | "projectedBalanceCents">>();
  const row = (day: string) => {
    let r = byDay.get(day);
    if (!r) {
      r = { day, inCents: 0, outCents: 0, expectedInCents: 0, expectedOutCents: 0 };
      byDay.set(day, r);
    }
    return r;
  };
  for (const p of payments) {
    const r = row(toDay(p.paidAt));
    if (p.entry.type === "RECEIVABLE") r.inCents += p.amountCents;
    else r.outCents += p.amountCents;
  }
  for (const e of openEntries) {
    const r = row(toDay(e.dueDate));
    const remaining = e.amountCents - e.paidAmountCents;
    if (e.type === "RECEIVABLE") r.expectedInCents += remaining;
    else r.expectedOutCents += remaining;
  }

  let balance = openingBalanceCents;
  let projected = openingBalanceCents;
  const rows: CashFlowRow[] = [...byDay.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((r) => {
      balance += r.inCents - r.outCents;
      projected += r.inCents - r.outCents + r.expectedInCents - r.expectedOutCents;
      return { ...r, balanceCents: balance, projectedBalanceCents: projected };
    });

  const sum = (k: keyof Omit<CashFlowRow, "day">) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const overdueOf = (type: "RECEIVABLE" | "PAYABLE") => {
    const g = overdue.find((o) => o.type === type);
    return {
      count: g?._count ?? 0,
      cents: (g?._sum.amountCents ?? 0) - (g?._sum.paidAmountCents ?? 0),
    };
  };

  return {
    openingBalanceCents,
    rows,
    totals: {
      inCents: sum("inCents"),
      outCents: sum("outCents"),
      expectedInCents: sum("expectedInCents"),
      expectedOutCents: sum("expectedOutCents"),
      closingBalanceCents: balance,
      projectedClosingCents: projected,
    },
    overdue: { receivable: overdueOf("RECEIVABLE"), payable: overdueOf("PAYABLE") },
  };
}

// -----------------------------------------------------------------------------
// Vendas por cliente e por produto
// -----------------------------------------------------------------------------

export async function getSalesReport(db: TenantDb, period: Period) {
  const confirmedInPeriod = {
    status: "CONFIRMED" as const,
    confirmedAt: { gte: startOf(period.from), lt: endExclusive(period.to) },
  };

  const [totals, byCustomerRaw, byProductRaw] = await Promise.all([
    db.salesOrder.aggregate({
      where: confirmedInPeriod,
      _sum: { subtotalCents: true, discountCents: true, totalCents: true },
      _count: true,
    }),
    db.salesOrder.groupBy({
      by: ["customerId"],
      where: confirmedInPeriod,
      _sum: { totalCents: true },
      _count: true,
    }),
    db.salesOrderItem.groupBy({
      by: ["productId"],
      where: { salesOrder: confirmedInPeriod },
      _sum: { quantity: true, totalCents: true },
      _count: true,
    }),
  ]);

  // nomes: inclui cadastros já excluídos (soft delete), pois aparecem no histórico
  const [customers, products] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: byCustomerRaw.map((c) => c.customerId) }, deletedAt: undefined },
      select: { id: true, name: true },
    }),
    db.product.findMany({
      where: { id: { in: byProductRaw.map((p) => p.productId) }, deletedAt: undefined },
      select: { id: true, name: true, sku: true, unit: true },
    }),
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const productInfo = new Map(products.map((p) => [p.id, p]));

  const netCents = totals._sum.totalCents ?? 0;
  const byCustomer = byCustomerRaw
    .map((c) => ({
      customerId: c.customerId,
      name: customerName.get(c.customerId) ?? "—",
      orders: c._count,
      totalCents: c._sum.totalCents ?? 0,
      sharePct: netCents ? ((c._sum.totalCents ?? 0) / netCents) * 100 : 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents);

  const grossItemsCents = byProductRaw.reduce((s, p) => s + (p._sum.totalCents ?? 0), 0);
  const byProduct = byProductRaw
    .map((p) => {
      const info = productInfo.get(p.productId);
      return {
        productId: p.productId,
        name: info?.name ?? "—",
        sku: info?.sku ?? "",
        unit: info?.unit ?? "",
        quantity: p._sum.quantity ?? new Prisma.Decimal(0),
        orders: p._count,
        grossCents: p._sum.totalCents ?? 0,
        sharePct: grossItemsCents ? ((p._sum.totalCents ?? 0) / grossItemsCents) * 100 : 0,
      };
    })
    .sort((a, b) => b.grossCents - a.grossCents);

  return {
    totals: {
      orders: totals._count,
      grossCents: totals._sum.subtotalCents ?? 0,
      discountCents: totals._sum.discountCents ?? 0,
      netCents,
      averageTicketCents: totals._count ? Math.round(netCents / totals._count) : 0,
    },
    byCustomer,
    byProduct,
  };
}

// -----------------------------------------------------------------------------
// Período (querystring)
// -----------------------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lê ?de=&ate= com padrão no mês corrente. Limita a 366 dias. */
export function parsePeriod(de: string | undefined, ate: string | undefined, now: Date = new Date()): Period {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  let from = de && DAY_RE.test(de) && !isNaN(startOf(de).getTime()) ? de : toDay(first);
  let to = ate && DAY_RE.test(ate) && !isNaN(startOf(ate).getTime()) ? ate : toDay(last);
  if (from > to) [from, to] = [to, from];
  // até 366 dias contando o primeiro e o último (diferença máxima de 365 dias)
  if (startOf(to).getTime() - startOf(from).getTime() > 365 * DAY) {
    to = toDay(new Date(startOf(from).getTime() + 365 * DAY));
  }
  return { from, to };
}
