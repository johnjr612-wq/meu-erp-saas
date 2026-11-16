"use server";

import { createAction } from "@/lib/action";
import { assertPlanLimit } from "@/modules/billing/service";
import {
  customerSchema,
  idSchema,
  productSchema,
  supplierSchema,
  updateCustomerSchema,
  updateProductSchema,
  updateSupplierSchema,
} from "./schemas";
import {
  deleteCustomer,
  deleteProduct,
  deleteSupplier,
  updateCustomer,
  updateProduct,
  updateSupplier,
} from "./service";

export const createCustomerAction = createAction({
  schema: customerSchema,
  permission: "registry:write",
  revalidate: "/cadastros",
  successMessage: "Cliente cadastrado.",
  handler: async ({ ctx, db, input }) => {
    const customer = await db.customer.create({
      data: { organizationId: ctx.organizationId, ...input, createdBy: ctx.userId, updatedBy: ctx.userId },
    });
    return { id: customer.id };
  },
});

export const createSupplierAction = createAction({
  schema: supplierSchema,
  permission: "registry:write",
  revalidate: "/cadastros",
  successMessage: "Fornecedor cadastrado.",
  handler: async ({ ctx, db, input }) => {
    const supplier = await db.supplier.create({
      data: { organizationId: ctx.organizationId, ...input, createdBy: ctx.userId, updatedBy: ctx.userId },
    });
    return { id: supplier.id };
  },
});

export const createProductAction = createAction({
  schema: productSchema,
  permission: "registry:write",
  revalidate: "/cadastros",
  successMessage: "Produto cadastrado.",
  handler: async ({ ctx, db, input }) =>
    db.$transaction(async (tx) => {
      await assertPlanLimit(tx, ctx, "products");
      const product = await tx.product.create({
        data: { organizationId: ctx.organizationId, ...input, createdBy: ctx.userId, updatedBy: ctx.userId },
      });
      return { id: product.id };
    }),
});

// ---- Edição e exclusão (soft delete + auditoria) ----

export const updateProductAction = createAction({
  schema: updateProductSchema,
  permission: "registry:write",
  revalidate: "/cadastros",
  successMessage: "Produto atualizado.",
  handler: ({ ctx, db, input }) => updateProduct(db, ctx, input),
});

export const deleteProductAction = createAction({
  schema: idSchema,
  permission: "registry:write",
  revalidate: "/cadastros",
  redirectTo: "/cadastros",
  successMessage: "Produto excluído.",
  handler: ({ ctx, db, input }) => deleteProduct(db, ctx, input.id),
});

export const updateCustomerAction = createAction({
  schema: updateCustomerSchema,
  permission: "registry:write",
  revalidate: "/cadastros",
  successMessage: "Cliente atualizado.",
  handler: ({ ctx, db, input }) => updateCustomer(db, ctx, input),
});

export const deleteCustomerAction = createAction({
  schema: idSchema,
  permission: "registry:write",
  revalidate: "/cadastros",
  redirectTo: "/cadastros",
  successMessage: "Cliente excluído.",
  handler: ({ ctx, db, input }) => deleteCustomer(db, ctx, input.id),
});

export const updateSupplierAction = createAction({
  schema: updateSupplierSchema,
  permission: "registry:write",
  revalidate: "/cadastros",
  successMessage: "Fornecedor atualizado.",
  handler: ({ ctx, db, input }) => updateSupplier(db, ctx, input),
});

export const deleteSupplierAction = createAction({
  schema: idSchema,
  permission: "registry:write",
  revalidate: "/cadastros",
  redirectTo: "/cadastros",
  successMessage: "Fornecedor excluído.",
  handler: ({ ctx, db, input }) => deleteSupplier(db, ctx, input.id),
});
