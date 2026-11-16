"use server";

import { createAction } from "@/lib/action";
import {
  createFormulaSchema,
  createProductionOrderSchema,
  manualMovementSchema,
  formulaIdSchema,
  productionOrderIdSchema,
  updateFormulaSchema,
} from "./schemas";
import {
  cancelProductionOrder,
  completeProductionOrder,
  createFormula,
  createProductionOrder,
  deleteFormula,
  registerStockMovement,
  updateFormula,
} from "./service";

export const registerMovementAction = createAction({
  schema: manualMovementSchema,
  permission: "inventory:write",
  revalidate: "/estoque",
  successMessage: "Movimentação registrada.",
  handler: async ({ ctx, db, input }) => {
    const movement = await db.$transaction((tx) => registerStockMovement(tx, ctx, input));
    return { id: movement.id };
  },
});

export const createProductionOrderAction = createAction({
  schema: createProductionOrderSchema,
  permission: "production:write",
  revalidate: "/estoque",
  successMessage: "Ordem de produção criada.",
  handler: async ({ ctx, db, input }) => {
    const order = await createProductionOrder(db, ctx, input);
    return { id: order.id, number: order.number };
  },
});

export const completeProductionOrderAction = createAction({
  schema: productionOrderIdSchema,
  permission: "production:write",
  revalidate: "/estoque",
  successMessage: "Produção concluída e estoque atualizado.",
  handler: async ({ ctx, db, input }) => {
    const order = await completeProductionOrder(db, ctx, input.productionOrderId);
    return { id: order.id };
  },
});

export const createFormulaAction = createAction({
  schema: createFormulaSchema,
  permission: "production:write",
  revalidate: "/estoque",
  successMessage: "Fórmula cadastrada.",
  handler: async ({ ctx, db, input }) => {
    const formula = await createFormula(db, ctx, input);
    return { id: formula.id };
  },
});

export const updateFormulaAction = createAction({
  schema: updateFormulaSchema,
  permission: "production:write",
  revalidate: "/estoque",
  successMessage: "Fórmula atualizada.",
  handler: async ({ ctx, db, input }) => {
    const formula = await updateFormula(db, ctx, input);
    return { id: formula.id };
  },
});

export const deleteFormulaAction = createAction({
  schema: formulaIdSchema,
  permission: "production:write",
  revalidate: "/estoque",
  redirectTo: "/estoque",
  successMessage: "Fórmula excluída.",
  handler: ({ ctx, db, input }) => deleteFormula(db, ctx, input.formulaId),
});

export const cancelProductionOrderAction = createAction({
  schema: productionOrderIdSchema,
  permission: "production:write",
  revalidate: "/estoque",
  successMessage: "Ordem de produção cancelada.",
  handler: ({ ctx, db, input }) => cancelProductionOrder(db, ctx, input.productionOrderId),
});
