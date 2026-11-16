import type { NextRequest } from "next/server";
import { tenantDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getOrgContext, UnauthorizedError } from "@/lib/session";
import { centsCell, decimalCell, toCsv } from "@/modules/reports/csv";
import { getCashFlow, getSalesReport, parsePeriod } from "@/modules/reports/service";

/** GET /<org>/relatorios/exportar?tipo=caixa|vendas-clientes|vendas-produtos&de=&ate= */
export async function GET(request: NextRequest, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  let ctx;
  try {
    ctx = await getOrgContext(orgSlug);
  } catch (err) {
    if (err instanceof UnauthorizedError) return new Response("Faça login.", { status: 401 });
    throw err;
  }
  if (!ctx) return new Response("Não encontrado.", { status: 404 });

  const sp = request.nextUrl.searchParams;
  const tipo = sp.get("tipo");
  const period = parsePeriod(sp.get("de") ?? undefined, sp.get("ate") ?? undefined);
  const db = tenantDb(ctx.organizationId);
  let csv: string;

  if (tipo === "caixa") {
    if (!can(ctx.role, "financial:read")) return new Response("Sem permissão.", { status: 403 });
    const cf = await getCashFlow(db, period);
    csv = toCsv(
      ["Data", "Recebido", "Pago", "A receber (previsto)", "A pagar (previsto)", "Saldo realizado", "Saldo projetado"],
      [
        [period.from, "", "", "", "", centsCell(cf.openingBalanceCents), centsCell(cf.openingBalanceCents)],
        ...cf.rows.map((r) => [
          r.day,
          centsCell(r.inCents),
          centsCell(r.outCents),
          centsCell(r.expectedInCents),
          centsCell(r.expectedOutCents),
          centsCell(r.balanceCents),
          centsCell(r.projectedBalanceCents),
        ]),
      ],
    );
  } else if (tipo === "vendas-clientes" || tipo === "vendas-produtos") {
    if (!can(ctx.role, "sales:read")) return new Response("Sem permissão.", { status: 403 });
    const sales = await getSalesReport(db, period);
    csv =
      tipo === "vendas-clientes"
        ? toCsv(
            ["Cliente", "Pedidos", "Total líquido", "% do total"],
            sales.byCustomer.map((c) => [c.name, c.orders, centsCell(c.totalCents), c.sharePct.toFixed(1).replace(".", ",")]),
          )
        : toCsv(
            ["SKU", "Produto", "Unidade", "Quantidade", "Pedidos", "Faturamento bruto", "% do total"],
            sales.byProduct.map((p) => [
              p.sku,
              p.name,
              p.unit,
              decimalCell(p.quantity),
              p.orders,
              centsCell(p.grossCents),
              p.sharePct.toFixed(1).replace(".", ","),
            ]),
          );
  } else {
    return new Response("Tipo de relatório inválido.", { status: 400 });
  }

  const filename = `${tipo}_${period.from}_${period.to}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
