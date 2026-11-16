import type { Prisma } from "@/generated/prisma/client";

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

export function formatQty(q: Prisma.Decimal | string | number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(q.toString()));
}

export const LABELS = {
  productType: { RAW_MATERIAL: "Matéria-prima", PACKAGING: "Embalagem", FINISHED_GOOD: "Produto acabado" },
  movementType: {
    IN: "Entrada",
    OUT: "Saída",
    ADJUSTMENT: "Ajuste",
    PRODUCTION_IN: "Produção (entrada)",
    PRODUCTION_OUT: "Produção (consumo)",
  },
  salesStatus: { QUOTE: "Orçamento", CONFIRMED: "Confirmado", CANCELED: "Cancelado" },
  entryStatus: { OPEN: "Em aberto", PARTIAL: "Parcial", PAID: "Pago", CANCELED: "Cancelado" },
  entryType: { RECEIVABLE: "A receber", PAYABLE: "A pagar" },
  role: { OWNER: "Proprietário", ADMIN: "Administrador", FINANCIAL: "Financeiro", OPERATOR: "Operador" },
  paymentMethod: {
    PIX: "Pix",
    BOLETO: "Boleto",
    CASH: "Dinheiro",
    CREDIT_CARD: "Cartão de crédito",
    DEBIT_CARD: "Cartão de débito",
    TRANSFER: "Transferência",
  },
} as const;
