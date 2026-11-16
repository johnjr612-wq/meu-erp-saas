import { z } from "zod";
import { centsField, quantityField } from "@/lib/money";

export const manualMovementSchema = z.object({
  productId: z.string().min(1),
  type: z.enum(["IN", "OUT", "ADJUSTMENT"]),
  /** Para IN/OUT informe valor positivo; para ADJUSTMENT, o sinal define a direção. */
  quantity: quantityField,
  unitCostCents: centsField.optional(),
  lot: z.string().max(60).optional(),
  reason: z.string().max(500).optional(),
});

export const createProductionOrderSchema = z.object({
  formulaId: z.string().min(1),
  quantity: quantityField.refine((v) => Number(v) > 0, "Quantidade deve ser positiva"),
  lot: z.string().min(1).max(60),
  expiresAt: z.coerce.date().optional(),
});

export const productionOrderIdSchema = z.object({
  productionOrderId: z.string().min(1),
});

export const createFormulaSchema = z.object({
  productId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  yieldQuantity: quantityField.refine((v) => Number(v) > 0, "Rendimento deve ser positivo"),
  instructions: z.string().max(5000).optional(),
  items: z
    .array(
      z.object({
        componentId: z.string().min(1),
        quantity: quantityField.refine((v) => Number(v) > 0, "Quantidade deve ser positiva"),
      }),
    )
    .min(1, "Inclua ao menos um insumo"),
});
