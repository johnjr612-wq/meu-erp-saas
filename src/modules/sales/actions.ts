"use server";

import { createAction } from "@/lib/action";
import { cancelSalesOrderSchema, confirmSalesOrderSchema, createSalesOrderSchema, updateQuoteSchema } from "./schemas";
import { cancelSalesOrder, confirmSalesOrder, createSalesOrder, updateQuote } from "./service";

export const createSalesOrderAction = createAction({
  schema: createSalesOrderSchema,
  permission: "sales:write",
  revalidate: "/vendas",
  successMessage: "Orçamento criado.",
  handler: async ({ ctx, db, input }) => {
    const order = await createSalesOrder(db, ctx, input);
    return { id: order.id, number: order.number };
  },
});

export const confirmSalesOrderAction = createAction({
  schema: confirmSalesOrderSchema,
  permission: "sales:confirm",
  revalidate: "/vendas",
  successMessage: "Pedido confirmado: estoque baixado e conta a receber gerada.",
  handler: async ({ ctx, db, input }) => {
    const order = await confirmSalesOrder(db, ctx, input.salesOrderId, input.dueDate);
    return { id: order.id };
  },
});

export const cancelSalesOrderAction = createAction({
  schema: cancelSalesOrderSchema,
  permission: "sales:write",
  revalidate: "/vendas",
  successMessage: "Orçamento cancelado.",
  handler: ({ ctx, db, input }) => cancelSalesOrder(db, ctx, input.salesOrderId),
});

export const updateQuoteAction = createAction({
  schema: updateQuoteSchema,
  permission: "sales:write",
  revalidate: "/vendas",
  successMessage: "Orçamento atualizado.",
  handler: async ({ ctx, db, input }) => {
    const order = await updateQuote(db, ctx, input);
    return { id: order.id, totalCents: order.totalCents };
  },
});
