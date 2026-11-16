import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, FormField } from "@/components/forms/action-form";
import { BackLink } from "@/components/layout/back-link";
import { EmptyRow, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, LABELS } from "@/lib/format";
import { centsToInput, formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { cancelEntryAction, updateEntryAction } from "@/modules/financial/actions";
import { loadPage } from "../../../guard";

export const metadata: Metadata = { title: "Título" };

export default async function EntryPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const { ctx, db } = await loadPage(orgSlug, "financial:read");

  const entry = await db.financialEntry.findFirst({
    where: { id },
    include: { salesOrder: { select: { number: true } } },
  });
  if (!entry) notFound();

  const isReceivable = entry.type === "RECEIVABLE";
  const [payments, parties] = await Promise.all([
    db.financialPayment.findMany({
      where: { entryId: entry.id },
      include: { bankAccount: { select: { name: true } } },
      orderBy: { paidAt: "asc" },
    }),
    isReceivable
      ? db.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
      : db.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const editable = can(ctx.role, "financial:write") && (entry.status === "OPEN" || entry.status === "PARTIAL");
  const back = `/${ctx.orgSlug}/financeiro`;
  const partyField = isReceivable ? "customerId" : "supplierId";
  const partyValue = (isReceivable ? entry.customerId : entry.supplierId) ?? "";

  return (
    <>
      <BackLink href={back} label="Financeiro" />
      <PageHeader
        title={entry.description}
        description={`${LABELS.entryType[entry.type]} · ${formatCents(entry.amountCents)} · pago ${formatCents(entry.paidAmountCents)}${entry.salesOrder ? ` · pedido #${entry.salesOrder.number}` : ""}`}
        actions={
          <Badge variant={entry.status === "PAID" ? "default" : "secondary"}>{LABELS.entryStatus[entry.status]}</Badge>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Dados do título</CardTitle>
          <CardDescription>
            {editable
              ? entry.paidAmountCents > 0
                ? `Já foram pagos ${formatCents(entry.paidAmountCents)}: o valor não pode ficar abaixo disso.`
                : "Alterações ficam registradas na auditoria."
              : "Títulos pagos não podem ser editados. Para corrigir, estorne a baixa na tela do Financeiro."}
          </CardDescription>
        </CardHeader>
        {editable && (
          <CardContent>
            <ActionForm
              action={updateEntryAction}
              orgSlug={ctx.orgSlug}
              hidden={{ entryId: entry.id }}
              resetOnSuccess={false}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField name="description" label="Descrição" defaultValue={entry.description} required />
                <FormField
                  name="amountCents"
                  label="Valor (R$)"
                  defaultValue={centsToInput(entry.amountCents)}
                  inputMode="decimal"
                  required
                />
                <FormField
                  name="dueDate"
                  label="Vencimento"
                  type="date"
                  defaultValue={entry.dueDate.toISOString().slice(0, 10)}
                  required
                />
                <FormField name="category" label="Categoria" defaultValue={entry.category ?? ""} />
                <FormField name="documentNumber" label="Nº documento / NF" defaultValue={entry.documentNumber ?? ""} />
                <FormField name={partyField} label={isReceivable ? "Cliente" : "Fornecedor"}>
                  <NativeSelect id={partyField} name={partyField} defaultValue={partyValue}>
                    <option value="">—</option>
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>
            </ActionForm>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Baixas</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Forma</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 && <EmptyRow colSpan={5}>Nenhuma baixa.</EmptyRow>}
              {payments.map((p) => (
                <TableRow key={p.id} className={p.reversedAt ? "text-muted-foreground line-through" : ""}>
                  <TableCell>{formatDate(p.paidAt)}</TableCell>
                  <TableCell>{p.bankAccount.name}</TableCell>
                  <TableCell>{LABELS.paymentMethod[p.method]}</TableCell>
                  <TableCell>
                    {p.reversedAt ? `Estornada: ${p.reversalReason ?? ""}` : p.reconciledAt ? "Conciliada" : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(p.amountCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editable && entry.paidAmountCents === 0 && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Cancelar título</CardTitle>
            <CardDescription>O título sai das listas, mas continua no banco e na auditoria.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={cancelEntryAction}
              orgSlug={ctx.orgSlug}
              hidden={{ entryId: entry.id }}
              submitLabel="Cancelar título"
              submitVariant="destructive"
              confirmMessage="Cancelar este título?"
            >
              <FormField name="reason" label="Motivo" required />
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </>
  );
}
