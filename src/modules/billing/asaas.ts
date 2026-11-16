import "server-only";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { Plan } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

/** Payload mínimo dos webhooks de cobrança do Asaas que nos interessam. */
export const asaasWebhookSchema = z.object({
  id: z.string(), // id do evento (idempotência)
  event: z.string(),
  payment: z
    .object({
      id: z.string(),
      customer: z.string(),
      subscription: z.string().nullish(),
      value: z.number(),
      dueDate: z.string().optional(),
      externalReference: z.string().nullish(), // usamos "plan:STARTER"
    })
    .optional(),
  subscription: z
    .object({
      id: z.string(),
      customer: z.string(),
      externalReference: z.string().nullish(),
    })
    .optional(),
});

export type AsaasWebhook = z.infer<typeof asaasWebhookSchema>;

/** Compara o token do header `asaas-access-token` em tempo constante. */
export function isValidAsaasToken(received: string | null): boolean {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function planFromReference(ref: string | null | undefined): Plan | null {
  const match = /^plan:(FREE|STARTER|PRO)$/.exec(ref ?? "");
  return (match?.[1] as Plan | undefined) ?? null;
}

function addOneMonth(date: Date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * Processa o evento de forma idempotente: o mesmo `id` de evento nunca é aplicado duas vezes.
 * Retorna "duplicate" quando já processado.
 */
export async function processAsaasWebhook(event: AsaasWebhook): Promise<"processed" | "duplicate" | "ignored"> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.webhookEvent.findUnique({
      where: { provider_externalId: { provider: "asaas", externalId: event.id } },
    });
    if (existing?.processedAt) return "duplicate";

    const record =
      existing ??
      (await tx.webhookEvent.create({
        data: { provider: "asaas", externalId: event.id, eventType: event.event, payload: event },
      }));

    const customerId = event.payment?.customer ?? event.subscription?.customer;
    const org = customerId
      ? await tx.organization.findUnique({ where: { asaasCustomerId: customerId } })
      : null;

    let result: "processed" | "ignored" = "ignored";
    const eventSubscriptionId = event.payment?.subscription ?? event.subscription?.id ?? null;
    // Eventos de uma assinatura antiga (trocada/cancelada) não mexem na org.
    const isCurrentSubscription =
      !eventSubscriptionId || !org?.asaasSubscriptionId || eventSubscriptionId === org.asaasSubscriptionId;

    if (org && isCurrentSubscription) {
      let data: Prisma.OrganizationUpdateInput | null = null;

      switch (event.event) {
        case "PAYMENT_CONFIRMED":
        case "PAYMENT_RECEIVED": {
          const paidUntil = addOneMonth(event.payment?.dueDate ? new Date(`${event.payment.dueDate}T12:00:00Z`) : new Date());
          data = {
            subscriptionStatus: "ACTIVE",
            plan: org.pendingPlan ?? planFromReference(event.payment?.externalReference) ?? org.plan,
            pendingPlan: null,
            // nunca encurta um período já pago (eventos podem chegar fora de ordem)
            currentPeriodEnd:
              org.currentPeriodEnd && org.currentPeriodEnd > paidUntil ? org.currentPeriodEnd : paidUntil,
          };
          break;
        }
        case "PAYMENT_OVERDUE":
          // Só quem já pagava fica "em atraso". Quem nunca pagou a 1ª fatura segue no plano atual.
          if (org.subscriptionStatus === "ACTIVE") data = { subscriptionStatus: "PAST_DUE" };
          break;
        case "SUBSCRIPTION_DELETED":
        case "SUBSCRIPTION_INACTIVATED":
          // Mantém o plano até currentPeriodEnd (ver effectivePlan).
          data = { subscriptionStatus: "CANCELED", pendingPlan: null };
          break;
      }

      if (data) {
        await tx.organization.update({ where: { id: org.id }, data });
        result = "processed";
      }
    }

    await tx.webhookEvent.update({ where: { id: record.id }, data: { processedAt: new Date() } });
    return result;
  });
}
