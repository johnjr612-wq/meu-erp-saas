import type { Role } from "@/generated/prisma/enums";

/**
 * Quem pode conceder/gerenciar qual cargo.
 * - OWNER é único e nunca é convidado, alterado ou removido por aqui.
 * - ADMIN não gerencia outros ADMINs (só o OWNER).
 */
const ASSIGNABLE: Record<Role, readonly Role[]> = {
  OWNER: ["ADMIN", "FINANCIAL", "OPERATOR"],
  ADMIN: ["FINANCIAL", "OPERATOR"],
  FINANCIAL: [],
  OPERATOR: [],
};

export function assignableRoles(actor: Role): readonly Role[] {
  return ASSIGNABLE[actor];
}

export function canAssignRole(actor: Role, role: Role): boolean {
  return ASSIGNABLE[actor].includes(role);
}

/** O ator pode alterar/remover um membro com este cargo? (Nunca a si mesmo.) */
export function canManageMember(
  actor: { role: Role; userId: string },
  target: { role: Role; userId: string },
): boolean {
  return target.userId !== actor.userId && canAssignRole(actor.role, target.role);
}
