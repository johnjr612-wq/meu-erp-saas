import "server-only";
import type { TenantTx } from "@/lib/db";
import type { OrgContext } from "@/lib/session";

type JsonLike = Record<string, unknown> | null | undefined;

/** Serializa Decimals/Dates para JSON puro antes de gravar no AuditLog. */
function toJson(value: JsonLike) {
  if (value == null) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export async function writeAudit(
  tx: TenantTx,
  ctx: OrgContext,
  entry: { entity: string; entityId: string; action: string; before?: JsonLike; after?: JsonLike },
) {
  await tx.auditLog.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      before: toJson(entry.before),
      after: toJson(entry.after),
    },
  });
}
