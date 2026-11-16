import { z } from "zod";

/**
 * Configuração obrigatória e opcional do servidor. Validada na subida
 * (src/instrumentation.ts): em produção, falta de obrigatória derruba o
 * deploy com mensagem clara; opcionais ausentes viram avisos no log.
 */
const required = z.object({
  DATABASE_URL: z.string().startsWith("postgres", "deve ser uma URL postgresql://"),
  AUTH_SECRET: z.string().min(32, "gere com: npx auth secret"),
});

const requiredInProduction = z.object({
  APP_URL: z.url("URL pública do app, ex.: https://erp.suaempresa.com.br"),
});

const OPTIONAL_GROUPS: { name: string; keys: string[]; effect: string }[] = [
  {
    name: "E-mail (Resend)",
    keys: ["RESEND_API_KEY", "EMAIL_FROM"],
    effect: "convites só geram link para copiar e a recuperação de senha não envia e-mail",
  },
  {
    name: "Cobrança (Asaas)",
    keys: ["ASAAS_API_KEY", "ASAAS_API_URL", "ASAAS_WEBHOOK_TOKEN"],
    effect: "não é possível assinar planos nem receber confirmações de pagamento",
  },
];

export type EnvReport = { errors: string[]; warnings: string[] };

export function checkEnv(env: NodeJS.ProcessEnv = process.env): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProd = env.NODE_ENV === "production";

  const collect = (schema: z.ZodObject, target: string[]) => {
    const r = schema.safeParse(env);
    if (!r.success) for (const issue of r.error.issues) target.push(`${issue.path.join(".")}: ${issue.message}`);
  };
  collect(required, errors);
  collect(requiredInProduction, isProd ? errors : warnings);

  for (const g of OPTIONAL_GROUPS) {
    const missing = g.keys.filter((k) => !env[k]);
    if (missing.length) warnings.push(`${g.name} — faltando ${missing.join(", ")}: ${g.effect}.`);
  }
  if (isProd && env.APP_URL?.startsWith("http://") && !env.APP_URL.includes("localhost")) {
    warnings.push("APP_URL usa http://: os links de convite e de senha devem usar https:// em produção.");
  }
  if (isProd && env.ASAAS_API_URL?.includes("sandbox")) {
    warnings.push("ASAAS_API_URL aponta para o SANDBOX: cobranças não são reais.");
  }
  return { errors, warnings };
}
