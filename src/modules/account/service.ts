import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { sendMail } from "@/lib/mailer";

/**
 * Recuperação de senha. Código de plataforma (não é dado de negócio de um tenant),
 * por isso usa o client `prisma` com filtro explícito por usuário/token.
 */

export const RESET_TOKEN_TTL_MINUTES = 60;
export const MAX_RESET_REQUESTS_PER_HOUR = 3;

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Solicita o link de redefinição. NUNCA revela se o e-mail existe: o chamador
 * mostra sempre a mesma mensagem. Retorna o link só para testes/diagnóstico.
 */
export async function requestPasswordReset(email: string, baseUrl: string): Promise<{ resetUrl: string | null }> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
  if (!user) return { resetUrl: null };

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.passwordResetToken.count({ where: { userId: user.id, createdAt: { gt: oneHourAgo } } });
  if (recent >= MAX_RESET_REQUESTS_PER_HOUR) {
    console.warn(`[senha] limite de pedidos de redefinição atingido para o usuário ${user.id}`);
    return { resetUrl: null };
  }

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    // só o link mais recente vale
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
      },
    }),
  ]);

  const resetUrl = `${baseUrl}/redefinir-senha/${token}`;
  const sent = await sendMail({
    to: user.email,
    subject: "Redefinição de senha — Meu ERP",
    text: `Olá, ${user.name}. Para criar uma nova senha, acesse: ${resetUrl}\n\nO link vale por ${RESET_TOKEN_TTL_MINUTES} minutos e só pode ser usado uma vez. Se você não pediu, ignore este e-mail: sua senha continua a mesma.`,
    html: `<p>Olá, ${escape(user.name)}.</p>
<p>Para criar uma nova senha, clique no link abaixo:</p>
<p><a href="${escape(resetUrl)}">Redefinir minha senha</a></p>
<p>O link vale por ${RESET_TOKEN_TTL_MINUTES} minutos e só pode ser usado uma vez.</p>
<p>Se você não pediu, ignore este e-mail: sua senha continua a mesma.</p>`,
  });

  if (!sent) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[senha] e-mail não configurado (RESEND_API_KEY). Link de redefinição: ${resetUrl}`);
    } else {
      console.error("[senha] RESEND_API_KEY/EMAIL_FROM ausentes: o link de redefinição não foi enviado.");
    }
  }
  return { resetUrl };
}

function escape(v: string) {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type ResetTokenStatus = "valid" | "invalid" | "expired" | "used";

export async function getResetTokenStatus(token: string): Promise<ResetTokenStatus> {
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(token) } });
  if (!row) return "invalid";
  if (row.usedAt) return "used";
  if (row.expiresAt <= new Date()) return "expired";
  return "valid";
}

/**
 * Troca a senha usando o token. Atômico: o token só é consumido se ainda for
 * válido. Marca `passwordChangedAt`, o que derruba todas as sessões abertas.
 */
export async function resetPassword(token: string, newPassword: string): Promise<{ email: string }> {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  return prisma.$transaction(async (tx) => {
    const row = await tx.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(token) },
      select: { id: true, userId: true, user: { select: { email: true } } },
    });
    if (!row) throw new DomainError("Link inválido.");

    const now = new Date();
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) throw new DomainError("Este link expirou ou já foi usado. Peça um novo.");

    await tx.user.update({ where: { id: row.userId }, data: { passwordHash, passwordChangedAt: now } });
    // invalida qualquer outro link pendente do mesmo usuário
    await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
    return { email: row.user.email };
  });
}

/**
 * Sessão emitida antes da última troca de senha não vale mais.
 * `authAt` = momento do login (ms), gravado no JWT só na autenticação.
 */
export function isSessionRevoked(authAt: number | undefined, passwordChangedAt: Date | null): boolean {
  if (!passwordChangedAt) return false;
  if (!authAt) return true; // sessão antiga, sem o carimbo do login
  return authAt < passwordChangedAt.getTime();
}
