import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";

export type OrgContext = {
  userId: string;
  organizationId: string;
  orgSlug: string;
  orgName: string;
  role: Role;
};

export class UnauthorizedError extends Error {
  constructor(message = "Sessão expirada. Faça login novamente.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Retorna o userId da sessão ou null. */
export const getSessionUserId = cache(async (): Promise<string | null> => {
  const session = await auth();
  return session?.user?.id ?? null;
});

/**
 * Resolve o contexto da organização a partir do slug, VALIDANDO que o usuário
 * logado é membro. Nunca confie em organizationId vindo do cliente.
 */
export const getOrgContext = cache(async (orgSlug: string): Promise<OrgContext | null> => {
  const userId = await getSessionUserId();
  if (!userId) throw new UnauthorizedError();

  const membership = await prisma.membership.findFirst({
    where: { userId, organization: { slug: orgSlug } },
    select: { role: true, organization: { select: { id: true, slug: true, name: true } } },
  });
  if (!membership) return null;

  return {
    userId,
    organizationId: membership.organization.id,
    orgSlug: membership.organization.slug,
    orgName: membership.organization.name,
    role: membership.role,
  };
});

/** Para Server Components: redireciona para login / 404 quando não autorizado. */
export async function requireOrgContext(orgSlug: string): Promise<OrgContext> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const ctx = await getOrgContext(orgSlug);
  if (!ctx) notFound(); // não revela a existência de orgs de terceiros
  return ctx;
}
