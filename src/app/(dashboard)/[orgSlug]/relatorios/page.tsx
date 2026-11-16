import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { EmptyRow, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { tenantDb } from "@/lib/db";
import { formatDate, formatQty } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getCashFlow, getSalesReport, parsePeriod, toDay, type Period } from "@/modules/reports/service";

export const metadata: Metadata = { title: "Relatórios" };

type Tab = "caixa" | "vendas";

function presets(now = new Date()): { label: string; period: Period }[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = (yy: number, mm: number, dd: number) => toDay(new Date(Date.UTC(yy, mm, dd)));
  return [
    { label: "Este mês", period: { from: d(y, m, 1), to: d(y, m + 1, 0) } },
    { label: "Mês passado", period: { from: d(y, m - 1, 1), to: d(y, m, 0) } },
    { label: "Próximos 30 dias", period: { from: toDay(now), to: toDay(new Date(now.getTime() + 30 * 864e5)) } },
    { label: "Este ano", period: { from: d(y, 0, 1), to: d(y, 11, 31) } },
  ];
}

const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;
const day = (s: string) => formatDate(new Date(`${s}T00:00:00Z`));

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ tipo?: string; de?: string; ate?: string }>;
}) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgContext(orgSlug);
  const canCash = can(ctx.role, "financial:read");
  const canSales = can(ctx.role, "sales:read");
  if (!canCash && !canSales) notFound();

  const tab: Tab = sp.tipo === "vendas" || !canCash ? "vendas" : "caixa";
  if (tab === "vendas" && !canSales) notFound();
  const period = parsePeriod(sp.de, sp.ate);
  const base = `/${ctx.orgSlug}/relatorios`;
  const qs = (t: Tab, p: Period = period) => `${base}?tipo=${t}&de=${p.from}&ate=${p.to}`;
  const exportUrl = (tipo: string) => `${base}/exportar?tipo=${tipo}&de=${period.from}&ate=${period.to}`;
  const db = tenantDb(ctx.organizationId);

  return (
    <>
      <PageHeader title="Relatórios" description={`Período: ${day(period.from)} a ${day(period.to)}`} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <nav className="flex gap-1 rounded-lg border p-1" aria-label="Relatórios">
          {(
            [
              ["caixa", "Fluxo de caixa", canCash],
              ["vendas", "Vendas", canSales],
            ] as const
          )
            .filter(([, , ok]) => ok)
            .map(([t, label]) => (
              <Link
                key={t}
                href={qs(t)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {label}
              </Link>
            ))}
        </nav>

        <form method="get" action={base} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tipo" value={tab} />
          <label className="grid gap-1 text-xs text-muted-foreground">
            De
            <Input type="date" name="de" defaultValue={period.from} className="w-40" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Até
            <Input type="date" name="ate" defaultValue={period.to} className="w-40" />
          </label>
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {presets().map((p) => (
          <Link key={p.label} href={qs(tab, p.period)} className="rounded-full border px-3 py-1 hover:bg-accent">
            {p.label}
          </Link>
        ))}
      </div>

      {tab === "caixa" ? (
        <CashFlowSection db={db} period={period} exportUrl={exportUrl("caixa")} />
      ) : (
        <SalesSection db={db} period={period} exportUrl={exportUrl} />
      )}
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent
        className={cn(
          "px-4 text-xl font-semibold tabular-nums",
          tone === "pos" && "text-emerald-600",
          tone === "neg" && "text-destructive",
        )}
      >
        {value}
      </CardContent>
    </Card>
  );
}

function ExportButton({ href, label = "Exportar CSV" }: { href: string; label?: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href}>
        <Download /> {label}
      </a>
    </Button>
  );
}

async function CashFlowSection({
  db,
  period,
  exportUrl,
}: {
  db: ReturnType<typeof tenantDb>;
  period: Period;
  exportUrl: string;
}) {
  const cf = await getCashFlow(db, period);
  const t = cf.totals;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Saldo inicial" value={formatCents(cf.openingBalanceCents)} />
        <Kpi label="Recebido no período" value={formatCents(t.inCents)} tone={t.inCents ? "pos" : undefined} />
        <Kpi label="Pago no período" value={formatCents(t.outCents)} tone={t.outCents ? "neg" : undefined} />
        <Kpi
          label="Saldo realizado no fim"
          value={formatCents(t.closingBalanceCents)}
          tone={t.closingBalanceCents < 0 ? "neg" : undefined}
        />
        <Kpi label="A receber em aberto (vence no período)" value={formatCents(t.expectedInCents)} />
        <Kpi label="A pagar em aberto (vence no período)" value={formatCents(t.expectedOutCents)} />
        <Kpi
          label="Saldo projetado no fim"
          value={formatCents(t.projectedClosingCents)}
          tone={t.projectedClosingCents < 0 ? "neg" : undefined}
        />
      </div>

      {(cf.overdue.receivable.count > 0 || cf.overdue.payable.count > 0) && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Fora do período e ainda em aberto (vencidos): {cf.overdue.receivable.count} a receber (
          {formatCents(cf.overdue.receivable.cents)}) e {cf.overdue.payable.count} a pagar (
          {formatCents(cf.overdue.payable.cents)}). Não entram no saldo projetado acima.
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="grid gap-1.5">
            <CardTitle>Movimento por dia</CardTitle>
            <CardDescription>
              Realizado = baixas registradas (estornos não contam). Previsto = saldo em aberto dos títulos pelo
              vencimento.
            </CardDescription>
          </div>
          <ExportButton href={exportUrl} />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Recebido</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="text-right">A receber</TableHead>
                <TableHead className="text-right">A pagar</TableHead>
                <TableHead className="text-right">Saldo realizado</TableHead>
                <TableHead className="text-right">Saldo projetado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cf.rows.length === 0 && <EmptyRow colSpan={7}>Nenhum movimento no período.</EmptyRow>}
              {cf.rows.map((r) => (
                <TableRow key={r.day}>
                  <TableCell>{day(r.day)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", r.inCents > 0 && "text-emerald-600")}>
                    {r.inCents ? formatCents(r.inCents) : "—"}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", r.outCents > 0 && "text-destructive")}>
                    {r.outCents ? formatCents(r.outCents) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.expectedInCents ? formatCents(r.expectedInCents) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.expectedOutCents ? formatCents(r.expectedOutCents) : "—"}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", r.balanceCents < 0 && "text-destructive")}>
                    {formatCents(r.balanceCents)}
                  </TableCell>
                  <TableCell
                    className={cn("text-right tabular-nums", r.projectedBalanceCents < 0 && "text-destructive")}
                  >
                    {formatCents(r.projectedBalanceCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

async function SalesSection({
  db,
  period,
  exportUrl,
}: {
  db: ReturnType<typeof tenantDb>;
  period: Period;
  exportUrl: (tipo: string) => string;
}) {
  const s = await getSalesReport(db, period);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Pedidos confirmados" value={String(s.totals.orders)} />
        <Kpi label="Faturamento líquido" value={formatCents(s.totals.netCents)} tone="pos" />
        <Kpi label="Descontos concedidos" value={formatCents(s.totals.discountCents)} />
        <Kpi label="Ticket médio" value={formatCents(s.totals.averageTicketCents)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="grid gap-1.5">
              <CardTitle>Por cliente</CardTitle>
              <CardDescription>Valores líquidos (após desconto do pedido).</CardDescription>
            </div>
            <ExportButton href={exportUrl("vendas-clientes")} />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.byCustomer.length === 0 && <EmptyRow colSpan={4}>Nenhuma venda no período.</EmptyRow>}
                {s.byCustomer.map((c) => (
                  <TableRow key={c.customerId}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.orders}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(c.totalCents)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{pct(c.sharePct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="grid gap-1.5">
              <CardTitle>Por produto</CardTitle>
              <CardDescription>Valores brutos (antes do desconto, que é dado no pedido inteiro).</CardDescription>
            </div>
            <ExportButton href={exportUrl("vendas-produtos")} />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Qtd.</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.byProduct.length === 0 && <EmptyRow colSpan={4}>Nenhuma venda no período.</EmptyRow>}
                {s.byProduct.map((p) => (
                  <TableRow key={p.productId}>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">{p.sku}</span> {p.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQty(p.quantity)} {p.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(p.grossCents)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{pct(p.sharePct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
