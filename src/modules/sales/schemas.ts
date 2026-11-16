import { z } from "zod";
import { centsField, quantityField } from "@/lib/money";

export const createSalesOrderSchema = z.object({
  customerId: z.string().min(1),
  discountCents: centsField.default(0),
  notes: z.string().max(1000).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: quantityField.refine((v) => Number(v) > 0, "Quantidade deve ser positiva"),
      }),
    )
    .min(1, "Inclua ao menos um item"),
});

export const confirmSalesOrderSchema = z.object({
  salesOrderId: z.string().min(1),
  dueDate: z.coerce.date(),
});

export const cancelSalesOrderSchema = z.object({
  salesOrderId: z.string().min(1),
});

export const updateQuoteSchema = createSalesOrderSchema.extend({ salesOrderId: z.string().min(1) });
