"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/auth";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { getSessionUserId } from "@/lib/session";
import { acceptWithSignupSchema, inviteTokenSchema } from "@/modules/members/schemas";
import { acceptInvitation, getInvitationByToken } from "@/modules/members/service";

export type InviteFormState = { error?: string; fieldErrors?: Record<string, string[] | undefined> } | null;

/** Usuário já logado aceita o convite (o e-mail da conta precisa ser o do convite). */
export async function acceptInviteAction(_prev: InviteFormState, formData: FormData): Promise<InviteFormState> {
  const token = inviteTokenSchema.safeParse(formData.get("token"));
  if (!token.success) return { error: "Convite inválido." };

  const userId = await getSessionUserId();
  if (!userId) return { error: "Faça login para aceitar o convite." };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) return { error: "Sessão inválida. Faça login novamente." };

  let orgSlug: string;
  try {
    ({ orgSlug } = await acceptInvitation(token.data, user));
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
  redirect(`/${orgSlug}/dashboard`);
}

/** Convidado sem conta: cria o usuário com o e-mail do convite e já entra na empresa. */
export async function acceptInviteWithSignupAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const parsed = acceptWithSignupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Verifique os campos.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { token, name, password } = parsed.data;

  // O e-mail vem SEMPRE do convite, nunca do formulário.
  const invitation = await getInvitationByToken(token);
  if (invitation.status !== "valid") return { error: "Convite expirado, revogado ou já utilizado." };
  if (await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } })) {
    return { error: "Já existe uma conta com este e-mail. Entre com ela para aceitar o convite." };
  }

  const user = await prisma.user.create({
    data: { name, email: invitation.email, passwordHash: await bcrypt.hash(password, 12) },
    select: { id: true, email: true },
  });

  let orgSlug: string;
  try {
    ({ orgSlug } = await acceptInvitation(token, user));
  } catch (err) {
    // convite deixou de ser válido entre a checagem e o aceite: desfaz o usuário recém-criado
    await prisma.user.delete({ where: { id: user.id } });
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }

  await signIn("credentials", { email: user.email, password, redirectTo: `/${orgSlug}/dashboard` });
  return null;
}
