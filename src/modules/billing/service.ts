import "server-only";
import { prisma, type TenantTx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import type { OrgContext } from "@/lib/session";
import { PLANS, type PlanLimits } from "./plans";

/** Verifica limite do plano antes de criar recursos. Chame dentro da transação da criação. */
export async function assertPlanLimit(tx: TenantTx, ctx: OrgContext, resource: keyof PlanLimits) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { plan: true, subscriptionStatus: true },
  });

  if (org.subscriptionStatus === "CANCELED" || org.subscriptionStatus === "PAST_DUE") {
    throw new DomainError("Assinatura inativa. Regularize o pagamento em Configurações > Assinatura.");
  }

  const limit = PLANS[org.plan].limits[resource];
  let used: number;
  switch (resource) {
    case "products":
      used = await tx.product.count();
      break;
    case "salesOrdersPerMonth": {
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      used = await tx.salesOrder.count({ where: { createdAt: { gte: start } } });
      break;
    }
    case "members":
      used = await prisma.membership.count({ where: { organizationId: ctx.organizationId } });
      break;
  }

  if (used >= limit) {
    throw new DomainError(
      `Limite do plano ${PLANS[org.plan].name} atingido (${limit}). Faça upgrade para continuar.`,
    );
  }
}
