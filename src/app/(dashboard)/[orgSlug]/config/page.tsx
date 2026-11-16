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
import { PLANS } from "@/modules/billing/plans";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfigPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const canMembers = can(ctx.role, "config:members");
  const canBilling = can(ctx.role, "billing:manage");
  if (!canMembers && !canBilling) notFound();

  // Dados de plataforma (Organization/Membership) — filtrados explicitamente pelo organizationId da sessão.
  const [org, members] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } }),
    canMembers
      ? prisma.membership.findMany({
          where: { organizationId: ctx.organizationId },
          include: { user: { select: { name: true, email: true } } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const plan = PLANS[org.plan];

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
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.user.name}</TableCell>
                    <TableCell>{m.user.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{LABELS.role[m.role]}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(m.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
