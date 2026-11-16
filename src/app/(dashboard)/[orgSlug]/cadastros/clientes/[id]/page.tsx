import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, FormField } from "@/components/forms/action-form";
import { BackLink } from "@/components/layout/back-link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { deleteCustomerAction, updateCustomerAction } from "@/modules/registry/actions";
import { loadPage } from "../../../guard";

export const metadata: Metadata = { title: "Editar cliente" };

export default async function EditCustomerPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const { ctx, db } = await loadPage(orgSlug, "registry:read");
  const customer = await db.customer.findFirst({ where: { id } });
  if (!customer) notFound();
  const canWrite = can(ctx.role, "registry:write");
  const back = `/${ctx.orgSlug}/cadastros`;
  const v = (x: string | null) => x ?? "";

  return (
    <>
      <BackLink href={back} label="Cadastros" />
      <PageHeader title={customer.name} description="Cliente" />
      <Card>
        <CardHeader>
          <CardTitle>Dados do cliente</CardTitle>
          <CardDescription>Apague o conteúdo de um campo para removê-lo.</CardDescription>
        </CardHeader>
        <CardContent>
          {canWrite ? (
            <ActionForm
              action={updateCustomerAction}
              orgSlug={ctx.orgSlug}
              hidden={{ id: customer.id }}
              resetOnSuccess={false}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField name="name" label="Nome / Razão social" defaultValue={customer.name} required />
                <FormField name="document" label="CPF/CNPJ" defaultValue={v(customer.document)} />
                <FormField name="email" label="E-mail" type="email" defaultValue={v(customer.email)} />
                <FormField name="phone" label="Telefone" defaultValue={v(customer.phone)} />
                <FormField name="address" label="Endereço" defaultValue={v(customer.address)} />
                <FormField name="city" label="Cidade" defaultValue={v(customer.city)} />
                <FormField name="state" label="UF" maxLength={2} defaultValue={v(customer.state)} />
                <FormField name="zipCode" label="CEP" defaultValue={v(customer.zipCode)} />
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted-foreground">Você não tem permissão para editar.</p>
          )}
        </CardContent>
      </Card>
      {canWrite && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Excluir cliente</CardTitle>
            <CardDescription>
              Só é possível sem contas a receber ou orçamentos em aberto. Pedidos e títulos antigos continuam no
              histórico.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={deleteCustomerAction}
              orgSlug={ctx.orgSlug}
              hidden={{ id: customer.id }}
              submitLabel="Excluir cliente"
              submitVariant="destructive"
              confirmMessage={`Excluir "${customer.name}"?`}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
