"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DomainError } from "@/lib/errors";
import { resolveBaseUrl } from "@/lib/url";
import { requestResetSchema, resetPasswordSchema } from "@/modules/account/schemas";
import { requestPasswordReset, resetPassword } from "@/modules/account/service";

export type ResetFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
} | null;

/**
 * Sempre a mesma resposta, exista ou não a conta. O trabalho (busca, token,
 * e-mail) roda depois da resposta com `after`, para o tempo de resposta
 * também não denunciar se o e-mail está cadastrado.
 */
export async function requestResetAction(_prev: ResetFormState, formData: FormData): Promise<ResetFormState> {
  const parsed = requestResetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const baseUrl = await resolveBaseUrl();
  after(async () => {
    try {
      await requestPasswordReset(parsed.data.email, baseUrl);
    } catch (err) {
      console.error("[senha] falha ao gerar link de redefinição:", err);
    }
  });
  return { ok: true };
}

export async function resetPasswordAction(_prev: ResetFormState, formData: FormData): Promise<ResetFormState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  try {
    await resetPassword(parsed.data.token, parsed.data.password);
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
  redirect("/login?senha=redefinida");
}
