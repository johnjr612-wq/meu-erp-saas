import { z } from "zod";

export const requestResetSchema = z.object({
  email: z.email("E-mail inválido").transform((v) => v.toLowerCase().trim()),
});

export const resetTokenSchema = z.string().min(20).max(100);

export const resetPasswordSchema = z
  .object({
    token: resetTokenSchema,
    password: z.string().min(8, "Mínimo de 8 caracteres").max(200),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "As senhas não conferem" });
