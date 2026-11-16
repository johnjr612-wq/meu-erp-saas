import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormField } from "@/components/forms/action-form";
import { LineItemsForm } from "@/components/forms/line-items-form";
import { EmptyRow, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, LABELS } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { cancelSalesOrderAction, confirmSalesOrderAction, createSalesOrderAction } from "@/modules/sales/actions";
import { loadPage } from "../guard";

export const metadata: Metadata = { title: "Vendas" };

export default async function SalesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { ctx, db } = await loadPage(orgSlug, "sales:read");

  const [orders, customers, products] = await Promise.all([
    db.salesOrder.findMany({
      // inclui cancelados (soft-deleted) no histórico
      where: { deletedAt: undefined },
      include: { customer: { select: { name: true } }, _count: { select: { items: true } } },
      orderBy: { number: "desc" },
      take: 100,
    }),
    db.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.product.findMany({
      where: { type: "FINISHED_GOOD" },
      select: { id: true, name: true, sku: true, priceCents: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const quotes = orders.filter((o) => o.status === "QUOTE");

  return (
    <>
      <PageHeader title="Vendas" description="Orçamentos e pedidos. Confirmar baixa o estoque e gera a conta a receber." />

      <div className="grid gap-6 lg:grid-cols-2">
        {can(ctx.role, "sales:write") && (
          <Card>
            <CardHeader>
              <CardTitle>Novo orçamento</CardTitle>
            </CardHeader>
            <CardContent>
              <LineItemsForm
                action={createSalesOrderAction}
                orgSlug={ctx.orgSlug}
                itemField="productId"
                itemLabel="Produtos"
                submitLabel="Criar orçamento"
                options={products.map((p) => ({ id: p.id, label: `${p.sku} · ${p.name} · ${formatCents(p.priceCents)}` }))}
              >
                <FormField name="customerId" label="Cliente">
                  <NativeSelect id="customerId" name="customerId" required>
                    <option value="">Selecione...</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField name="discountCents" label="Desconto (R$)" placeholder="0,00" inputMode="decimal" />
              </LineItemsForm>
            </CardContent>
          </Card>
        )}

        {(can(ctx.role, "sales:write") || can(ctx.role, "sales:confirm")) && (
          <Card>
            <CardHeader>
              <CardTitle>Confirmar ou cancelar orçamento</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6">
              {can(ctx.role, "sales:confirm") && (
                <ActionForm action={confirmSalesOrderAction} orgSlug={ctx.orgSlug} submitLabel="Confirmar pedido">
                  <FormField name="salesOrderId" label="Orçamento">
                    <NativeSelect id="salesOrderId" name="salesOrderId" required>
                      {quotes.length === 0 && <option value="">Nenhum orçamento em aberto</option>}
                      {quotes.map((o) => (
                        <option key={o.id} value={o.id}>
                          #{o.number} · {o.customer.name} · {formatCents(o.totalCents)}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField name="dueDate" label="Vencimento do recebível" type="date" required />
                </ActionForm>
              )}
              {can(ctx.role, "sales:write") && (
              <ActionForm
                action={cancelSalesOrderAction}
                orgSlug={ctx.orgSlug}
                submitLabel="Cancelar orçamento"
                submitVariant="outline"
              >
                <FormField name="salesOrderId" label="Orçamento">
                  <NativeSelect id="cancel-salesOrderId" name="salesOrderId" required>
                    {quotes.length === 0 && <option value="">Nenhum orçamento em aberto</option>}
                    {quotes.map((o) => (
                      <option key={o.id} value={o.id}>
                        #{o.number} · {o.customer.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </ActionForm>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pedidos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Itens</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 && <EmptyRow colSpan={6}>Nenhum pedido.</EmptyRow>}
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link href={`/${ctx.orgSlug}/vendas/${o.id}`} className="font-medium text-primary hover:underline">
                      #{o.number}
                    </Link>
                  </TableCell>
                  <TableCell>{o.customer.name}</TableCell>
                  <TableCell>{o._count.items}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === "CONFIRMED" ? "default" : o.status === "CANCELED" ? "outline" : "secondary"}>
                      {LABELS.salesStatus[o.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(o.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(o.totalCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
