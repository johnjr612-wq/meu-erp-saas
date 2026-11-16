import { NextResponse, type NextRequest } from "next/server";
import { asaasWebhookSchema, isValidAsaasToken, processAsaasWebhook } from "@/modules/billing/asaas";

/**
 * Webhook de cobranças/assinaturas do Asaas.
 * Configure no painel do Asaas a URL `https://SEU_DOMINIO/api/webhooks/asaas`
 * e o mesmo token definido em ASAAS_WEBHOOK_TOKEN.
 */
export async function POST(request: NextRequest) {
  if (!isValidAsaasToken(request.headers.get("asaas-access-token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = asaasWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  try {
    const result = await processAsaasWebhook(parsed.data);
    return NextResponse.json({ received: true, result });
  } catch (err) {
    console.error("[webhook:asaas]", err);
    // 500 faz o Asaas reenviar; a idempotência evita processamento duplicado.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
