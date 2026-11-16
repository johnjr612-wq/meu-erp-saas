import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, FormField } from "@/components/forms/action-form";
import { BackLink } from "@/components/layout/back-link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { deleteSupplierAction, updateSupplierAction } from "@/modules/registry/actions";
import { loadPage } from "../../../guard";

export const metadata: Metadata = { title: "Editar fornecedor" };

export default async function EditSupplierPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const { ctx, db } = await loadPage(orgSlug, "registry:read");
  const supplier = await db.supplier.findFirst({ where: { id } });
  if (!supplier) notFound();
  const canWrite = can(ctx.role, "registry:write");
  const back = `/${ctx.orgSlug}/cadastros`;
  const v = (x: string | null) => x ?? "";

  return (
    <>
      <BackLink href={back} label="Cadastros" />
      <PageHeader title={supplier.name} description="Fornecedor" />
      <Card>
        <CardHeader>
          <CardTitle>Dados do fornecedor</CardTitle>
          <CardDescription>Apague o conteúdo de um campo para removê-lo.</CardDescription>
        </CardHeader>
        <CardContent>
          {canWrite ? (
            <ActionForm
              action={updateSupplierAction}
              orgSlug={ctx.orgSlug}
              hidden={{ id: supplier.id }}
              resetOnSuccess={false}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField name="name" label="Nome / Razão social" defaultValue={supplier.name} required />
                <FormField name="document" label="CNPJ" defaultValue={v(supplier.document)} />
                <FormField name="email" label="E-mail" type="email" defaultValue={v(supplier.email)} />
                <FormField name="phone" label="Telefone" defaultValue={v(supplier.phone)} />
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
            <CardTitle>Excluir fornecedor</CardTitle>
            <CardDescription>Só é possível sem contas a pagar em aberto.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={deleteSupplierAction}
              orgSlug={ctx.orgSlug}
              hidden={{ id: supplier.id }}
              submitLabel="Excluir fornecedor"
              submitVariant="destructive"
              confirmMessage={`Excluir "${supplier.name}"?`}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
