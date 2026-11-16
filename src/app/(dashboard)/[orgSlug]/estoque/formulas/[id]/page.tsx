import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, FormField } from "@/components/forms/action-form";
import { LineItemsForm } from "@/components/forms/line-items-form";
import { BackLink } from "@/components/layout/back-link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatQty, qtyToInput } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { deleteFormulaAction, updateFormulaAction } from "@/modules/inventory/actions";
import { loadPage } from "../../../guard";

export const metadata: Metadata = { title: "Fórmula" };

export default async function FormulaPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const { ctx, db } = await loadPage(orgSlug, "inventory:read");

  const formula = await db.formula.findFirst({
    where: { id },
    include: {
      product: { select: { name: true, unit: true } },
      items: { include: { component: { select: { name: true, sku: true, unit: true, costCents: true } } } },
    },
  });
  if (!formula) notFound();

  const [inputs, plannedOrders] = await Promise.all([
    db.product.findMany({
      where: { type: { not: "FINISHED_GOOD" } },
      select: { id: true, sku: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
    db.productionOrder.count({ where: { formulaId: formula.id, status: "PLANNED" } }),
  ]);

  // Custo estimado da batelada pelo custo médio ATUAL dos insumos (referência, não contábil).
  const batchCostCents = formula.items.reduce(
    (sum, i) => sum + Number(i.quantity.mul(i.component.costCents).toDecimalPlaces(0)),
    0,
  );
  const unitCostCents = Number(formula.yieldQuantity.isZero() ? 0 : Math.round(batchCostCents / Number(formula.yieldQuantity)));
  const canWrite = can(ctx.role, "production:write");
  const back = `/${ctx.orgSlug}/estoque`;

  return (
    <>
      <BackLink href={back} label="Estoque e Produção" />
      <PageHeader
        title={formula.name}
        description={`Gera ${formatQty(formula.yieldQuantity)} ${formula.product.unit} de ${formula.product.name} por batelada · custo estimado ${formatCents(batchCostCents)} por batelada (${formatCents(unitCostCents)}/${formula.product.unit})`}
      />

      {plannedOrders > 0 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Há {plannedOrders} ordem(ns) de produção planejada(s) com esta fórmula. Enquanto isso, só nome e instruções
          podem mudar. Conclua ou cancele as OPs para alterar rendimento ou insumos.
        </p>
      )}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>Editar fórmula</CardTitle>
            <CardDescription>
              O produto gerado não muda. Ordens já concluídas não são afetadas: o consumo delas já está no estoque.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LineItemsForm
              action={updateFormulaAction}
              orgSlug={ctx.orgSlug}
              itemField="componentId"
              itemLabel="Insumos por batelada"
              submitLabel="Salvar fórmula"
              resetOnSuccess={false}
              options={inputs.map((p) => ({ id: p.id, label: `${p.sku} · ${p.name} (${p.unit})` }))}
              initialLines={formula.items.map((i) => ({ itemId: i.componentId, quantity: qtyToInput(i.quantity) }))}
            >
              <input type="hidden" name="formulaId" value={formula.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField name="name" label="Nome da fórmula" defaultValue={formula.name} required />
                <FormField
                  name="yieldQuantity"
                  label={`Rendimento por batelada (${formula.product.unit})`}
                  defaultValue={qtyToInput(formula.yieldQuantity)}
                  inputMode="decimal"
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="instructions" className="text-sm font-medium">
                  Modo de preparo / instruções
                </label>
                <textarea
                  id="instructions"
                  name="instructions"
                  rows={4}
                  defaultValue={formula.instructions ?? ""}
                  className="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
            </LineItemsForm>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Insumos por batelada</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formula.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      {i.component.sku} · {i.component.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQty(i.quantity)} {i.component.unit}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {canWrite && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Excluir fórmula</CardTitle>
            <CardDescription>
              Só é possível sem ordens de produção planejadas. As ordens concluídas continuam no histórico.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={deleteFormulaAction}
              orgSlug={ctx.orgSlug}
              hidden={{ formulaId: formula.id }}
              submitLabel="Excluir fórmula"
              submitVariant="destructive"
              confirmMessage={`Excluir a fórmula "${formula.name}"?`}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
