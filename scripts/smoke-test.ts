/**
 * Teste de fumaça das regras críticas contra um banco real.
 * Rodar: npm run test:smoke   (usa --conditions=react-server por causa do "server-only")
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { isValidCpfOrCnpj } from "@/lib/document";
import bcrypt from "bcryptjs";
import {
  getResetTokenStatus,
  isSessionRevoked,
  MAX_RESET_REQUESTS_PER_HOUR,
  requestPasswordReset,
  resetPassword,
} from "@/modules/account/service";
import { processAsaasWebhook } from "@/modules/billing/asaas";
import { __test as asaasTest, AsaasNotConfiguredError } from "@/modules/billing/asaas-client";
import { effectivePlan } from "@/modules/billing/plans";
import { assertPlanLimit, cancelSubscription, subscribeToPlan } from "@/modules/billing/service";
import { centsCell, toCsv } from "@/modules/reports/csv";
import { getCashFlow, getSalesReport, parsePeriod } from "@/modules/reports/service";
import { prisma, tenantDb, TenantIsolationError } from "@/lib/db";
import type { OrgContext } from "@/lib/session";
import { DomainError } from "@/lib/errors";
import { parseBRLToCents } from "@/lib/money";
import {
  cancelProductionOrder,
  completeProductionOrder,
  createFormula,
  createProductionOrder,
  deleteFormula,
  registerStockMovement,
  updateFormula,
} from "@/modules/inventory/service";
import { confirmSalesOrder, createSalesOrder, updateQuote } from "@/modules/sales/service";
import { cancelEntry, createEntry, getBankBalances, reversePayment, settleEntry, updateEntry } from "@/modules/financial/service";
import { deleteCustomer, deleteProduct, deleteSupplier, updateCustomer, updateProduct } from "@/modules/registry/service";
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

  // ---- Edição de fórmulas e orçamentos ----
  await step("fórmula: com OP planejada só nome muda; cancelar OP libera rendimento e insumos", async () => {
    const planned = await dbA.productionOrder.findFirstOrThrow({ where: { lot: "L002" } }); // sobrou do teste de rollback
    assert.equal(planned.status, "PLANNED");
    const items = [
      { componentId: tensoativo.id, quantity: "3" },
      { componentId: agua.id, quantity: "47" },
      { componentId: frasco.id, quantity: "100" },
    ];
    await updateFormula(dbA, A, { formulaId: formula.id, name: "Detergente neutro v2", yieldQuantity: "100", items });
    await assert.rejects(
      updateFormula(dbA, A, { formulaId: formula.id, name: "x", yieldQuantity: "120", items }),
      /ordem\(ns\) de produção planejada/,
    );
    await assert.rejects(deleteFormula(dbA, A, formula.id), /planejadas/);
    await assert.rejects(updateFormula(dbB, B, { formulaId: formula.id, name: "hack", yieldQuantity: "100", items }), /não encontrada/);

    await cancelProductionOrder(dbA, A, planned.id);
    await assert.rejects(cancelProductionOrder(dbA, A, planned.id), /Só ordens planejadas/);
    const done = await dbA.productionOrder.findFirstOrThrow({ where: { lot: "L001" } });
    await assert.rejects(cancelProductionOrder(dbA, A, done.id), /Só ordens planejadas/);

    const updated = await updateFormula(dbA, A, {
      formulaId: formula.id,
      name: "Detergente neutro v2",
      yieldQuantity: "200",
      items: [{ componentId: tensoativo.id, quantity: "5" }, { componentId: agua.id, quantity: "95" }],
    });
    assert.equal(updated.items.length, 2);
    assert.equal(updated.yieldQuantity.toString(), "200");
    assert.equal(await prisma.formulaItem.count({ where: { formulaId: formula.id } }), 2);
    const log = await dbA.auditLog.findFirstOrThrow({ where: { entityId: formula.id }, orderBy: { createdAt: "desc" } });
    assert.equal((log.before as { items: unknown[] }).items.length, 3);
  });

  await step("fórmula: insumo repetido, produto acabado ou o próprio produto são recusados", async () => {
    const base = { formulaId: formula.id, name: "Detergente neutro v2", yieldQuantity: "200" };
    await assert.rejects(updateFormula(dbA, A, { ...base, items: [{ componentId: agua.id, quantity: "1" }, { componentId: agua.id, quantity: "2" }] }), /repetido/);
    await assert.rejects(updateFormula(dbA, A, { ...base, items: [{ componentId: detergente.id, quantity: "1" }] }), /si mesmo/);
  });

  await step("orçamento: edição repreça pelo cadastro, troca itens e recalcula totais", async () => {
    const quote = await createSalesOrder(dbA, A, { customerId: cliente.id, discountCents: 0, items: [{ productId: detergente.id, quantity: "10" }] });
    await dbA.product.update({ where: { id: detergente.id }, data: { priceCents: 399 } });
    const edited = await updateQuote(dbA, A, {
      salesOrderId: quote.id,
      customerId: cliente.id,
      discountCents: 100,
      notes: "Entrega sexta",
      items: [{ productId: detergente.id, quantity: "20" }],
    });
    assert.equal(edited.items.length, 1);
    assert.equal(edited.items[0].unitPriceCents, 399);
    assert.equal(edited.subtotalCents, 7980);
    assert.equal(edited.totalCents, 7880);
    assert.equal(edited.notes, "Entrega sexta");
    await assert.rejects(
      updateQuote(dbA, A, { salesOrderId: quote.id, customerId: cliente.id, discountCents: 999999, items: [{ productId: detergente.id, quantity: "1" }] }),
      /Desconto maior/,
    );
    await assert.rejects(
      updateQuote(dbA, A, { salesOrderId: quote.id, customerId: cliente.id, discountCents: 0, items: [{ productId: agua.id, quantity: "1" }] }),
      /Produto inválido/,
    );
    await assert.rejects(
      updateQuote(dbB, B, { salesOrderId: quote.id, customerId: cliente.id, discountCents: 0, items: [{ productId: detergente.id, quantity: "1" }] }),
      /não encontrado/,
    );
  });

  await step("orçamento: pedido confirmado não pode ser editado e mantém os itens", async () => {
    const confirmed = await dbA.salesOrder.findFirstOrThrow({ where: { status: "CONFIRMED" }, include: { items: true } });
    await assert.rejects(
      updateQuote(dbA, A, { salesOrderId: confirmed.id, customerId: cliente.id, discountCents: 0, items: [{ productId: detergente.id, quantity: "1" }] }),
      /Somente orçamentos/,
    );
    assert.equal(await dbA.salesOrderItem.count({ where: { salesOrderId: confirmed.id } }), confirmed.items.length);
  });

  // ---- Edição e exclusão ----
  const productInput = (p: { id: string; sku: string; name: string; type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_GOOD"; unit: "UN" | "KG" | "G" | "L" | "ML" | "CX" }) => ({
    id: p.id, sku: p.sku, name: p.name, type: p.type, unit: p.unit, priceCents: 0, minStock: "0",
  });

  await step("edição: produto valida SKU duplicado, unidade com movimento e tipo em fórmula", async () => {
    await assert.rejects(updateProduct(dbA, A, { ...productInput(tensoativo), sku: "AGUA" }), /SKU AGUA já está em uso/);
    await assert.rejects(updateProduct(dbA, A, { ...productInput(tensoativo), unit: "L" }), /unidade não pode mudar/);
    await assert.rejects(updateProduct(dbA, A, { ...productInput(tensoativo), type: "PACKAGING" }), /tipo não pode mudar/);
    await updateProduct(dbA, A, { ...productInput(tensoativo), name: "Tensoativo LAS 90%", priceCents: 1990, minStock: "5" });
    const p = await dbA.product.findFirstOrThrow({ where: { id: tensoativo.id } });
    assert.equal(p.name, "Tensoativo LAS 90%");
    assert.equal(p.minStock.toString(), "5");
    assert.equal(p.costCents, 1300); // custo médio intocado
    const log = await dbA.auditLog.findFirstOrThrow({ where: { entityId: tensoativo.id, action: "UPDATE" } });
    assert.equal((log.before as { name: string }).name, "Tensoativo LAS");
  });

  await step("edição: org B não edita nem exclui produto da org A", async () => {
    await assert.rejects(updateProduct(dbB, B, { ...productInput(tensoativo), name: "hack" }), /não encontrado/);
    await assert.rejects(deleteProduct(dbB, B, tensoativo.id), /não encontrado/);
  });

  await step("exclusão: produto com estoque ou em fórmula é bloqueado; sem uso é excluído e libera o SKU", async () => {
    await assert.rejects(deleteProduct(dbA, A, tensoativo.id), /Zere o estoque/);
    const tampa = await dbA.product.create({
      data: { organizationId: A.organizationId, sku: "TAMPA", name: "Tampa", type: "PACKAGING", unit: "UN" },
    });
    await createFormula(dbA, A, { productId: detergente.id, name: "Tmp", yieldQuantity: "1", items: [{ componentId: tampa.id, quantity: "1" }] });
    await assert.rejects(deleteProduct(dbA, A, tampa.id), /está em uma fórmula/);

    const rotulo = await dbA.product.create({
      data: { organizationId: A.organizationId, sku: "ROTULO", name: "Rótulo", type: "PACKAGING", unit: "UN" },
    });
    await deleteProduct(dbA, A, rotulo.id);
    assert.equal(await dbA.product.findFirst({ where: { id: rotulo.id } }), null);
    const raw = await prisma.product.findUniqueOrThrow({ where: { id: rotulo.id } });
    assert.ok(raw.deletedAt && raw.sku.startsWith("ROTULO~"));
    await dbA.product.create({ data: { organizationId: A.organizationId, sku: "ROTULO", name: "Rótulo novo", type: "PACKAGING", unit: "UN" } });
  });

  await step("edição: cliente aceita limpar campo; exclusão bloqueada com título em aberto", async () => {
    await updateCustomer(dbA, A, { id: cliente.id, name: "Mercado Bom Preço", phone: "11 99999-0000" });
    await updateCustomer(dbA, A, { id: cliente.id, name: "Mercado Bom Preço Ltda" });
    const c = await dbA.customer.findFirstOrThrow({ where: { id: cliente.id } });
    assert.equal(c.phone, null);
    assert.equal(c.name, "Mercado Bom Preço Ltda");
    await assert.rejects(deleteCustomer(dbA, A, cliente.id), /contas a receber em aberto/);
  });

  await step("exclusão: fornecedor com conta a pagar em aberto é bloqueado; sem pendências é excluído", async () => {
    const forn = await dbA.supplier.create({ data: { organizationId: A.organizationId, name: "Química X" } });
    const conta = await createEntry(dbA, A, { type: "PAYABLE", description: "Compra", amountCents: 1000, dueDate: new Date(), supplierId: forn.id });
    await assert.rejects(deleteSupplier(dbA, A, forn.id), /contas a pagar em aberto/);
    await cancelEntry(dbA, A, conta.id, "teste");
    await deleteSupplier(dbA, A, forn.id);
    assert.equal(await dbA.supplier.findFirst({ where: { id: forn.id } }), null);
  });

  await step("edição: título respeita valor já pago, recalcula status e bloqueia título pago", async () => {
    const base = { entryId: receivableId, description: "Pedido #1 (ajustado)", dueDate: new Date("2026-12-20"), customerId: cliente.id };
    await assert.rejects(updateEntry(dbA, A, { ...base, amountCents: 5000 }), /menor que o total já pago/);
    await assert.rejects(updateEntry(dbB, B, { ...base, amountCents: 20000 }), /não encontrado/);
    // tentativa de vincular fornecedor num título a receber é ignorada
    const e1 = await updateEntry(dbA, A, { ...base, amountCents: 20000, supplierId: "qualquer" });
    assert.equal(e1.status, "PARTIAL");
    assert.equal(e1.supplierId, null);
    const e2 = await updateEntry(dbA, A, { ...base, amountCents: 7352 });
    assert.equal(e2.status, "PAID");
    const lastPay = await dbA.financialPayment.findFirstOrThrow({ where: { entryId: receivableId, reversedAt: null }, orderBy: { paidAt: "desc" } });
    assert.equal(e2.paidAt?.getTime(), lastPay.paidAt.getTime());
    await assert.rejects(updateEntry(dbA, A, { ...base, amountCents: 9000 }), /pagos ou cancelados não podem ser editados/);
    const actions = (await dbA.auditLog.findMany({ where: { entityId: receivableId, action: "UPDATE" } })).length;
    assert.equal(actions, 2);
  });

  // ---- Recuperação de senha ----
  await step("senha: e-mail inexistente não gera link nem erro (não revela cadastro)", async () => {
    const r = await requestPasswordReset(`ninguem-${run}@test.local`, "http://app");
    assert.equal(r.resetUrl, null);
  });

  await step("senha: link é de uso único, só o hash é salvo e um novo pedido invalida o anterior", async () => {
    const u = await prisma.user.create({
      data: { name: "Reset", email: `reset-${run}@test.local`, passwordHash: await bcrypt.hash("senha-antiga-1", 4) },
    });
    const first = (await requestPasswordReset(u.email, "http://app")).resetUrl!;
    const second = (await requestPasswordReset(u.email, "http://app")).resetUrl!;
    const t1 = first.split("/redefinir-senha/")[1];
    const t2 = second.split("/redefinir-senha/")[1];
    assert.equal(await getResetTokenStatus(t1), "used");
    assert.equal(await getResetTokenStatus(t2), "valid");
    assert.equal(await prisma.passwordResetToken.count({ where: { tokenHash: t2 } }), 0); // token puro não está no banco

    await assert.rejects(resetPassword(t1, "nova-senha-123"), /expirou ou já foi usado/);
    const before = new Date();
    await resetPassword(t2, "nova-senha-123");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    assert.ok(await bcrypt.compare("nova-senha-123", after.passwordHash));
    assert.ok(!(await bcrypt.compare("senha-antiga-1", after.passwordHash)));
    assert.ok(after.passwordChangedAt && after.passwordChangedAt >= before);
    await assert.rejects(resetPassword(t2, "outra-senha-123"), /expirou ou já foi usado/);
  });

  await step("senha: link expirado é recusado; limite de pedidos por hora", async () => {
    const u = await prisma.user.create({ data: { name: "Exp", email: `exp-${run}@test.local`, passwordHash: "x" } });
    const url = (await requestPasswordReset(u.email, "http://app")).resetUrl!;
    const token = url.split("/redefinir-senha/")[1];
    await prisma.passwordResetToken.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await getResetTokenStatus(token), "expired");
    await assert.rejects(resetPassword(token, "nova-senha-123"), /expirou/);

    for (let i = 1; i < MAX_RESET_REQUESTS_PER_HOUR; i++) await requestPasswordReset(u.email, "http://app");
    assert.equal((await requestPasswordReset(u.email, "http://app")).resetUrl, null);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: u.id } }), MAX_RESET_REQUESTS_PER_HOUR);
  });

  await step("senha: sessões abertas antes da troca de senha são revogadas", () => {
    const changed = new Date("2026-11-16T12:00:00Z");
    assert.equal(isSessionRevoked(changed.getTime() - 1, changed), true);
    assert.equal(isSessionRevoked(changed.getTime() + 1, changed), false);
    assert.equal(isSessionRevoked(undefined, changed), true);
    assert.equal(isSessionRevoked(undefined, null), false);
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

  // ---- Relatórios ----
  await step("relatórios: período padrão, inversão e limite de 1 ano; CSV no padrão Excel BR", () => {
    const now = new Date("2026-02-10T15:00:00Z");
    assert.deepEqual(parsePeriod(undefined, undefined, now), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(parsePeriod("2026-03-10", "2026-03-01", now), { from: "2026-03-01", to: "2026-03-10" });
    assert.deepEqual(parsePeriod("lixo", "2026-02-05", now), { from: "2026-02-01", to: "2026-02-05" });
    assert.equal(parsePeriod("2020-01-01", "2026-01-01", now).to, "2020-12-31");
    assert.equal(centsCell(-123456), "-1234,56");
    assert.equal(centsCell(5), "0,05");
    assert.equal(toCsv(["a", "b"], [['x;y', 'diz "oi"']]), '\uFEFFa;b\r\n"x;y";"diz ""oi"""\r\n');
  });

  await step("relatórios: fluxo de caixa com saldo inicial, realizado, previsto, estorno e vencidos", async () => {
    const E = await makeOrg("e");
    const dbE = tenantDb(E.organizationId);
    const bank = await dbE.bankAccount.create({ data: { organizationId: E.organizationId, name: "Banco", openingBalanceCents: 100000 } });
    const pay = (entryId: string, amountCents: number, day: string) =>
      settleEntry(dbE, E, { entryId, bankAccountId: bank.id, amountCents, method: "PIX", paidAt: new Date(day) });

    const r1 = await createEntry(dbE, E, { type: "RECEIVABLE", description: "R1", amountCents: 10000, dueDate: new Date("2026-10-20") });
    await pay(r1.id, 4000, "2026-10-25"); // antes do período → saldo inicial
    await pay(r1.id, 6000, "2026-11-05");
    const p1 = await createEntry(dbE, E, { type: "PAYABLE", description: "P1", amountCents: 3000, dueDate: new Date("2026-11-10") });
    await pay(p1.id, 3000, "2026-11-10");
    const p2 = await createEntry(dbE, E, { type: "PAYABLE", description: "P2", amountCents: 2000, dueDate: new Date("2026-11-12") });
    const p2pay = await pay(p2.id, 2000, "2026-11-12");
    await reversePayment(dbE, E, p2pay.id, "devolvido"); // estorno: volta a ser previsto
    await createEntry(dbE, E, { type: "RECEIVABLE", description: "R2", amountCents: 5000, dueDate: new Date("2026-11-20") });
    await createEntry(dbE, E, { type: "RECEIVABLE", description: "R3", amountCents: 700, dueDate: new Date("2026-10-01") });

    const cf = await getCashFlow(dbE, { from: "2026-11-01", to: "2026-11-30" }, "2026-11-16");
    assert.equal(cf.openingBalanceCents, 104000);
    assert.deepEqual(
      cf.rows.map((r) => [r.day, r.inCents, r.outCents, r.expectedInCents, r.expectedOutCents, r.balanceCents, r.projectedBalanceCents]),
      [
        ["2026-11-05", 6000, 0, 0, 0, 110000, 110000],
        ["2026-11-10", 0, 3000, 0, 0, 107000, 107000],
        ["2026-11-12", 0, 0, 0, 2000, 107000, 105000],
        ["2026-11-20", 0, 0, 5000, 0, 107000, 110000],
      ],
    );
    assert.equal(cf.totals.closingBalanceCents, 107000);
    assert.equal(cf.totals.projectedClosingCents, 110000);
    assert.deepEqual(cf.overdue.receivable, { count: 1, cents: 700 });
    assert.deepEqual(cf.overdue.payable, { count: 0, cents: 0 });

    // isolamento: outra org não enxerga nada disso
    const other = await getCashFlow(tenantDb(B.organizationId), { from: "2026-11-01", to: "2026-11-30" }, "2026-11-16");
    assert.equal(other.rows.some((r) => r.inCents === 6000), false);
  });

  await step("relatórios: vendas por cliente e produto só com pedidos confirmados no período", async () => {
    const F = await makeOrg("f");
    const dbF = tenantDb(F.organizationId);
    const mk = (sku: string, priceCents: number) =>
      dbF.product.create({ data: { organizationId: F.organizationId, sku, name: sku, type: "FINISHED_GOOD", unit: "UN", priceCents } });
    const [pP, pQ] = [await mk("P", 1000), await mk("Q", 250)];
    await dbF.$transaction(async (tx) => {
      await registerStockMovement(tx, F, { productId: pP.id, type: "IN", quantity: "100" });
      await registerStockMovement(tx, F, { productId: pQ.id, type: "IN", quantity: "100" });
    });
    const [cx, cy] = [
      await dbF.customer.create({ data: { organizationId: F.organizationId, name: "X" } }),
      await dbF.customer.create({ data: { organizationId: F.organizationId, name: "Y" } }),
    ];
    const due = new Date("2026-12-31");
    const o1 = await createSalesOrder(dbF, F, { customerId: cx.id, discountCents: 500, items: [{ productId: pP.id, quantity: "3" }] });
    await confirmSalesOrder(dbF, F, o1.id, due);
    const o2 = await createSalesOrder(dbF, F, {
      customerId: cy.id,
      discountCents: 0,
      items: [{ productId: pQ.id, quantity: "4" }, { productId: pP.id, quantity: "1" }],
    });
    await confirmSalesOrder(dbF, F, o2.id, due);
    await createSalesOrder(dbF, F, { customerId: cx.id, discountCents: 0, items: [{ productId: pP.id, quantity: "50" }] }); // orçamento: não conta

    const rep = await getSalesReport(dbF, parsePeriod(undefined, undefined));
    assert.deepEqual(rep.totals, { orders: 2, grossCents: 5000, discountCents: 500, netCents: 4500, averageTicketCents: 2250 });
    assert.deepEqual(rep.byCustomer.map((c) => [c.name, c.orders, c.totalCents]), [["X", 1, 2500], ["Y", 1, 2000]]);
    assert.deepEqual(rep.byProduct.map((p) => [p.sku, p.quantity.toString(), p.grossCents]), [["P", "4", 4000], ["Q", "4", 1000]]);
    assert.equal(Math.round(rep.byProduct[0].sharePct), 80);

    const lastYear = await getSalesReport(dbF, { from: "2025-01-01", to: "2025-12-31" });
    assert.equal(lastYear.totals.orders, 0);
  });

  // ---- Assinatura (Asaas mockado via HTTP local) ----
  type Call = { method: string; path: string; token: string | undefined; body: Record<string, unknown> | null };
  const calls: Call[] = [];
  let subSeq = 0;
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    });
  const mock = createServer(async (req, res) => {
    const raw = await readBody(req);
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const path = req.url ?? "";
    calls.push({ method: req.method ?? "", path, token: req.headers["access_token"] as string | undefined, body });
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    };
    if (body?.cpfCnpj === "00000000000") return send(400, { errors: [{ code: "invalid_cpfCnpj", description: "O CPF/CNPJ informado é inválido." }] });
    if (req.method === "POST" && path === "/customers") return send(200, { id: `cus_${run}` });
    if (req.method === "PUT" && path.startsWith("/customers/")) return send(200, { id: path.split("/")[2] });
    if (req.method === "POST" && path === "/subscriptions") return send(200, { id: `sub_${run}_${++subSeq}`, status: "ACTIVE" });
    if (req.method === "PUT" && path.startsWith("/subscriptions/")) return send(200, { id: path.split("/")[2] });
    if (req.method === "DELETE" && path.startsWith("/subscriptions/")) return send(200, { deleted: true });
    if (req.method === "GET" && path.includes("/payments")) {
      return send(200, {
        data: [
          { id: "pay_2", status: "PENDING", invoiceUrl: "https://sandbox.asaas.com/i/pay_2", dueDate: "2026-12-16", value: 99 },
          { id: "pay_1", status: "PENDING", invoiceUrl: "https://sandbox.asaas.com/i/pay_1", dueDate: "2026-11-16", value: 99 },
        ],
      });
    }
    send(404, { errors: [{ description: "rota não mockada" }] });
  });
  await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
  const savedEnv = { url: process.env.ASAAS_API_URL, key: process.env.ASAAS_API_KEY };
  process.env.ASAAS_API_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  process.env.ASAAS_API_KEY = "test-key";

  try {
    await step("cobrança: CPF/CNPJ com dígito verificador e centavos→reais sem erro de arredondamento", () => {
      assert.ok(isValidCpfOrCnpj("529.982.247-25"));
      assert.ok(isValidCpfOrCnpj("11.222.333/0001-81"));
      assert.ok(!isValidCpfOrCnpj("529.982.247-26"));
      assert.ok(!isValidCpfOrCnpj("11111111111"));
      assert.equal(asaasTest.centsToReais(9900), 99);
      assert.equal(asaasTest.centsToReais(24990), 249.9);
      assert.equal(asaasTest.centsToReais(5), 0.05);
    });

    await step("cobrança: plano efetivo mantém o pago até o fim do período após cancelar", () => {
      const future = new Date(Date.now() + 86_400_000);
      const past = new Date(Date.now() - 1000);
      assert.equal(effectivePlan({ plan: "PRO", subscriptionStatus: "CANCELED", currentPeriodEnd: future }), "PRO");
      assert.equal(effectivePlan({ plan: "PRO", subscriptionStatus: "CANCELED", currentPeriodEnd: past }), "FREE");
      assert.equal(effectivePlan({ plan: "STARTER", subscriptionStatus: "PAST_DUE", currentPeriodEnd: past }), "STARTER");
    });

    const C = await makeOrg("c");
    await prisma.organization.update({ where: { id: C.organizationId }, data: { plan: "FREE" } });
    const orgC = () => prisma.organization.findUniqueOrThrow({ where: { id: C.organizationId } });
    const webhook = (id: string, event: string, extra: Record<string, unknown>) =>
      processAsaasWebhook({ id: `evt_${run}_${id}`, event, ...extra } as Parameters<typeof processAsaasWebhook>[0]);
    const payment = (subscription: string) => ({
      payment: { id: "pay_1", customer: `cus_${run}`, subscription, value: 99, dueDate: "2026-11-16", externalReference: "plan:STARTER" },
    });

    let firstSub = "";
    await step("cobrança: assinar cria cliente + assinatura e devolve a fatura mais antiga; plano só muda após pagar", async () => {
      const { paymentUrl } = await subscribeToPlan(C, { plan: "STARTER", cpfCnpj: "52998224725" });
      assert.equal(paymentUrl, "https://sandbox.asaas.com/i/pay_1");
      const customerCall = calls.find((c) => c.method === "POST" && c.path === "/customers")!;
      assert.equal(customerCall.token, "test-key");
      assert.equal(customerCall.body?.cpfCnpj, "52998224725");
      const subCall = calls.find((c) => c.method === "POST" && c.path === "/subscriptions")!;
      assert.equal(subCall.body?.value, 99);
      assert.equal(subCall.body?.billingType, "UNDEFINED");
      assert.equal(subCall.body?.cycle, "MONTHLY");
      const org = await orgC();
      firstSub = org.asaasSubscriptionId!;
      assert.equal(org.plan, "FREE");
      assert.equal(org.pendingPlan, "STARTER");
      assert.equal(org.asaasCustomerId, `cus_${run}`);
    });

    await step("webhook: pagamento confirmado ativa o plano; evento repetido é ignorado", async () => {
      assert.equal(await webhook("1", "PAYMENT_CONFIRMED", payment(firstSub)), "processed");
      assert.equal(await webhook("1", "PAYMENT_CONFIRMED", payment(firstSub)), "duplicate");
      const org = await orgC();
      assert.equal(org.plan, "STARTER");
      assert.equal(org.subscriptionStatus, "ACTIVE");
      assert.equal(org.pendingPlan, null);
      assert.equal(org.currentPeriodEnd?.toISOString().slice(0, 10), "2026-12-16");
    });

    await step("cobrança: upgrade altera a assinatura existente (sem criar outra) e aguarda pagamento", async () => {
      const before = calls.filter((c) => c.method === "POST" && c.path === "/subscriptions").length;
      await subscribeToPlan(C, { plan: "PRO", cpfCnpj: "52998224725" });
      assert.equal(calls.filter((c) => c.method === "POST" && c.path === "/subscriptions").length, before);
      const put = calls.filter((c) => c.method === "PUT" && c.path === `/subscriptions/${firstSub}`).at(-1)!;
      assert.equal(put.body?.value, 249);
      assert.equal(put.body?.updatePendingPayments, true);
      const org = await orgC();
      assert.equal(org.plan, "STARTER");
      assert.equal(org.pendingPlan, "PRO");
    });

    await step("webhook: evento de assinatura antiga não altera a org", async () => {
      assert.equal(await webhook("2", "PAYMENT_OVERDUE", payment("sub_antiga")), "ignored");
      assert.equal((await orgC()).subscriptionStatus, "ACTIVE");
    });

    await step("webhook: atraso bloqueia novos cadastros; pagamento libera e aplica o upgrade", async () => {
      await webhook("3", "PAYMENT_OVERDUE", payment(firstSub));
      assert.equal((await orgC()).subscriptionStatus, "PAST_DUE");
      const dbC = tenantDb(C.organizationId);
      await assert.rejects(dbC.$transaction((tx) => assertPlanLimit(tx, C, "products")), /Pagamento em atraso/);
      await webhook("4", "PAYMENT_RECEIVED", { payment: { ...payment(firstSub).payment, dueDate: "2026-12-16" } });
      const org = await orgC();
      assert.equal(org.subscriptionStatus, "ACTIVE");
      assert.equal(org.plan, "PRO");
      assert.equal(org.currentPeriodEnd?.toISOString().slice(0, 10), "2027-01-16");
      await dbC.$transaction((tx) => assertPlanLimit(tx, C, "products"));
    });

    await step("cobrança: cancelar mantém o plano até o fim do período e depois aplica limites do Grátis", async () => {
      await cancelSubscription(C);
      assert.ok(calls.some((c) => c.method === "DELETE" && c.path === `/subscriptions/${firstSub}`));
      let org = await orgC();
      assert.equal(org.subscriptionStatus, "CANCELED");
      assert.equal(effectivePlan(org), "PRO");
      await assert.rejects(cancelSubscription(C), /Não há assinatura ativa/);

      await prisma.organization.update({ where: { id: C.organizationId }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
      org = await orgC();
      assert.equal(effectivePlan(org), "FREE");
      const dbC = tenantDb(C.organizationId);
      await assert.rejects(dbC.$transaction((tx) => assertPlanLimit(tx, C, "members")), /Limite do plano Grátis/);
    });

    await step("cobrança: reassinar após cancelar cria nova assinatura", async () => {
      await subscribeToPlan(C, { plan: "STARTER", cpfCnpj: "52998224725" });
      const org = await orgC();
      assert.notEqual(org.asaasSubscriptionId, firstSub);
      assert.equal(org.pendingPlan, "STARTER");
    });

    await step("cobrança: erro de validação do Asaas vira mensagem legível; sem chave, erro claro", async () => {
      const D = await makeOrg("d");
      await assert.rejects(subscribeToPlan(D, { plan: "STARTER", cpfCnpj: "00000000000" }), /CPF\/CNPJ informado é inválido/);
      delete process.env.ASAAS_API_KEY;
      await assert.rejects(subscribeToPlan(D, { plan: "STARTER", cpfCnpj: "52998224725" }), AsaasNotConfiguredError);
    });
  } finally {
    mock.close();
    process.env.ASAAS_API_URL = savedEnv.url;
    process.env.ASAAS_API_KEY = savedEnv.key;
  }

  console.log(`\n${passed} verificações passaram.`);
}

main()
  .catch((err) => {
    console.error("\n✘ FALHOU:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
