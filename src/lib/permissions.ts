import type { Role } from "@/generated/prisma/enums";

export type Permission =
  | "dashboard:read"
  | "registry:read"
  | "registry:write"
  | "sales:read"
  | "sales:write"
  | "sales:confirm"
  | "inventory:read"
  | "inventory:write"
  | "production:write"
  | "financial:read"
  | "financial:write"
  | "financial:settle"
  | "financial:reconcile"
  | "config:members"
  | "billing:manage";

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: [
    "dashboard:read",
    "registry:read",
    "registry:write",
    "sales:read",
    "sales:write",
    "sales:confirm",
    "inventory:read",
    "inventory:write",
    "production:write",
    "financial:read",
    "financial:write",
    "financial:settle",
    "financial:reconcile",
    "config:members",
    "billing:manage",
  ],
  ADMIN: [
    "dashboard:read",
    "registry:read",
    "registry:write",
    "sales:read",
    "sales:write",
    "sales:confirm",
    "inventory:read",
    "inventory:write",
    "production:write",
    "financial:read",
    "financial:write",
    "financial:settle",
    "financial:reconcile",
    "config:members",
  ],
  FINANCIAL: [
    "dashboard:read",
    "registry:read",
    "registry:write",
    "sales:read",
    "inventory:read",
    "financial:read",
    "financial:write",
    "financial:settle",
    "financial:reconcile",
  ],
  OPERATOR: [
    "dashboard:read",
    "registry:read",
    "registry:write",
    "sales:read",
    "sales:write",
    "inventory:read",
    "inventory:write",
    "production:write",
  ],
};

export class ForbiddenError extends Error {
  constructor(message = "Você não tem permissão para esta ação.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function assertPermission(ctx: { role: Role }, permission: Permission): void {
  if (!can(ctx.role, permission)) throw new ForbiddenError();
}
