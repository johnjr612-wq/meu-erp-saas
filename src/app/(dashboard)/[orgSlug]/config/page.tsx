import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { formatDate, LABELS } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";
import { ActionForm } from "@/components/forms/action-form";
import { EmptyRow } from "@/components/layout/page-header";
import { NativeSelect } from "@/components/ui/input";
import { tenantDb } from "@/lib/db";
import { cancelSubscriptionAction, openInvoiceAction, subscribeAction } from "@/modules/billing/actions";
import { effectivePlan, PLANS } from "@/modules/billing/plans";
import {
  changeMemberRoleAction,
  createInvitationAction,
  removeMemberAction,
  revokeInvitationAction,
} from "@/modules/members/actions";
import { assignableRoles, canAssignRole, canManageMember } from "@/modules/members/roles";
import { OpenInvoiceButton, SubscribeForm } from "./billing-forms";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Configurações" };

const fmtInt = (n: number) => new Intl.NumberFormat("pt-BR").format(n);

export default async function ConfigPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const canMembers = can(ctx.role, "config:members");
  const canBilling = can(ctx.role, "billing:manage");
  if (!canMembers && !canBilling) notFound();

  // Dados de plataforma (Organization/Membership) — filtrados explicitamente pelo organizationId da sessão.
  const [org, members, invitations] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } }),
    canMembers
      ? prisma.membership.findMany({
          where: { organizationId: ctx.organizationId },
          include: { user: { select: { name: true, email: true } } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    canMembers
      ? tenantDb(ctx.organizationId).invitation.findMany({
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);
  const effective = effectivePlan(org);
  const plan = PLANS[effective];
  const hasLiveSubscription = !!org.asaasSubscriptionId && org.subscriptionStatus !== "CANCELED";
  const STATUS = {
    TRIALING: { label: "Sem assinatura", variant: "secondary" },
    ACTIVE: { label: "Ativa", variant: "default" },
    PAST_DUE: { label: "Em atraso", variant: "destructive" },
    CANCELED: { label: "Cancelada", variant: "outline" },
  } as const;
  const statusInfo = STATUS[org.subscriptionStatus];
  const roles = assignableRoles(ctx.role);

  return (
    <>
      <PageHeader title="Configurações" description="Usuários, permissões e assinatura." />

      {canBilling && (
        <Card>
          <CardHeader>
            <CardTitle>Assinatura</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                Plano atual: <strong className="text-foreground">{plan.name}</strong>
              </span>
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              {org.currentPeriodEnd && effective !== "FREE" && (
                <span>
                  {org.subscriptionStatus === "CANCELED" ? "válido até" : "pago até"} {formatDate(org.currentPeriodEnd)}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <p className="text-sm text-muted-foreground">
              Limites: {fmtInt(plan.limits.members)} usuários · {fmtInt(plan.limits.products)} produtos ·{" "}
              {fmtInt(plan.limits.salesOrdersPerMonth)} pedidos/mês.
            </p>

            {org.subscriptionStatus === "PAST_DUE" && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Pagamento em atraso: novos cadastros estão bloqueados até a fatura ser paga.
              </p>
            )}
            {org.pendingPlan && (
              <p className="rounded-md border p-3 text-sm">
                Aguardando o pagamento para ativar o plano <strong>{PLANS[org.pendingPlan].name}</strong>. A
                confirmação de Pix e cartão é automática; boleto leva até 3 dias úteis.
              </p>
            )}
            {(org.pendingPlan || org.subscriptionStatus === "PAST_DUE") && hasLiveSubscription && (
              <OpenInvoiceButton action={openInvoiceAction} orgSlug={ctx.orgSlug} />
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {(["STARTER", "PRO"] as const).map((key) => {
                const p = PLANS[key];
                const isCurrent = effective === key && org.subscriptionStatus === "ACTIVE" && !org.pendingPlan;
                return (
                  <div key={key} className="grid content-start gap-3 rounded-lg border p-4">
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-semibold">{p.name}</h3>
                      <span className="font-semibold tabular-nums">
                        {formatCents(p.priceCents)}
                        <span className="text-xs font-normal text-muted-foreground">/mês</span>
                      </span>
                    </div>
                    <ul className="grid gap-1 text-sm text-muted-foreground">
                      {p.features.map((f) => (
                        <li key={f}>· {f}</li>
                      ))}
                    </ul>
                    {isCurrent ? (
                      <Badge variant="outline">Seu plano</Badge>
                    ) : (
                      <SubscribeForm
                        action={subscribeAction}
                        orgSlug={ctx.orgSlug}
                        plan={key}
                        label={hasLiveSubscription ? `Mudar para ${p.name}` : `Assinar ${p.name}`}
                        defaultDocument={org.document}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {hasLiveSubscription && (
              <ActionForm
                action={cancelSubscriptionAction}
                orgSlug={ctx.orgSlug}
                submitLabel="Cancelar assinatura"
                submitVariant="outline"
                confirmMessage="Cancelar a assinatura? Você mantém o plano até o fim do período pago e depois volta ao Grátis."
              />
            )}
          </CardContent>
        </Card>
      )}

      {canMembers && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Convidar pessoa</CardTitle>
              <CardDescription>
                {members.length + invitations.length} de {plan.limits.members} usuários do plano (incluindo convites
                pendentes). O convite vale por 7 dias.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InviteForm action={createInvitationAction} orgSlug={ctx.orgSlug} roles={roles} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Convites pendentes</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead>Expira em</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.length === 0 && <EmptyRow colSpan={4}>Nenhum convite pendente.</EmptyRow>}
                  {invitations.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{LABELS.role[inv.role]}</Badge>
                      </TableCell>
                      <TableCell>{formatDate(inv.expiresAt)}</TableCell>
                      <TableCell className="text-right">
                        {canAssignRole(ctx.role, inv.role) && (
                          <ActionForm
                            action={revokeInvitationAction}
                            orgSlug={ctx.orgSlug}
                            hidden={{ invitationId: inv.id }}
                            submitLabel="Revogar"
                            submitVariant="outline"
                            className="flex justify-end"
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usuários</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead>Desde</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => {
                    const manageable = canManageMember(ctx, m);
                    return (
                      <TableRow key={m.id}>
                        <TableCell>
                          {m.user.name}
                          {m.userId === ctx.userId && <span className="text-muted-foreground"> (você)</span>}
                        </TableCell>
                        <TableCell>{m.user.email}</TableCell>
                        <TableCell>
                          {manageable ? (
                            <ActionForm
                              action={changeMemberRoleAction}
                              orgSlug={ctx.orgSlug}
                              hidden={{ membershipId: m.id }}
                              submitLabel="Alterar"
                              submitVariant="outline"
                              className="flex items-center gap-2"
                            >
                              <NativeSelect name="role" defaultValue={m.role} aria-label="Cargo" className="w-40">
                                {roles.map((r) => (
                                  <option key={r} value={r}>
                                    {LABELS.role[r]}
                                  </option>
                                ))}
                              </NativeSelect>
                            </ActionForm>
                          ) : (
                            <Badge variant="secondary">{LABELS.role[m.role]}</Badge>
                          )}
                        </TableCell>
                        <TableCell>{formatDate(m.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          {manageable && (
                            <ActionForm
                              action={removeMemberAction}
                              orgSlug={ctx.orgSlug}
                              hidden={{ membershipId: m.id }}
                              submitLabel="Remover"
                              submitVariant="destructive"
                              confirmMessage={`Remover ${m.user.name} da empresa? O acesso será bloqueado imediatamente.`}
                              className="flex justify-end"
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
