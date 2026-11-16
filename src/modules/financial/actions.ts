"use server";

import { createAction } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import {
  cancelEntrySchema,
  createBankAccountSchema,
  createEntrySchema,
  reconcilePaymentSchema,
  reversePaymentSchema,
  settleEntrySchema,
} from "./schemas";
import { cancelEntry, createEntry, reconcilePayment, reversePayment, settleEntry } from "./service";

export const createEntryAction = createAction({
  schema: createEntrySchema,
  permission: "financial:write",
  revalidate: "/financeiro",
  successMessage: "Título lançado.",
  handler: async ({ ctx, db, input }) => {
    const entry = await createEntry(db, ctx, input);
    return { id: entry.id };
  },
});

export const settleEntryAction = createAction({
  schema: settleEntrySchema,
  permission: "financial:settle",
  revalidate: "/financeiro",
  successMessage: "Baixa registrada.",
  handler: async ({ ctx, db, input }) => {
    const payment = await settleEntry(db, ctx, input);
    return { id: payment.id };
  },
});

export const reversePaymentAction = createAction({
  schema: reversePaymentSchema,
  permission: "financial:settle",
  revalidate: "/financeiro",
  successMessage: "Baixa estornada.",
  handler: ({ ctx, db, input }) => reversePayment(db, ctx, input.paymentId, input.reason),
});

export const cancelEntryAction = createAction({
  schema: cancelEntrySchema,
  permission: "financial:write",
  revalidate: "/financeiro",
  successMessage: "Título cancelado.",
  handler: ({ ctx, db, input }) => cancelEntry(db, ctx, input.entryId, input.reason),
});

export const reconcilePaymentAction = createAction({
  schema: reconcilePaymentSchema,
  permission: "financial:reconcile",
  revalidate: "/financeiro",
  successMessage: "Baixa conciliada.",
  handler: ({ ctx, db, input }) => reconcilePayment(db, ctx, input.paymentId, input.externalId),
});

export const createBankAccountAction = createAction({
  schema: createBankAccountSchema,
  permission: "financial:write",
  revalidate: "/financeiro",
  successMessage: "Conta criada.",
  handler: async ({ ctx, db, input }) =>
    db.$transaction(async (tx) => {
      const account = await tx.bankAccount.create({
        data: { organizationId: ctx.organizationId, ...input, createdBy: ctx.userId, updatedBy: ctx.userId },
      });
      await writeAudit(tx, ctx, { entity: "BankAccount", entityId: account.id, action: "CREATE", after: account });
      return { id: account.id };
    }),
});
