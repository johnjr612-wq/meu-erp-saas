import "server-only";
import type { Plan } from "@/generated/prisma/enums";
import { prisma, type TenantTx } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import type { OrgContext } from "@/lib/session";
import { asaas } from "./asaas-client";
import { effectivePlan, PLANS, type PlanLimits } from "./plans";

/** Verifica limite do plano antes de criar recursos. Chame dentro da transação da criação. */
export async function assertPlanLimit(tx: TenantTx, ctx: OrgContext, resource: keyof PlanLimits) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { plan: true, subscriptionStatus: true, currentPeriodEnd: true },
  });

  if (org.subscriptionStatus === "PAST_DUE") {
    throw new DomainError("Pagamento em atraso. Regularize em Configurações › Assinatura para continuar cadastrando.");
  }

  const plan = effectivePlan(org);
  const limit = PLANS[plan].limits[resource];
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
    case "members": {
      // membros atuais + convites ainda válidos (evita estourar o limite via convites)
      const [members, pendingInvites] = await Promise.all([
        prisma.membership.count({ where: { organizationId: ctx.organizationId } }),
        tx.invitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
      ]);
      used = members + pendingInvites;
      break;
    }
  }

  if (used >= limit) {
    throw new DomainError(`Limite do plano ${PLANS[plan].name} atingido (${limit}). Faça upgrade para continuar.`);
  }
}

/** Data de hoje (YYYY-MM-DD) no fuso de Brasília, formato exigido pelo Asaas. */
function todayInBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

async function audit(ctx: OrgContext, action: string, after: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      entity: "Organization",
      entityId: ctx.organizationId,
      action,
      after: JSON.parse(JSON.stringify(after)),
    },
  });
}

/**
 * Contrata ou troca de plano pago. Cria o cliente e a assinatura no Asaas
 * (cobrança mensal; o cliente escolhe Pix, boleto ou cartão na fatura) e
 * devolve o link da fatura em aberto. O plano só muda quando o webhook
 * confirmar o pagamento (fica em `pendingPlan` até lá).
 */
export async function subscribeToPlan(ctx: OrgContext, input: { plan: Plan; cpfCnpj: string }) {
  if (input.plan === "FREE") throw new DomainError("Para voltar ao plano Grátis, cancele a assinatura.");
  const planInfo = PLANS[input.plan];

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  const hasLiveSubscription = !!org.asaasSubscriptionId && org.subscriptionStatus !== "CANCELED";
  if (hasLiveSubscription && org.plan === input.plan && !org.pendingPlan && org.subscriptionStatus === "ACTIVE") {
    throw new DomainError(`Você já está no plano ${planInfo.name}.`);
  }

  // 1) Cliente no Asaas (reaproveitado nas próximas assinaturas)
  let customerId = org.asaasCustomerId;
  if (!customerId) {
    const created = await asaas.createCustomer({
      name: org.name,
      cpfCnpj: input.cpfCnpj,
      externalReference: org.id,
    });
    // condicional: em clique duplo, só o primeiro cliente criado é gravado
    const saved = await prisma.organization.updateMany({
      where: { id: org.id, asaasCustomerId: null },
      data: { asaasCustomerId: created.id, document: input.cpfCnpj },
    });
    customerId = saved.count === 1
      ? created.id
      : (await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).asaasCustomerId!;
  } else if (org.document !== input.cpfCnpj) {
    await asaas.updateCustomer(customerId, { cpfCnpj: input.cpfCnpj });
    await prisma.organization.update({ where: { id: org.id }, data: { document: input.cpfCnpj } });
  }

  // 2) Assinatura: troca de valor na existente ou cria uma nova
  const description = `Meu ERP — plano ${planInfo.name}`;
  const externalReference = `plan:${input.plan}`;
  let subscriptionId: string;
  if (hasLiveSubscription) {
    subscriptionId = org.asaasSubscriptionId!;
    await asaas.updateSubscription(subscriptionId, { valueCents: planInfo.priceCents, description, externalReference });
  } else {
    const sub = await asaas.createSubscription({
      customer: customerId,
      valueCents: planInfo.priceCents,
      nextDueDate: todayInBrazil(),
      description,
      externalReference,
    });
    subscriptionId = sub.id;
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: { asaasSubscriptionId: subscriptionId, pendingPlan: input.plan },
  });
  await audit(ctx, "SUBSCRIBE", { plan: input.plan, subscriptionId, changedExisting: hasLiveSubscription });

  // 3) Fatura em aberto mais antiga → página de pagamento do Asaas
  const pending = await asaas.listPendingPayments(subscriptionId);
  pending.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { paymentUrl: pending[0]?.invoiceUrl ?? null };
}

/**
 * Cancela a assinatura no Asaas. O plano pago continua valendo até
 * `currentPeriodEnd` (ver `effectivePlan`); depois disso vira FREE.
 */
export async function cancelSubscription(ctx: OrgContext) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  if (!org.asaasSubscriptionId || org.subscriptionStatus === "CANCELED") {
    throw new DomainError("Não há assinatura ativa para cancelar.");
  }

  await asaas.cancelSubscription(org.asaasSubscriptionId);
  await prisma.organization.update({
    where: { id: org.id },
    data: { subscriptionStatus: "CANCELED", pendingPlan: null },
  });
  await audit(ctx, "CANCEL_SUBSCRIPTION", {
    subscriptionId: org.asaasSubscriptionId,
    plan: org.plan,
    validUntil: org.currentPeriodEnd,
  });
}

/** Link da fatura em aberto (para quem fechou a aba antes de pagar). */
export async function getOpenInvoiceUrl(ctx: OrgContext): Promise<string | null> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  if (!org.asaasSubscriptionId || org.subscriptionStatus === "CANCELED") return null;
  const pending = await asaas.listPendingPayments(org.asaasSubscriptionId);
  pending.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return pending[0]?.invoiceUrl ?? null;
}
