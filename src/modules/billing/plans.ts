import type { Plan } from "@/generated/prisma/enums";

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
