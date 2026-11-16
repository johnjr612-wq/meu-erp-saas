/**
 * Teste de fumaça das regras críticas contra um banco real.
 * Rodar: npm run test:smoke   (usa --conditions=react-server por causa do "server-only")
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma, tenantDb, TenantIsolationError } from "@/lib/db";
import type { OrgContext } from "@/lib/session";
import { DomainError } from "@/lib/errors";
import { parseBRLToCents } from "@/lib/money";
import { completeProductionOrder, createFormula, createProductionOrder, registerStockMovement } from "@/modules/inventory/service";
import { confirmSalesOrder, createSalesOrder } from "@/modules/sales/service";
import { cancelEntry, createEntry, getBankBalances, reversePayment, settleEntry } from "@/modules/financial/service";
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  getInvitationByToken,
  removeMember,
  revokeInvitation,
} from "@/modules/members/service";

const run = Date.now().toString(36);
let passed = 0;
async function step(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`  ✔ ${name}`);
}

async function makeOrg(suffix: string): Promise<OrgContext> {
  const user = await prisma.user.create({
    data: { name: `User ${suffix}`, email: `${suffix}-${run}@test.local`, passwordHash: "x" },
  });
  const org = await prisma.organization.create({ data: { name: `Org ${suffix}`, slug: `${suffix}-${run}`, plan: "PRO" } });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
  return { userId: user.id, organizationId: org.id, orgSlug: org.slug, orgName: org.name, role: "OWNER" };
}

async function main() {
  console.log("Smoke test ERP");
  const A = await makeOrg("a");
  const B = await makeOrg("b");
  const dbA = tenantDb(A.organizationId);
  const dbB = tenantDb(B.organizationId);

  await step("dinheiro: parse BRL sem float", () => {
    assert.equal(parseBRLToCents("1.234,56"), 123456);
    assert.equal(parseBRLToCents("0,1"), 10);
    assert.equal(parseBRLToCents("19.99"), 1999);
    assert.equal(parseBRLToCents("abc"), null);
  });

  // ---- Isolamento ----
  const tensoativo = await dbA.product.create({
    data: { organizationId: A.organizationId, sku: "LAS", name: "Tensoativo LAS", type: "RAW_MATERIAL", unit: "KG" },
  });

  await step("isolamento: org B não enxerga produto da org A", async () => {
    assert.equal(await dbB.product.findFirst({ where: { id: tensoativo.id } }), null);
    assert.equal(await dbB.product.count(), 0);
  });

  await step("isolamento: org B não consegue atualizar produto da org A", async () => {
    await assert.rejects(dbB.product.update({ where: { id: tensoativo.id }, data: { name: "hack" } }));
  });

  await step("isolamento: where com organizationId de outro tenant é rejeitado", async () => {
    await assert.rejects(dbB.product.findMany({ where: { organizationId: A.organizationId } }), TenantIsolationError);
  });

  await step("isolamento: create com organizationId de outro tenant é rejeitado", async () => {
    await assert.rejects(
      dbB.product.create({ data: { organizationId: A.organizationId, sku: "X", name: "X" } }),
      TenantIsolationError,
    );
  });

  // ---- Produção ----
  const agua = await dbA.product.create({
    data: { organizationId: A.organizationId, sku: "AGUA", name: "Água desmineralizada", type: "RAW_MATERIAL", unit: "L" },
  });
  const frasco = await dbA.product.create({
    data: { organizationId: A.organizationId, sku: "FR500", name: "Frasco 500ml", type: "PACKAGING", unit: "UN" },
  });
  const detergente = await dbA.product.create({
    data: {
      organizationId: A.organizationId,
      sku: "DET500",
      name: "Detergente 500ml",
      type: "FINISHED_GOOD",
      unit: "UN",
      priceCents: 349,
    },
  });

  await dbA.$transaction(async (tx) => {
    await registerStockMovement(tx, A, { productId: tensoativo.id, type: "IN", quantity: "10", unitCostCents: 1200 });
    await registerStockMovement(tx, A, { productId: agua.id, type: "IN", quantity: "200", unitCostCents: 5 });
    await registerStockMovement(tx, A, { productId: frasco.id, type: "IN", quantity: "500", unitCostCents: 45 });
  });

  await step("estoque: custo médio ponderado em nova entrada", async () => {
    await dbA.$transaction((tx) =>
      registerStockMovement(tx, A, { productId: tensoativo.id, type: "IN", quantity: "10", unitCostCents: 1400 }),
    );
    const p = await dbA.product.findFirstOrThrow({ where: { id: tensoativo.id } });
    assert.equal(p.stockQuantity.toString(), "20");
    assert.equal(p.costCents, 1300);
  });

  // Fórmula: 100 frascos = 3 kg LAS + 47 L água + 100 frascos
  const formula = await createFormula(dbA, A, {
    productId: detergente.id,
    name: "Detergente neutro",
    yieldQuantity: "100",
    items: [
      { componentId: tensoativo.id, quantity: "3" },
      { componentId: agua.id, quantity: "47" },
      { componentId: frasco.id, quantity: "100" },
    ],
  });

  await step("produção: OP consome insumos e gera produto acabado com custo", async () => {
    const op = await createProductionOrder(dbA, A, { formulaId: formula.id, quantity: "200", lot: "L001" });
    await completeProductionOrder(dbA, A, op.id);
    const [las, ag, fr, det] = await Promise.all(
      [tensoativo.id, agua.id, frasco.id, detergente.id].map((id) => dbA.product.findFirstOrThrow({ where: { id } })),
    );
    assert.equal(las.stockQuantity.toString(), "14"); // 20 - 6
    assert.equal(ag.stockQuantity.toString(), "106"); // 200 - 94
    assert.equal(fr.stockQuantity.toString(), "300"); // 500 - 200
    assert.equal(det.stockQuantity.toString(), "200");
    // custo: (6*1300 + 94*5 + 200*45) / 200 = (7800+470+9000)/200 = 86.35 → 86
    assert.equal(det.costCents, 86);
  });

  await step("produção: insumo insuficiente faz rollback completo", async () => {
    const op = await createProductionOrder(dbA, A, { formulaId: formula.id, quantity: "10000", lot: "L002" });
    await assert.rejects(completeProductionOrder(dbA, A, op.id), DomainError);
    const las = await dbA.product.findFirstOrThrow({ where: { id: tensoativo.id } });
    assert.equal(las.stockQuantity.toString(), "14");
    const still = await dbA.productionOrder.findFirstOrThrow({ where: { id: op.id } });
    assert.equal(still.status, "PLANNED");
  });

  // ---- Vendas + Financeiro ----
  const cliente = await dbA.customer.create({ data: { organizationId: A.organizationId, name: "Mercado Bom Preço" } });
  const banco = await dbA.bankAccount.create({ data: { organizationId: A.organizationId, name: "Banco", openingBalanceCents: 10000 } });

  let receivableId = "";
  await step("vendas: confirmar pedido baixa estoque e gera conta a receber", async () => {
    const order = await createSalesOrder(dbA, A, {
      customerId: cliente.id,
      discountCents: 98,
      items: [{ productId: detergente.id, quantity: "50" }],
    });
    assert.equal(order.totalCents, 50 * 349 - 98);
    await confirmSalesOrder(dbA, A, order.id, new Date("2026-12-15"));
    const det = await dbA.product.findFirstOrThrow({ where: { id: detergente.id } });
    assert.equal(det.stockQuantity.toString(), "150");
    const entry = await dbA.financialEntry.findFirstOrThrow({ where: { salesOrderId: order.id } });
    assert.equal(entry.amountCents, 17352);
    receivableId = entry.id;
  });

  await step("vendas: cliente de outra org não pode ser usado", async () => {
    const clienteB = await dbB.customer.create({ data: { organizationId: B.organizationId, name: "Cliente B" } });
    await assert.rejects(
      createSalesOrder(dbA, A, { customerId: clienteB.id, discountCents: 0, items: [{ productId: detergente.id, quantity: "1" }] }),
      DomainError,
    );
  });

  await step("financeiro: baixa parcial, total e estorno recalculam status e saldo", async () => {
    const p1 = await settleEntry(dbA, A, { entryId: receivableId, bankAccountId: banco.id, amountCents: 10000, method: "PIX", paidAt: new Date() });
    let e = await dbA.financialEntry.findFirstOrThrow({ where: { id: receivableId } });
    assert.equal(e.status, "PARTIAL");
    await assert.rejects(
      settleEntry(dbA, A, { entryId: receivableId, bankAccountId: banco.id, amountCents: 999999, method: "PIX", paidAt: new Date() }),
      DomainError,
    );
    await settleEntry(dbA, A, { entryId: receivableId, bankAccountId: banco.id, amountCents: 7352, method: "BOLETO", paidAt: new Date() });
    e = await dbA.financialEntry.findFirstOrThrow({ where: { id: receivableId } });
    assert.equal(e.status, "PAID");
    let [bal] = await getBankBalances(dbA);
    assert.equal(bal.balanceCents, 10000 + 17352);

    await reversePayment(dbA, A, p1.id, "Pix devolvido");
    e = await dbA.financialEntry.findFirstOrThrow({ where: { id: receivableId } });
    assert.equal(e.status, "PARTIAL");
    assert.equal(e.paidAmountCents, 7352);
    [bal] = await getBankBalances(dbA);
    assert.equal(bal.balanceCents, 10000 + 7352);
  });

  await step("soft delete: DELETE físico em financeiro é bloqueado", async () => {
    await assert.rejects(dbA.financialEntry.delete({ where: { id: receivableId } }), TenantIsolationError);
    await assert.rejects(dbA.stockMovement.deleteMany({}), TenantIsolationError);
  });

  await step("soft delete: cancelamento some das leituras mas fica no banco + auditoria", async () => {
    const entry = await createEntry(dbA, A, { type: "PAYABLE", description: "Frete", amountCents: 5000, dueDate: new Date() });
    await cancelEntry(dbA, A, entry.id, "Lançado em duplicidade");
    assert.equal(await dbA.financialEntry.findFirst({ where: { id: entry.id } }), null);
    const raw = await prisma.financialEntry.findUniqueOrThrow({ where: { id: entry.id } });
    assert.ok(raw.deletedAt);
    assert.equal(raw.deletedBy, A.userId);
    const logs = await dbA.auditLog.findMany({ where: { entityId: entry.id } });
    assert.deepEqual(logs.map((l) => l.action).sort(), ["CREATE", "SOFT_DELETE"]);
  });

  // ---- Convites e membros ----
  const tokenOf = (url: string) => url.split("/convite/")[1];
  const baseUrl = "http://localhost:3000";
  const newUser = (prefix: string) =>
    prisma.user.create({ data: { name: prefix, email: `${prefix}-${run}@test.local`, passwordHash: "x" } });

  await step("convite: aceite cria membership com o cargo do convite e o token só vale uma vez", async () => {
    const op = await newUser("op");
    const { inviteUrl, emailSent } = await createInvitation(dbA, A, { email: op.email, role: "OPERATOR", baseUrl });
    assert.equal(emailSent, false); // sem RESEND_API_KEY
    const token = tokenOf(inviteUrl);
    assert.equal((await getInvitationByToken(token)).status, "valid");
    const stored = await prisma.invitation.findFirstOrThrow({ where: { email: op.email } });
    assert.notEqual(stored.tokenHash, token); // só o hash é salvo
    await acceptInvitation(token, op);
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: op.id, organizationId: A.organizationId } });
    assert.equal(m.role, "OPERATOR");
    assert.equal((await getInvitationByToken(token)).status, "accepted");
    await assert.rejects(acceptInvitation(token, op), DomainError);
  });

  await step("convite: e-mail diferente do convite não pode aceitar", async () => {
    const intruso = await newUser("intruso");
    const { inviteUrl } = await createInvitation(dbA, A, { email: `alvo-${run}@test.local`, role: "FINANCIAL", baseUrl });
    await assert.rejects(acceptInvitation(tokenOf(inviteUrl), intruso), /Este convite é para/);
    assert.equal(await prisma.membership.count({ where: { userId: intruso.id } }), 0);
  });

  await step("convite: reenviar revoga o anterior; revogado e expirado não aceitam", async () => {
    const fin = await newUser("fin");
    const first = await createInvitation(dbA, A, { email: fin.email, role: "FINANCIAL", baseUrl });
    const second = await createInvitation(dbA, A, { email: fin.email, role: "FINANCIAL", baseUrl });
    assert.equal((await getInvitationByToken(tokenOf(first.inviteUrl))).status, "revoked");
    await assert.rejects(acceptInvitation(tokenOf(first.inviteUrl), fin), DomainError);

    await prisma.invitation.update({ where: { id: second.invitationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await getInvitationByToken(tokenOf(second.inviteUrl))).status, "expired");
    await assert.rejects(acceptInvitation(tokenOf(second.inviteUrl), fin), DomainError);

    const third = await createInvitation(dbA, A, { email: fin.email, role: "FINANCIAL", baseUrl });
    await revokeInvitation(dbA, A, third.invitationId);
    await assert.rejects(acceptInvitation(tokenOf(third.inviteUrl), fin), DomainError);
  });

  await step("convite: ADMIN não convida ADMIN; ninguém convida OWNER; membro existente é recusado", async () => {
    const adminCtx: OrgContext = { ...A, role: "ADMIN" };
    await assert.rejects(createInvitation(dbA, adminCtx, { email: `x-${run}@t.local`, role: "ADMIN", baseUrl }), DomainError);
    await assert.rejects(createInvitation(dbA, A, { email: `y-${run}@t.local`, role: "OWNER", baseUrl }), DomainError);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: A.userId } });
    await assert.rejects(createInvitation(dbA, A, { email: owner.email, role: "OPERATOR", baseUrl }), /já faz parte/);
  });

  await step("convite: limite do plano conta membros + convites pendentes", async () => {
    await prisma.organization.update({ where: { id: B.organizationId }, data: { plan: "FREE" } }); // limite 1
    await assert.rejects(
      createInvitation(dbB, B, { email: `limite-${run}@t.local`, role: "OPERATOR", baseUrl }),
      /Limite do plano/,
    );
  });

  await step("membros: alterar cargo e remover respeitam hierarquia e tenant", async () => {
    const op = await prisma.membership.findFirstOrThrow({ where: { organizationId: A.organizationId, role: "OPERATOR" } });
    await changeMemberRole(A, op.id, "FINANCIAL");
    assert.equal((await prisma.membership.findUniqueOrThrow({ where: { id: op.id } })).role, "FINANCIAL");

    const ownerMembership = await prisma.membership.findFirstOrThrow({ where: { organizationId: A.organizationId, role: "OWNER" } });
    await assert.rejects(removeMember(A, ownerMembership.id), DomainError); // não remove a si mesmo/OWNER
    await assert.rejects(changeMemberRole({ ...A, role: "ADMIN", userId: "outro" }, ownerMembership.id, "OPERATOR"), DomainError);

    // org B tentando remover membro da org A
    await assert.rejects(removeMember(B, op.id), /Membro não encontrado/);
    assert.ok(await prisma.membership.findUnique({ where: { id: op.id } }));

    await removeMember(A, op.id);
    assert.equal(await prisma.membership.findUnique({ where: { id: op.id } }), null);
    const audit = await dbA.auditLog.findMany({ where: { entityId: op.id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(audit.map((a) => a.action), ["ACCEPT_INVITE", "CHANGE_ROLE", "REMOVE"]);
  });

  console.log(`\n${passed} verificações passaram.`);
}

main()
  .catch((err) => {
    console.error("\n✘ FALHOU:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
