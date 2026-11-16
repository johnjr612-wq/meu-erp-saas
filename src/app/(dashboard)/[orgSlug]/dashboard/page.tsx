import type { Metadata } from "next";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatQty } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { loadPage } from "../guard";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { db } = await loadPage(orgSlug, "dashboard:read");

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const openStatuses = { in: ["OPEN", "PARTIAL"] as ("OPEN" | "PARTIAL")[] };

  const [receivable, payable, sales, products] = await Promise.all([
    db.financialEntry.aggregate({
      where: { type: "RECEIVABLE", status: openStatuses },
      _sum: { amountCents: true, paidAmountCents: true },
    }),
    db.financialEntry.aggregate({
      where: { type: "PAYABLE", status: openStatuses },
      _sum: { amountCents: true, paidAmountCents: true },
    }),
    db.salesOrder.aggregate({
      where: { status: "CONFIRMED", confirmedAt: { gte: monthStart } },
      _sum: { totalCents: true },
      _count: true,
    }),
    db.product.findMany({
      select: { id: true, name: true, sku: true, stockQuantity: true, minStock: true, unit: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Comparação Decimal x Decimal feita em memória (Prisma não compara duas colunas no where).
  const lowStock = products.filter((p) => p.minStock.gt(0) && p.stockQuantity.lte(p.minStock));
  const open = (s: { _sum: { amountCents: number | null; paidAmountCents: number | null } }) =>
    (s._sum.amountCents ?? 0) - (s._sum.paidAmountCents ?? 0);

  const kpis = [
    { label: "A receber (em aberto)", value: formatCents(open(receivable)), icon: ArrowDownCircle },
    { label: "A pagar (em aberto)", value: formatCents(open(payable)), icon: ArrowUpCircle },
    { label: `Vendas no mês (${sales._count})`, value: formatCents(sales._sum.totalCents ?? 0), icon: ShoppingCart },
    { label: "Itens abaixo do mínimo", value: String(lowStock.length), icon: AlertTriangle },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="Visão geral da operação." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="gap-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{value}</CardContent>
          </Card>
        ))}
      </div>
      {lowStock.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Reposição necessária</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStock.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {formatQty(p.stockQuantity)} {p.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(p.minStock)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
