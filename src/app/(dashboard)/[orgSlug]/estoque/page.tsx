import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormField } from "@/components/forms/action-form";
import { LineItemsForm } from "@/components/forms/line-items-form";
import { EmptyRow, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatQty, LABELS } from "@/lib/format";
import { can } from "@/lib/permissions";
import {
  cancelProductionOrderAction,
  completeProductionOrderAction,
  createFormulaAction,
  createProductionOrderAction,
  registerMovementAction,
} from "@/modules/inventory/actions";
import { loadPage } from "../guard";

export const metadata: Metadata = { title: "Estoque e Produção" };

export default async function InventoryPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { ctx, db } = await loadPage(orgSlug, "inventory:read");
  const canMove = can(ctx.role, "inventory:write");
  const canProduce = can(ctx.role, "production:write");

  const [products, movements, formulas, productionOrders] = await Promise.all([
    db.product.findMany({
      select: { id: true, sku: true, name: true, type: true, unit: true },
      orderBy: { name: "asc" },
    }),
    db.stockMovement.findMany({
      include: { product: { select: { name: true, unit: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.formula.findMany({
      include: { product: { select: { name: true } }, _count: { select: { items: true } } },
      orderBy: { name: "asc" },
    }),
    db.productionOrder.findMany({
      include: { product: { select: { name: true, unit: true } } },
      orderBy: { number: "desc" },
      take: 50,
    }),
  ]);

  const finished = products.filter((p) => p.type === "FINISHED_GOOD");
  const inputs = products.filter((p) => p.type !== "FINISHED_GOOD");
  const planned = productionOrders.filter((o) => o.status === "PLANNED");

  return (
    <>
      <PageHeader
        title="Estoque e Produção"
        description="Movimentações manuais, fórmulas e ordens de produção. Saldos ficam em Cadastros."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {canMove && (
          <Card>
            <CardHeader>
              <CardTitle>Movimentação manual</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={registerMovementAction} orgSlug={ctx.orgSlug} submitLabel="Registrar">
                <FormField name="productId" label="Produto">
                  <NativeSelect id="productId" name="productId" required>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} · {p.name} ({p.unit})
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField name="type" label="Tipo">
                    <NativeSelect id="type" name="type" defaultValue="IN">
                      <option value="IN">Entrada (compra)</option>
                      <option value="OUT">Saída</option>
                      <option value="ADJUSTMENT">Ajuste (+/−)</option>
                    </NativeSelect>
                  </FormField>
                  <FormField name="quantity" label="Quantidade" inputMode="decimal" required />
                  <FormField name="unitCostCents" label="Custo unit. (R$)" inputMode="decimal" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField name="lot" label="Lote" />
                  <FormField name="reason" label="Motivo" />
                </div>
              </ActionForm>
            </CardContent>
          </Card>
        )}

        {canProduce && (
          <Card>
            <CardHeader>
              <CardTitle>Ordem de produção</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6">
              <ActionForm action={createProductionOrderAction} orgSlug={ctx.orgSlug} submitLabel="Criar OP">
                <FormField name="formulaId" label="Fórmula">
                  <NativeSelect id="formulaId" name="formulaId" required>
                    {formulas.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} → {f.product.name} (rende {formatQty(f.yieldQuantity)})
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField name="quantity" label="Quantidade a produzir" inputMode="decimal" required />
                  <FormField name="lot" label="Lote" required />
                  <FormField name="expiresAt" label="Validade" type="date" />
                </div>
              </ActionForm>
              <ActionForm
                  action={completeProductionOrderAction}
                  orgSlug={ctx.orgSlug}
                  submitLabel="Concluir produção"
                  submitVariant="secondary"
                >
                  <FormField name="productionOrderId" label="OP planejada">
                    <NativeSelect id="productionOrderId" name="productionOrderId" required>
                      {planned.length === 0 && <option value="">Nenhuma OP planejada</option>}
                      {planned.map((o) => (
                        <option key={o.id} value={o.id}>
                          OP #{o.number} · {o.product.name} · {formatQty(o.quantity)} {o.product.unit} · lote {o.lot}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                </ActionForm>
              <ActionForm
                action={cancelProductionOrderAction}
                orgSlug={ctx.orgSlug}
                submitLabel="Cancelar OP"
                submitVariant="outline"
                confirmMessage="Cancelar esta ordem de produção planejada? Nada foi consumido do estoque."
              >
                <FormField name="productionOrderId" label="Cancelar OP planejada">
                  <NativeSelect id="cancel-productionOrderId" name="productionOrderId" required>
                    {planned.length === 0 && <option value="">Nenhuma OP planejada</option>}
                    {planned.map((o) => (
                      <option key={o.id} value={o.id}>
                        OP #{o.number} · {o.product.name} · lote {o.lot}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </ActionForm>
            </CardContent>
          </Card>
        )}
      </div>

      {canProduce && (
        <Card>
          <CardHeader>
            <CardTitle>Nova fórmula</CardTitle>
          </CardHeader>
          <CardContent>
            <LineItemsForm
              action={createFormulaAction}
              orgSlug={ctx.orgSlug}
              itemField="componentId"
              itemLabel="Insumos por batelada"
              submitLabel="Salvar fórmula"
              options={inputs.map((p) => ({ id: p.id, label: `${p.sku} · ${p.name} (${p.unit})` }))}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField name="name" label="Nome da fórmula" required />
                <FormField name="productId" label="Produto gerado">
                  <NativeSelect id="formula-productId" name="productId" required>
                    {finished.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.unit})
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField name="yieldQuantity" label="Rendimento por batelada" inputMode="decimal" required />
              </div>
            </LineItemsForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Fórmulas</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fórmula</TableHead>
                <TableHead>Produto gerado</TableHead>
                <TableHead className="text-right">Insumos</TableHead>
                <TableHead className="text-right">Rendimento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {formulas.length === 0 && <EmptyRow colSpan={4}>Nenhuma fórmula cadastrada.</EmptyRow>}
              {formulas.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <Link
                      href={`/${ctx.orgSlug}/estoque/formulas/${f.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {f.name}
                    </Link>
                  </TableCell>
                  <TableCell>{f.product.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{f._count.items}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(f.yieldQuantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ordens de produção</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OP</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productionOrders.length === 0 && <EmptyRow colSpan={6}>Nenhuma ordem de produção.</EmptyRow>}
              {productionOrders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>#{o.number}</TableCell>
                  <TableCell>{o.product.name}</TableCell>
                  <TableCell className="font-mono text-xs">{o.lot}</TableCell>
                  <TableCell>{formatDate(o.expiresAt)}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === "COMPLETED" ? "default" : "secondary"}>
                      {o.status === "COMPLETED" ? "Concluída" : o.status === "PLANNED" ? "Planejada" : "Cancelada"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(o.quantity)} {o.product.unit}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Últimas movimentações</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right">Qtd.</TableHead>
                <TableHead className="text-right">Saldo após</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.length === 0 && <EmptyRow colSpan={7}>Nenhuma movimentação.</EmptyRow>}
              {movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{formatDate(m.createdAt)}</TableCell>
                  <TableCell>{m.product.name}</TableCell>
                  <TableCell>{LABELS.movementType[m.type]}</TableCell>
                  <TableCell className="font-mono text-xs">{m.lot ?? "—"}</TableCell>
                  <TableCell className="max-w-48 truncate">{m.reason ?? "—"}</TableCell>
                  <TableCell className={`text-right tabular-nums ${m.quantity.isNegative() ? "text-destructive" : "text-emerald-600"}`}>
                    {formatQty(m.quantity)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(m.balanceAfter)} {m.product.unit}
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
