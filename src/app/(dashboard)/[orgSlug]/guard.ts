import "server-only";
import { notFound } from "next/navigation";
import { tenantDb } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";

/**
 * Para páginas: valida sessão + membership + permissão de leitura e devolve
 * o contexto e o client isolado pelo tenant. Sem permissão → 404.
 */
export async function loadPage(orgSlug: string, permission: Permission) {
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx.role, permission)) notFound();
  return { ctx, db: tenantDb(ctx.organizationId) };
}
