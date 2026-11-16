/**
 * Dados de demonstração: empresa "limpa-tudo" com insumos, fórmula e cliente.
 * Login: demo@limpatudo.com.br / demo12345
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma, tenantDb } from "@/lib/db";
import type { OrgContext } from "@/lib/session";
import { createFormula, registerStockMovement } from "@/modules/inventory/service";

async function main() {
  const existing = await prisma.organization.findUnique({ where: { slug: "limpa-tudo" } });
  if (existing) {
    console.log("Seed já aplicado (org limpa-tudo existe).");
    return;
  }

  const user = await prisma.user.create({
    data: { name: "Demo", email: "demo@limpatudo.com.br", passwordHash: await bcrypt.hash("demo12345", 12) },
  });
  const org = await prisma.organization.create({
    data: { name: "Limpa Tudo Indústria", slug: "limpa-tudo", plan: "STARTER", subscriptionStatus: "ACTIVE" },
  });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });

  const ctx: OrgContext = { userId: user.id, organizationId: org.id, orgSlug: org.slug, orgName: org.name, role: "OWNER" };
  const db = tenantDb(org.id);
  const base = { organizationId: org.id, createdBy: user.id };

  const [las, agua, essencia, frasco, detergente] = await Promise.all([
    db.product.create({ data: { ...base, sku: "MP-LAS", name: "Tensoativo LAS 90%", type: "RAW_MATERIAL", unit: "KG", minStock: "20" } }),
    db.product.create({ data: { ...base, sku: "MP-AGUA", name: "Água desmineralizada", type: "RAW_MATERIAL", unit: "L" } }),
    db.product.create({ data: { ...base, sku: "MP-ESS", name: "Essência limão", type: "RAW_MATERIAL", unit: "KG", minStock: "2" } }),
    db.product.create({ data: { ...base, sku: "EMB-FR500", name: "Frasco 500ml + tampa", type: "PACKAGING", unit: "UN", minStock: "300" } }),
    db.product.create({
      data: { ...base, sku: "PA-DET500", name: "Detergente Limão 500ml", type: "FINISHED_GOOD", unit: "UN", priceCents: 349, minStock: "100" },
    }),
  ]);

  await db.$transaction(async (tx) => {
    await registerStockMovement(tx, ctx, { productId: las.id, type: "IN", quantity: "50", unitCostCents: 1290, reason: "Estoque inicial" });
    await registerStockMovement(tx, ctx, { productId: agua.id, type: "IN", quantity: "1000", unitCostCents: 4, reason: "Estoque inicial" });
    await registerStockMovement(tx, ctx, { productId: essencia.id, type: "IN", quantity: "5", unitCostCents: 8900, reason: "Estoque inicial" });
    await registerStockMovement(tx, ctx, { productId: frasco.id, type: "IN", quantity: "1000", unitCostCents: 52, reason: "Estoque inicial" });
  });

  await createFormula(db, ctx, {
    productId: detergente.id,
    name: "Detergente Limão — batelada 100 un",
    yieldQuantity: "100",
    items: [
      { componentId: las.id, quantity: "3" },
      { componentId: agua.id, quantity: "46.5" },
      { componentId: essencia.id, quantity: "0.25" },
      { componentId: frasco.id, quantity: "100" },
    ],
  });

  await db.customer.create({ data: { ...base, name: "Mercado Bom Preço", city: "Campinas", state: "SP" } });
  await db.supplier.create({ data: { ...base, name: "Química Brasil Ltda" } });
  await db.bankAccount.create({ data: { ...base, name: "Caixa", openingBalanceCents: 0 } });
  await db.bankAccount.create({ data: { ...base, name: "Banco", openingBalanceCents: 1500000 } });

  console.log("Seed ok → login demo@limpatudo.com.br / demo12345 · /limpa-tudo/dashboard");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
