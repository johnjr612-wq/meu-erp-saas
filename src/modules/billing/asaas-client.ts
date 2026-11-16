import "server-only";
import { z } from "zod";
import { DomainError } from "@/lib/errors";

/**
 * Cliente mínimo da API v3 do Asaas (https://docs.asaas.com).
 * Sandbox: https://api-sandbox.asaas.com/v3 · Produção: https://api.asaas.com/v3
 */
export class AsaasNotConfiguredError extends DomainError {
  constructor() {
    super("Pagamentos ainda não configurados. Defina ASAAS_API_KEY no servidor.");
  }
}

const errorSchema = z.object({ errors: z.array(z.object({ description: z.string() })).min(1) });

async function asaasFetch<T>(path: string, init: { method?: string; body?: unknown }, schema: z.ZodType<T>): Promise<T> {
  const apiKey = process.env.ASAAS_API_KEY;
  const baseUrl = process.env.ASAAS_API_URL ?? "https://api-sandbox.asaas.com/v3";
  if (!apiKey) throw new AsaasNotConfiguredError();

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: init.method ?? "GET",
      headers: {
        access_token: apiKey,
        "Content-Type": "application/json",
        "User-Agent": "meu-erp-saas",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch (err) {
    console.error("[asaas] erro de rede:", err);
    throw new DomainError("Não foi possível falar com o Asaas. Tente novamente em instantes.");
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = errorSchema.safeParse(json);
    console.error("[asaas]", init.method ?? "GET", path, res.status, JSON.stringify(json));
    // Erros 4xx do Asaas são mensagens de validação legíveis (ex.: CPF/CNPJ inválido).
    if (res.status < 500 && parsed.success) throw new DomainError(parsed.data.errors[0].description);
    throw new DomainError("O Asaas recusou a operação. Tente novamente em instantes.");
  }
  return schema.parse(json);
}

const customerSchema = z.object({ id: z.string() });
const subscriptionSchema = z.object({ id: z.string(), status: z.string().optional() });
const paymentSchema = z.object({
  id: z.string(),
  status: z.string(),
  invoiceUrl: z.string().url(),
  dueDate: z.string(),
  value: z.number(),
});
const paymentListSchema = z.object({ data: z.array(paymentSchema) });

export type AsaasPayment = z.infer<typeof paymentSchema>;

/** Valor em centavos → reais com 2 casas, sem float acumulado (o Asaas recebe number em reais). */
function centsToReais(cents: number): number {
  return Number(`${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);
}

export const asaas = {
  createCustomer(input: { name: string; cpfCnpj: string; email?: string; externalReference: string }) {
    return asaasFetch("/customers", { method: "POST", body: input }, customerSchema);
  },

  updateCustomer(id: string, input: { name?: string; cpfCnpj?: string }) {
    return asaasFetch(`/customers/${encodeURIComponent(id)}`, { method: "PUT", body: input }, customerSchema);
  },

  createSubscription(input: {
    customer: string;
    valueCents: number;
    nextDueDate: string; // YYYY-MM-DD
    description: string;
    externalReference: string;
  }) {
    return asaasFetch(
      "/subscriptions",
      {
        method: "POST",
        body: {
          customer: input.customer,
          billingType: "UNDEFINED", // cliente escolhe Pix, boleto ou cartão na fatura
          cycle: "MONTHLY",
          value: centsToReais(input.valueCents),
          nextDueDate: input.nextDueDate,
          description: input.description,
          externalReference: input.externalReference,
        },
      },
      subscriptionSchema,
    );
  },

  updateSubscription(id: string, input: { valueCents: number; description: string; externalReference: string }) {
    return asaasFetch(
      `/subscriptions/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: {
          value: centsToReais(input.valueCents),
          description: input.description,
          externalReference: input.externalReference,
          updatePendingPayments: true,
        },
      },
      subscriptionSchema,
    );
  },

  cancelSubscription(id: string) {
    return asaasFetch(`/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }, z.unknown());
  },

  async listPendingPayments(subscriptionId: string): Promise<AsaasPayment[]> {
    const res = await asaasFetch(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/payments?status=PENDING`,
      {},
      paymentListSchema,
    );
    return res.data;
  },
};

export const __test = { centsToReais };
