import type { Plan, SubscriptionStatus } from "@/generated/prisma/enums";

export type PlanLimits = {
  members: number;
  products: number;
  salesOrdersPerMonth: number;
};

export const PLANS: Record<Plan, { name: string; priceCents: number; limits: PlanLimits; features: string[] }> = {
  FREE: {
    name: "Grátis",
    priceCents: 0,
    limits: { members: 1, products: 30, salesOrdersPerMonth: 50 },
    features: ["1 usuário", "30 produtos", "50 pedidos/mês", "Estoque e financeiro básicos"],
  },
  STARTER: {
    name: "Starter",
    priceCents: 9900,
    limits: { members: 5, products: 500, salesOrdersPerMonth: 1000 },
    features: ["5 usuários", "500 produtos", "1.000 pedidos/mês", "Produção com fórmulas e lotes"],
  },
  PRO: {
    name: "Pro",
    priceCents: 24900,
    limits: { members: 50, products: 100_000, salesOrdersPerMonth: 100_000 },
    features: ["50 usuários", "Produtos ilimitados", "Pedidos ilimitados", "Conciliação bancária"],
  },
};

/**
 * Plano que vale AGORA. Assinatura cancelada mantém o plano pago até o fim
 * do período já pago (currentPeriodEnd); depois disso volta ao FREE.
 * Calculado na hora — não depende de job agendado.
 */
export function effectivePlan(
  org: { plan: Plan; subscriptionStatus: SubscriptionStatus; currentPeriodEnd: Date | null },
  now: Date = new Date(),
): Plan {
  if (org.plan === "FREE") return "FREE";
  if (org.subscriptionStatus === "CANCELED" && (!org.currentPeriodEnd || org.currentPeriodEnd <= now)) {
    return "FREE";
  }
  return org.plan;
}
