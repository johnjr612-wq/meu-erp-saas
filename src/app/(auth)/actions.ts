"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/db";

export type AuthFormState = { error?: string; fieldErrors?: Record<string, string[] | undefined> } | null;

/** Slugs que colidem com rotas estáticas do app. */
const RESERVED_SLUGS = new Set(["app", "api", "login", "registro", "recuperar-senha", "precos", "convite", "_next", "admin"]);

const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Informe seu nome"),
    email: z.email("E-mail inválido").transform((v) => v.toLowerCase().trim()),
    password: z.string().min(8, "Mínimo de 8 caracteres"),
    orgName: z.string().trim().min(2, "Informe o nome da empresa"),
    orgSlug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Use 3–40 letras minúsculas, números ou hífen"),
  })
  .refine((d) => !RESERVED_SLUGS.has(d.orgSlug), { path: ["orgSlug"], message: "Endereço indisponível" });

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Verifique os campos.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { name, email, password, orgName, orgSlug } = parsed.data;

  const [emailTaken, slugTaken] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } }),
  ]);
  if (emailTaken) return { fieldErrors: { email: ["E-mail já cadastrado"] } };
  if (slugTaken) return { fieldErrors: { orgSlug: ["Endereço já em uso"] } };

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email, passwordHash } });
    const org = await tx.organization.create({ data: { name: orgName, slug: orgSlug } });
    await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
  });

  // signIn lança o redirect do Next em caso de sucesso.
  await signIn("credentials", { email, password, redirectTo: `/${orgSlug}/dashboard` });
  return null;
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const redirectTo = safeInternalPath(formData.get("callbackUrl"), "/app");
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo,
    });
    return null;
  } catch (err) {
    if (err instanceof AuthError) return { error: "E-mail ou senha inválidos." };
    throw err; // redirect do Next
  }
}

/** Só caminhos internos (evita open redirect). */
function safeInternalPath(value: unknown, fallback: string): string {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

export async function logoutAction(formData?: FormData) {
  const next = safeInternalPath(formData?.get("next"), "");
  await signOut({ redirectTo: next ? `/login?callbackUrl=${encodeURIComponent(next)}` : "/login" });
}
