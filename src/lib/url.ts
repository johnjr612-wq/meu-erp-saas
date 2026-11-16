import "server-only";
import { headers } from "next/headers";

/** URL pública do app: APP_URL (recomendado em produção) ou o host da própria requisição. */
export async function resolveBaseUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
