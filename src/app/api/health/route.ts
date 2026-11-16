import { prisma } from "@/lib/db";

/** Monitoramento (UptimeRobot, Vercel, etc.): 200 se o app e o banco respondem. Não expõe dados. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[health] banco indisponível:", err);
    return Response.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
