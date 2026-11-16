import type { Metadata } from "next";
import { ActionForm, FormField } from "@/components/forms/action-form";
import { EmptyRow, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, LABELS } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import {
  cancelEntryAction,
  createBankAccountAction,
  createEntryAction,
  reconcilePaymentAction,
  reversePaymentAction,
  settleEntryAction,
} from "@/modules/financial/actions";
import { getBankBalances } from "@/modules/financial/service";
import { loadPage } from "../guard";

export const metadata: Metadata = { title: "Financeiro" };

export default async function FinancialPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { ctx, db } = await loadPage(orgSlug, "financial:read");
  const canWrite = can(ctx.role, "financial:write");
  const canSettle = can(ctx.role, "financial:settle");
  const canReconcile = can(ctx.role, "financial:reconcile");

  const [entries, balances, customers, suppliers, payments] = await Promise.all([
    db.financialEntry.findMany({
      include: { customer: { select: { name: true } }, supplier: { select: { name: true } } },
      orderBy: [{ dueDate: "asc" }],
      take: 200,
    }),
    getBankBalances(db),
    db.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.financialPayment.findMany({
      where: { reversedAt: null },
      include: { entry: { select: { description: true, type: true } }, bankAccount: { select: { name: true } } },
      orderBy: { paidAt: "desc" },
      take: 50,
    }),
  ]);

  const openEntries = entries.filter((e) => e.status === "OPEN" || e.status === "PARTIAL");
  const unreconciled = payments.filter((p) => !p.reconciledAt);
  const today = new Date();

  return (
    <>
      <PageHeader title="Financeiro" description="Contas a pagar e receber, baixas e conciliação." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {balances.map((b) => (
          <Card key={b.id} className="gap-2">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{b.name}</CardTitle>
            </CardHeader>
            <CardContent className={`text-2xl font-semibold tabular-nums ${b.balanceCents < 0 ? "text-destructive" : ""}`}>
              {formatCents(b.balanceCents)}
            </CardContent>
          </Card>
        ))}
        {canWrite && (
          <Card className="gap-2">
            <CardContent>
              <ActionForm action={createBankAccountAction} orgSlug={ctx.orgSlug} submitLabel="Criar conta" submitVariant="outline">
                <FormField name="name" label="Nova conta / caixa" placeholder="Banco, Caixa, Asaas..." required />
                <FormField name="openingBalanceCents" label="Saldo inicial (R$)" inputMode="decimal" />
              </ActionForm>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {canWrite && (
          <Card>
            <CardHeader>
              <CardTitle>Lançar título</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={createEntryAction} orgSlug={ctx.orgSlug} submitLabel="Lançar">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField name="type" label="Tipo">
                    <NativeSelect id="type" name="type" defaultValue="PAYABLE">
                      <option value="PAYABLE">A pagar</option>
                      <option value="RECEIVABLE">A receber</option>
                    </NativeSelect>
                  </FormField>
                  <FormField name="description" label="Descrição" required />
                  <FormField name="amountCents" label="Valor (R$)" inputMode="decimal" required />
                  <FormField name="dueDate" label="Vencimento" type="date" required />
                  <FormField name="category" label="Categoria" placeholder="Matéria-prima, Frete..." />
                  <FormField name="documentNumber" label="Nº documento / NF" />
                  <FormField name="supplierId" label="Fornecedor (a pagar)">
                    <NativeSelect id="supplierId" name="supplierId">
                      <option value="">—</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField name="customerId" label="Cliente (a receber)">
                    <NativeSelect id="customerId" name="customerId">
                      <option value="">—</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                </div>
              </ActionForm>
            </CardContent>
          </Card>
        )}

        {canSettle && (
          <Card>
            <CardHeader>
              <CardTitle>Baixar título</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6">
              <ActionForm action={settleEntryAction} orgSlug={ctx.orgSlug} submitLabel="Registrar baixa">
                <FormField name="entryId" label="Título">
                  <NativeSelect id="entryId" name="entryId" required>
                      {openEntries.length === 0 && <option value="">Nenhum título em aberto</option>}
                    {openEntries.map((e) => (
                      <option key={e.id} value={e.id}>
                        {LABELS.entryType[e.type]} · {e.description} · saldo {formatCents(e.amountCents - e.paidAmountCents)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField name="amountCents" label="Valor pago (R$)" inputMode="decimal" required />
                  <FormField name="paidAt" label="Data do pagamento" type="date" />
                  <FormField name="bankAccountId" label="Conta">
                    <NativeSelect id="bankAccountId" name="bankAccountId" required>
                      {balances.length === 0 && <option value="">Cadastre uma conta primeiro</option>}
                      {balances.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <FormField name="method" label="Forma">
                    <NativeSelect id="method" name="method" defaultValue="PIX">
                      {Object.entries(LABELS.paymentMethod).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                </div>
              </ActionForm>
              {canWrite && (
                <ActionForm action={cancelEntryAction} orgSlug={ctx.orgSlug} submitLabel="Cancelar título" submitVariant="outline">
                  <FormField name="entryId" label="Título sem baixas">
                    <NativeSelect id="cancel-entryId" name="entryId" required>
                      <option value="">Selecione...</option>
                      {openEntries
                        .filter((e) => e.paidAmountCents === 0)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.description} · {formatCents(e.amountCents)}
                          </option>
                        ))}
                    </NativeSelect>
                  </FormField>
                  <FormField name="reason" label="Motivo" required />
                </ActionForm>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Títulos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vencimento</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Cliente/Fornecedor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Pago</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 && <EmptyRow colSpan={7}>Nenhum título lançado.</EmptyRow>}
              {entries.map((e) => {
                const overdue = (e.status === "OPEN" || e.status === "PARTIAL") && e.dueDate < today;
                return (
                  <TableRow key={e.id}>
                    <TableCell className={overdue ? "text-destructive" : ""}>{formatDate(e.dueDate)}</TableCell>
                    <TableCell>{LABELS.entryType[e.type]}</TableCell>
                    <TableCell>{e.description}</TableCell>
                    <TableCell>{e.customer?.name ?? e.supplier?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={e.status === "PAID" ? "default" : overdue ? "destructive" : "secondary"}>
                        {overdue ? "Vencido" : LABELS.entryStatus[e.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(e.amountCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(e.paidAmountCents)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(canReconcile || canSettle) && (
        <Card>
          <CardHeader>
            <CardTitle>Conciliação e estornos</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            {canReconcile && (
              <ActionForm action={reconcilePaymentAction} orgSlug={ctx.orgSlug} submitLabel="Conciliar">
                <FormField name="paymentId" label="Baixa não conciliada">
                  <NativeSelect id="paymentId" name="paymentId" required>
                      {unreconciled.length === 0 && <option value="">Nenhuma baixa pendente</option>}
                    {unreconciled.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatDate(p.paidAt)} · {p.bankAccount.name} · {p.entry.description} · {formatCents(p.amountCents)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField name="externalId" label="ID da transação no extrato" required />
              </ActionForm>
            )}
            {canSettle && (
              <ActionForm action={reversePaymentAction} orgSlug={ctx.orgSlug} submitLabel="Estornar baixa" submitVariant="destructive">
                <FormField name="paymentId" label="Baixa">
                  <NativeSelect id="reverse-paymentId" name="paymentId" required>
                      {unreconciled.length === 0 && <option value="">Nenhuma baixa pendente</option>}
                    {unreconciled.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatDate(p.paidAt)} · {p.entry.description} · {formatCents(p.amountCents)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField name="reason" label="Motivo do estorno" required />
              </ActionForm>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
