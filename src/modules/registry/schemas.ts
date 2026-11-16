import { z } from "zod";
import { centsField, quantityField } from "@/lib/money";

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const customerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  document: optionalText(18),
  email: z.email().optional(),
  phone: optionalText(20),
  address: optionalText(200),
  city: optionalText(80),
  state: z.string().trim().length(2).toUpperCase().optional(),
  zipCode: optionalText(9),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(150),
  document: optionalText(18),
  email: z.email().optional(),
  phone: optionalText(20),
});

export const productSchema = z.object({
  sku: z.string().trim().min(1).max(40).toUpperCase(),
  name: z.string().trim().min(2).max(150),
  type: z.enum(["RAW_MATERIAL", "PACKAGING", "FINISHED_GOOD"]),
  unit: z.enum(["UN", "KG", "G", "L", "ML", "CX"]),
  priceCents: centsField.default(0),
  costCents: centsField.default(0),
  minStock: quantityField.default("0"),
});

export const idSchema = z.object({ id: z.string().min(1) });

const withId = { id: z.string().min(1) };

export const updateCustomerSchema = customerSchema.extend(withId);
export const updateSupplierSchema = supplierSchema.extend(withId);
/** Custo médio não é editável: vem do estoque (entradas e produção). */
export const updateProductSchema = productSchema.omit({ costCents: true }).extend(withId);
