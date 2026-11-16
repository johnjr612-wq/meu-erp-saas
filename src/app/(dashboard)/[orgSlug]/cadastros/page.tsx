import type { Metadata } from "next";
import { ActionForm, FormField } from "@/components/forms/action-form";
import { EmptyRow, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatQty, LABELS } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { createCustomerAction, createProductAction, createSupplierAction } from "@/modules/registry/actions";
import { loadPage } from "../guard";

export const metadata: Metadata = { title: "Cadastros" };

export default async function RegistryPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { ctx, db } = await loadPage(orgSlug, "registry:read");
  const canWrite = can(ctx.role, "registry:write");

  const [products, customers, suppliers] = await Promise.all([
    db.product.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }], take: 200 }),
    db.customer.findMany({ orderBy: { name: "asc" }, take: 200 }),
    db.supplier.findMany({ orderBy: { name: "asc" }, take: 200 }),
  ]);

  return (
    <>
      <PageHeader title="Cadastros" description="Produtos, insumos, clientes e fornecedores." />

      <Card>
        <CardHeader>
          <CardTitle>Produtos e insumos</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          {canWrite && (
            <ActionForm action={createProductAction} orgSlug={ctx.orgSlug} submitLabel="Adicionar produto">
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField name="sku" label="SKU" placeholder="DET-500" required />
                <FormField name="name" label="Nome" placeholder="Detergente neutro 500ml" required />
                <FormField name="type" label="Tipo">
                  <NativeSelect id="type" name="type" defaultValue="FINISHED_GOOD">
                    {Object.entries(LABELS.productType).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField name="unit" label="Unidade">
                  <NativeSelect id="unit" name="unit" defaultValue="UN">
                    {["UN", "KG", "G", "L", "ML", "CX"].map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField name="priceCents" label="Preço de venda (R$)" placeholder="4,90" inputMode="decimal" />
                <FormField name="minStock" label="Estoque mínimo" placeholder="0" inputMode="decimal" />
              </div>
            </ActionForm>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Custo médio</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.length === 0 && <EmptyRow colSpan={6}>Nenhum produto cadastrado.</EmptyRow>}
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{LABELS.productType[p.type]}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(p.priceCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(p.costCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(p.stockQuantity)} {p.unit}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Clientes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            {canWrite && (
              <ActionForm action={createCustomerAction} orgSlug={ctx.orgSlug} submitLabel="Adicionar cliente">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField name="name" label="Nome / Razão social" required />
                  <FormField name="document" label="CPF/CNPJ" />
                  <FormField name="phone" label="Telefone" />
                  <FormField name="city" label="Cidade" />
                </div>
              </ActionForm>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Cidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.length === 0 && <EmptyRow colSpan={3}>Nenhum cliente.</EmptyRow>}
                {customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.document ?? "—"}</TableCell>
                    <TableCell>{c.city ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fornecedores</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            {canWrite && (
              <ActionForm action={createSupplierAction} orgSlug={ctx.orgSlug} submitLabel="Adicionar fornecedor">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField name="name" label="Nome / Razão social" required />
                  <FormField name="document" label="CNPJ" />
                </div>
              </ActionForm>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Documento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.length === 0 && <EmptyRow colSpan={2}>Nenhum fornecedor.</EmptyRow>}
                {suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>{s.document ?? "—"}</TableCell>
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
