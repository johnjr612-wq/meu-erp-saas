import { z } from "zod";
import { centsField } from "@/lib/money";

const positiveCents = centsField.refine((v) => v > 0, "Valor deve ser maior que zero");

export const createEntrySchema = z.object({
  type: z.enum(["RECEIVABLE", "PAYABLE"]),
  description: z.string().min(2).max(200),
  category: z.string().max(80).optional(),
  amountCents: positiveCents,
  dueDate: z.coerce.date(),
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  documentNumber: z.string().max(60).optional(),
});

export const settleEntrySchema = z.object({
  entryId: z.string().min(1),
  bankAccountId: z.string().min(1),
  amountCents: positiveCents,
  method: z.enum(["PIX", "BOLETO", "CASH", "CREDIT_CARD", "DEBIT_CARD", "TRANSFER"]),
  paidAt: z.coerce.date().default(() => new Date()),
  externalId: z.string().max(120).optional(),
});

export const reversePaymentSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().min(3).max(300),
});

export const cancelEntrySchema = z.object({
  entryId: z.string().min(1),
  reason: z.string().min(3).max(300),
});

export const reconcilePaymentSchema = z.object({
  paymentId: z.string().min(1),
  externalId: z.string().min(1).max(120),
});

export const createBankAccountSchema = z.object({
  name: z.string().min(2).max(80),
  openingBalanceCents: centsField.default(0),
});
