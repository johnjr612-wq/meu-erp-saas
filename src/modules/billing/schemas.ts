import { z } from "zod";
import { isValidCpfOrCnpj, onlyDigits } from "@/lib/document";

export const subscribeSchema = z.object({
  plan: z.enum(["STARTER", "PRO"], { message: "Plano inválido" }),
  cpfCnpj: z
    .string()
    .transform(onlyDigits)
    .refine(isValidCpfOrCnpj, "CPF ou CNPJ inválido"),
});

export const emptySchema = z.object({});
