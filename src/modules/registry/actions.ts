"use server";

import { createAction } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { DomainError } from "@/lib/errors";
import { assertPlanLimit } from "@/modules/billing/service";
import { customerSchema, idSchema, productSchema, supplierSchema } from "./schemas";

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

export const deleteCustomerAction = createAction({
  schema: idSchema,
  permission: "registry:write",
  revalidate: "/cadastros",
  successMessage: "Cliente removido.",
  handler: async ({ ctx, db, input }) =>
    db.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: input.id } });
      if (!customer) throw new DomainError("Cliente não encontrado.");
      await tx.customer.update({
        where: { id: customer.id },
        data: { deletedAt: new Date(), deletedBy: ctx.userId, updatedBy: ctx.userId },
      });
      await writeAudit(tx, ctx, { entity: "Customer", entityId: customer.id, action: "SOFT_DELETE", before: customer });
    }),
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
