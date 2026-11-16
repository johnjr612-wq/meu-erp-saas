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
import { PLANS } from "@/modules/billing/plans";
import {
  changeMemberRoleAction,
  createInvitationAction,
  removeMemberAction,
  revokeInvitationAction,
} from "@/modules/members/actions";
import { assignableRoles, canAssignRole, canManageMember } from "@/modules/members/roles";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Configurações" };

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
  const plan = PLANS[org.plan];
  const roles = assignableRoles(ctx.role);

  return (
    <>
      <PageHeader title="Configurações" description="Usuários, permissões e assinatura." />

      {canBilling && (
        <Card>
          <CardHeader>
            <CardTitle>Assinatura</CardTitle>
            <CardDescription>
              Plano {plan.name} · {plan.priceCents ? `${formatCents(plan.priceCents)}/mês` : "grátis"} · status{" "}
              <Badge variant={org.subscriptionStatus === "ACTIVE" ? "default" : "secondary"}>{org.subscriptionStatus}</Badge>
              {org.currentPeriodEnd && <> · renova em {formatDate(org.currentPeriodEnd)}</>}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Limites: {plan.limits.members} usuários · {plan.limits.products} produtos ·{" "}
            {plan.limits.salesOrdersPerMonth} pedidos/mês.
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
