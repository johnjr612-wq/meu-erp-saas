import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormField } from "@/components/forms/action-form";
import { LineItemsForm } from "@/components/forms/line-items-form";
import { BackLink } from "@/components/layout/back-link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatQty, LABELS, qtyToInput } from "@/lib/format";
import { centsToInput, formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { updateQuoteAction } from "@/modules/sales/actions";
import { loadPage } from "../../guard";

export const metadata: Metadata = { title: "Pedido" };

export default async function SalesOrderPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const { ctx, db } = await loadPage(orgSlug, "sales:read");

  const order = await db.salesOrder.findFirst({
    // inclui cancelados (soft-deleted) para consulta do histórico
    where: { id, deletedAt: undefined },
    include: {
      customer: { select: { name: true } },
      items: { include: { product: { select: { name: true, sku: true, unit: true } } } },
    },
  });
  if (!order) notFound();

  const editable = order.status === "QUOTE" && can(ctx.role, "sales:write");
  const [customers, products] = editable
    ? await Promise.all([
        db.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
        db.product.findMany({
          where: { type: "FINISHED_GOOD" },
          select: { id: true, name: true, sku: true, priceCents: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  return (
    <>
      <BackLink href={`/${ctx.orgSlug}/vendas`} label="Vendas" />
      <PageHeader
        title={`${order.status === "QUOTE" ? "Orçamento" : "Pedido"} #${order.number}`}
        description={`${order.customer.name} · criado em ${formatDate(order.createdAt)}${order.confirmedAt ? ` · confirmado em ${formatDate(order.confirmedAt)}` : ""}`}
        actions={
          <Badge variant={order.status === "CONFIRMED" ? "default" : order.status === "CANCELED" ? "outline" : "secondary"}>
            {LABELS.salesStatus[order.status]}
          </Badge>
        }
      />

      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Editar orçamento</CardTitle>
            <CardDescription>
              Os preços são recalculados pelo cadastro atual dos produtos. Depois de confirmado, o pedido não pode mais
              ser alterado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LineItemsForm
              action={updateQuoteAction}
              orgSlug={ctx.orgSlug}
              itemField="productId"
              itemLabel="Produtos"
              submitLabel="Salvar orçamento"
              resetOnSuccess={false}
              options={products.map((p) => ({ id: p.id, label: `${p.sku} · ${p.name} · ${formatCents(p.priceCents)}` }))}
              initialLines={order.items.map((i) => ({ itemId: i.productId, quantity: qtyToInput(i.quantity) }))}
            >
              <input type="hidden" name="salesOrderId" value={order.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField name="customerId" label="Cliente">
                  <NativeSelect id="customerId" name="customerId" defaultValue={order.customerId} required>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField
                  name="discountCents"
                  label="Desconto (R$)"
                  defaultValue={centsToInput(order.discountCents)}
                  inputMode="decimal"
                />
              </div>
              <FormField name="notes" label="Observações" defaultValue={order.notes ?? ""} />
            </LineItemsForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Itens</CardTitle>
          {order.notes && <CardDescription>Obs.: {order.notes}</CardDescription>}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Qtd.</TableHead>
                <TableHead className="text-right">Preço unit.</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    {i.product.sku} · {i.product.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(i.quantity)} {i.product.unit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(i.unitPriceCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(i.totalCents)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} className="text-right text-muted-foreground">
                  Subtotal · desconto
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCents(order.subtotalCents)} · −{formatCents(order.discountCents)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={3} className="text-right font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatCents(order.totalCents)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
