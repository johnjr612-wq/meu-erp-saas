import { z } from "zod";

/**
 * Converte texto em reais para centavos SEM ponto flutuante.
 * Aceita "1234,56", "1.234,56", "1234.56", "R$ 10", "10,5".
 */
export function parseBRLToCents(input: string): number | null {
  const cleaned = input.replace(/R\$|\s/g, "");
  if (!cleaned) return null;

  let normalized: string;
  if (cleaned.includes(",")) {
    // formato BR: pontos são milhar, vírgula é decimal
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned;
  }

  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const [, sign, intPart, decPart = ""] = match;
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return sign ? -cents : cents;
}

/** Centavos → texto para campo de formulário ("1234,50"), sem ponto flutuante. */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** Campo Zod que recebe valor em reais (texto ou centavos inteiros) e devolve centavos. */
export const centsField = z.union([z.number().int(), z.string()]).transform((value, ctx) => {
  if (typeof value === "number") return value;
  const cents = parseBRLToCents(value);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Valor monetário inválido" });
    return z.NEVER;
  }
  return cents;
});

/**
 * Quantidade decimal (até 3 casas) como string normalizada — repassada ao Prisma
 * como Decimal, sem passar por float.
 */
export const quantityField = z
  .union([z.number(), z.string()])
  .transform((v) => String(v).trim().replace(",", "."))
  .refine((v) => /^-?\d+(\.\d{1,3})?$/.test(v), "Quantidade inválida (até 3 casas decimais)");
