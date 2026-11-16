import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@/generated/prisma/enums";
import { writeAudit } from "@/lib/audit";
import { prisma, type TenantDb } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { escapeHtml, sendMail } from "@/lib/mailer";
import type { OrgContext } from "@/lib/session";
import { assertPlanLimit } from "@/modules/billing/service";
import { canAssignRole, canManageMember } from "./roles";

export const INVITATION_TTL_DAYS = 7;

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  FINANCIAL: "Financeiro",
  OPERATOR: "Operador",
};

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// -----------------------------------------------------------------------------
// Convites (lado da organização) — usam o client isolado pelo tenant
// -----------------------------------------------------------------------------

export async function createInvitation(
  db: TenantDb,
  ctx: OrgContext,
  input: { email: string; role: Role; baseUrl: string },
) {
  if (!canAssignRole(ctx.role, input.role)) {
    throw new DomainError("Você não pode convidar alguém com esse cargo.");
  }

  const alreadyMember = await prisma.membership.findFirst({
    where: { organizationId: ctx.organizationId, user: { email: input.email } },
    select: { id: true },
  });
  if (alreadyMember) throw new DomainError("Essa pessoa já faz parte da empresa.");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await db.$transaction(async (tx) => {
    // reenviar convite: o anterior pendente para o mesmo e-mail é revogado
    await tx.invitation.updateMany({
      where: { email: input.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy: ctx.userId },
    });
    await assertPlanLimit(tx, ctx, "members");

    const created = await tx.invitation.create({
      data: {
        organizationId: ctx.organizationId,
        email: input.email,
        role: input.role,
        tokenHash: hashInviteToken(token),
        invitedBy: ctx.userId,
        expiresAt,
      },
    });
    await writeAudit(tx, ctx, {
      entity: "Invitation",
      entityId: created.id,
      action: "INVITE",
      after: { email: created.email, role: created.role, expiresAt },
    });
    return created;
  });

  const inviteUrl = `${input.baseUrl.replace(/\/$/, "")}/convite/${token}`;
  const org = escapeHtml(ctx.orgName);
  const emailSent = await sendMail({
    to: input.email,
    subject: `Convite para ${ctx.orgName}`,
    text: `Você foi convidado(a) para ${ctx.orgName} como ${ROLE_LABEL[input.role]}. Acesse: ${inviteUrl} (válido por ${INVITATION_TTL_DAYS} dias).`,
    html: `<p>Você foi convidado(a) para <strong>${org}</strong> como <strong>${ROLE_LABEL[input.role]}</strong>.</p>
<p><a href="${escapeHtml(inviteUrl)}">Aceitar convite</a></p>
<p>O link é válido por ${INVITATION_TTL_DAYS} dias.</p>`,
  });

  return { invitationId: invitation.id, inviteUrl, emailSent };
}

export async function revokeInvitation(db: TenantDb, ctx: OrgContext, invitationId: string) {
  await db.$transaction(async (tx) => {
    const inv = await tx.invitation.findFirst({ where: { id: invitationId } });
    if (!inv) throw new DomainError("Convite não encontrado.");
    if (inv.acceptedAt || inv.revokedAt) throw new DomainError("Convite já utilizado ou revogado.");
    if (!canAssignRole(ctx.role, inv.role)) throw new DomainError("Você não pode revogar este convite.");

    await tx.invitation.update({
      where: { id: inv.id },
      data: { revokedAt: new Date(), revokedBy: ctx.userId },
    });
    await writeAudit(tx, ctx, { entity: "Invitation", entityId: inv.id, action: "REVOKE", before: { email: inv.email } });
  });
}

// -----------------------------------------------------------------------------
// Membros — Membership é tabela de plataforma: filtro explícito por organizationId
// -----------------------------------------------------------------------------

async function findManageableMember(ctx: OrgContext, membershipId: string) {
  const member = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: ctx.organizationId },
    include: { user: { select: { email: true } } },
  });
  if (!member) throw new DomainError("Membro não encontrado.");
  if (!canManageMember(ctx, member)) throw new DomainError("Você não pode alterar este membro.");
  return member;
}

export async function changeMemberRole(ctx: OrgContext, membershipId: string, role: Role) {
  const member = await findManageableMember(ctx, membershipId);
  if (!canAssignRole(ctx.role, role)) throw new DomainError("Você não pode conceder esse cargo.");
  if (member.role === role) return;

  await prisma.$transaction(async (tx) => {
    // organizationId no where: nunca toca membership de outra org
    const updated = await tx.membership.updateMany({
      where: { id: member.id, organizationId: ctx.organizationId, role: member.role },
      data: { role },
    });
    if (updated.count !== 1) throw new DomainError("O membro foi alterado por outra pessoa. Recarregue a página.");
    await tx.auditLog.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        entity: "Membership",
        entityId: member.id,
        action: "CHANGE_ROLE",
        before: { email: member.user.email, role: member.role },
        after: { role },
      },
    });
  });
}

export async function removeMember(ctx: OrgContext, membershipId: string) {
  const member = await findManageableMember(ctx, membershipId);

  await prisma.$transaction(async (tx) => {
    // O acesso cai na hora: toda requisição revalida a membership (getOrgContext).
    const removed = await tx.membership.deleteMany({
      where: { id: member.id, organizationId: ctx.organizationId, role: member.role },
    });
    if (removed.count !== 1) throw new DomainError("O membro foi alterado por outra pessoa. Recarregue a página.");
    await tx.auditLog.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        entity: "Membership",
        entityId: member.id,
        action: "REMOVE",
        before: { email: member.user.email, role: member.role },
      },
    });
  });
}

// -----------------------------------------------------------------------------
// Aceite (lado do convidado) — código de plataforma: busca pelo hash do token
// -----------------------------------------------------------------------------

export type InvitationView =
  | { status: "invalid" }
  | {
      status: "valid" | "expired" | "accepted" | "revoked";
      email: string;
      role: Role;
      orgName: string;
      orgSlug: string;
      expiresAt: Date;
    };

export async function getInvitationByToken(token: string): Promise<InvitationView> {
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { organization: { select: { name: true, slug: true } } },
  });
  if (!inv) return { status: "invalid" };

  const base = {
    email: inv.email,
    role: inv.role,
    orgName: inv.organization.name,
    orgSlug: inv.organization.slug,
    expiresAt: inv.expiresAt,
  };
  if (inv.revokedAt) return { ...base, status: "revoked" };
  if (inv.acceptedAt) return { ...base, status: "accepted" };
  if (inv.expiresAt <= new Date()) return { ...base, status: "expired" };
  return { ...base, status: "valid" };
}

/**
 * Aceita o convite para o usuário informado. Atômico: o convite só é marcado
 * como aceito se ainda estiver válido (protege contra duplo clique/concorrência).
 */
export async function acceptInvitation(token: string, user: { id: string; email: string }) {
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: { organization: { select: { slug: true } } },
    });
    if (!inv) throw new DomainError("Convite inválido.");
    if (inv.email !== user.email.toLowerCase()) {
      throw new DomainError(`Este convite é para ${inv.email}. Entre com essa conta para aceitar.`);
    }

    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date(), acceptedBy: user.id },
    });
    if (claimed.count !== 1) throw new DomainError("Convite expirado, revogado ou já utilizado.");

    const existing = await tx.membership.findUnique({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } },
    });
    if (existing) throw new DomainError("Você já faz parte desta empresa.");

    const membership = await tx.membership.create({
      data: { organizationId: inv.organizationId, userId: user.id, role: inv.role },
    });
    await tx.auditLog.create({
      data: {
        organizationId: inv.organizationId,
        userId: user.id,
        entity: "Membership",
        entityId: membership.id,
        action: "ACCEPT_INVITE",
        after: { invitationId: inv.id, email: inv.email, role: inv.role },
      },
    });
    return { orgSlug: inv.organization.slug };
  });
}
