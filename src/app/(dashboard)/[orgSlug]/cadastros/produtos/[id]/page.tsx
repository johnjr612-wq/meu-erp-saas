import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, FormField } from "@/components/forms/action-form";
import { BackLink } from "@/components/layout/back-link";
import { EmptyRow, PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatQty, LABELS, qtyToInput } from "@/lib/format";
import { centsToInput, formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { deleteProductAction, updateProductAction } from "@/modules/registry/actions";
import { loadPage } from "../../../guard";

export const metadata: Metadata = { title: "Editar produto" };

export default async function EditProductPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const { ctx, db } = await loadPage(orgSlug, "registry:read");
  const [product, movements] = await Promise.all([
    db.product.findFirst({ where: { id } }),
    db.stockMovement.findMany({ where: { productId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  if (!product) notFound();
  const canWrite = can(ctx.role, "registry:write");
  const back = `/${ctx.orgSlug}/cadastros`;

  return (
    <>
      <BackLink href={back} label="Cadastros" />
      <PageHeader
        title={product.name}
        description={`${LABELS.productType[product.type]} · saldo ${formatQty(product.stockQuantity)} ${product.unit} · custo médio ${formatCents(product.costCents)}`}
      />

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle>Dados do produto</CardTitle>
            <CardDescription>
              O custo médio é calculado pelas entradas e pela produção. A unidade só pode mudar enquanto não houver
              movimentação.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={updateProductAction}
              orgSlug={ctx.orgSlug}
              hidden={{ id: product.id }}
              resetOnSuccess={false}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField name="sku" label="SKU" defaultValue={product.sku} required />
                <FormField name="name" label="Nome" defaultValue={product.name} required />
                <FormField name="type" label="Tipo">
                  <NativeSelect id="type" name="type" defaultValue={product.type}>
                    {Object.entries(LABELS.productType).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField name="unit" label="Unidade">
                  <NativeSelect id="unit" name="unit" defaultValue={product.unit}>
                    {["UN", "KG", "G", "L", "ML", "CX"].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField
                  name="priceCents"
                  label="Preço de venda (R$)"
                  defaultValue={centsToInput(product.priceCents)}
                  inputMode="decimal"
                />
                <FormField
                  name="minStock"
                  label="Estoque mínimo"
                  defaultValue={qtyToInput(product.minStock)}
                  inputMode="decimal"
                />
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Últimas movimentações</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right">Qtd.</TableHead>
                <TableHead className="text-right">Saldo após</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.length === 0 && <EmptyRow colSpan={6}>Nenhuma movimentação.</EmptyRow>}
              {movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{formatDate(m.createdAt)}</TableCell>
                  <TableCell>{LABELS.movementType[m.type]}</TableCell>
                  <TableCell className="font-mono text-xs">{m.lot ?? "—"}</TableCell>
                  <TableCell className="max-w-48 truncate">{m.reason ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(m.quantity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(m.balanceAfter)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canWrite && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Excluir produto</CardTitle>
            <CardDescription>
              Só é possível com estoque zerado, fora de fórmulas e sem orçamentos ou ordens de produção em aberto. O
              histórico é mantido.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={deleteProductAction}
              orgSlug={ctx.orgSlug}
              hidden={{ id: product.id }}
              submitLabel="Excluir produto"
              submitVariant="destructive"
              confirmMessage={`Excluir "${product.name}"?`}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
