"use server";

import { createAction } from "@/lib/action";
import { emptySchema, subscribeSchema } from "./schemas";
import { cancelSubscription, getOpenInvoiceUrl, subscribeToPlan } from "./service";

/** Somente OWNER (billing:manage). Retorna o link da fatura do Asaas. */
export const subscribeAction = createAction({
  schema: subscribeSchema,
  permission: "billing:manage",
  revalidate: "/config",
  handler: ({ ctx, input }) => subscribeToPlan(ctx, input),
});

export const cancelSubscriptionAction = createAction({
  schema: emptySchema,
  permission: "billing:manage",
  revalidate: "/config",
  successMessage: "Assinatura cancelada. O plano continua valendo até o fim do período pago.",
  handler: ({ ctx }) => cancelSubscription(ctx),
});

export const openInvoiceAction = createAction({
  schema: emptySchema,
  permission: "billing:manage",
  handler: async ({ ctx }) => ({ paymentUrl: await getOpenInvoiceUrl(ctx) }),
});
