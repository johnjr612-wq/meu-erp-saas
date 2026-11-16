import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Client "cru" do Prisma.
 * USO RESTRITO a código de plataforma (auth, membership, webhooks, billing).
 * Dados de negócio devem SEMPRE passar por `tenantDb(organizationId)`.
 */
function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Modelos de negócio: possuem `organizationId` e são isolados por tenant. */
const TENANT_MODELS = new Set([
  "Customer",
  "Supplier",
  "Product",
  "StockMovement",
  "Formula",
  "FormulaItem",
  "ProductionOrder",
  "SalesOrder",
  "SalesOrderItem",
  "BankAccount",
  "FinancialEntry",
  "FinancialPayment",
  "AuditLog",
]);

/** Modelos com soft delete: leituras ignoram registros com `deletedAt` preenchido. */
const SOFT_DELETE_MODELS = new Set([
  "Customer",
  "Supplier",
  "Product",
  "Formula",
  "SalesOrder",
  "BankAccount",
  "FinancialEntry",
]);

/** Modelos financeiros/fiscais/ledger que NUNCA podem sofrer DELETE físico. */
const NO_HARD_DELETE_MODELS = new Set([
  ...SOFT_DELETE_MODELS,
  "StockMovement",
  "FinancialPayment",
  "AuditLog",
  "SalesOrderItem",
]);

const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);
const WHERE_OPS = new Set([
  ...READ_OPS,
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

type Args = Record<string, unknown>;

function withTenant(model: string, operation: string, rawArgs: unknown, organizationId: string): Args {
  const args: Args = { ...((rawArgs ?? {}) as Args) };

  if (operation === "delete" || operation === "deleteMany") {
    if (NO_HARD_DELETE_MODELS.has(model)) {
      throw new TenantIsolationError(
        `DELETE físico proibido em ${model}. Use soft delete (deletedAt/deletedBy).`,
      );
    }
  }

  if (WHERE_OPS.has(operation)) {
    const where = { ...((args.where ?? {}) as Args) };
    if (where.organizationId !== undefined && where.organizationId !== organizationId) {
      throw new TenantIsolationError(`Tentativa de acessar outro tenant em ${model}.${operation}.`);
    }
    where.organizationId = organizationId;
    if (READ_OPS.has(operation) && SOFT_DELETE_MODELS.has(model) && !("deletedAt" in where)) {
      where.deletedAt = null;
    }
    args.where = where;
  }

  const stamp = (data: unknown): Args => {
    const d = { ...((data ?? {}) as Args) };
    if (d.organizationId !== undefined && d.organizationId !== organizationId) {
      throw new TenantIsolationError(`organizationId inválido em ${model}.${operation}.`);
    }
    // Remove a relação explícita para não conflitar e força o tenant da sessão.
    delete d.organization;
    d.organizationId = organizationId;
    return d;
  };

  if (operation === "create") args.data = stamp(args.data);
  if (operation === "createMany" || operation === "createManyAndReturn") {
    args.data = Array.isArray(args.data) ? args.data.map(stamp) : stamp(args.data);
  }
  if (operation === "upsert") args.create = stamp(args.create);
  if ((operation === "update" || operation === "updateMany") && args.data) {
    const d = args.data as Args;
    if ("organizationId" in d || "organization" in d) {
      throw new TenantIsolationError(`Não é permitido trocar o tenant de ${model}.`);
    }
  }

  return args;
}

/**
 * Client isolado por organização. Injeta `organizationId` em todos os `where`
 * e `data` de nível superior, filtra soft-deleted nas leituras e bloqueia
 * DELETE físico em registros financeiros/fiscais.
 *
 * ATENÇÃO: escritas aninhadas (ex.: `items: { create: [...] }`) não passam
 * pela extensão — informe `organizationId` manualmente nesses itens.
 */
export function tenantDb(organizationId: string) {
  if (!organizationId) throw new TenantIsolationError("organizationId ausente.");

  return prisma.$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const scoped = withTenant(model, operation, args, organizationId);
          return query(scoped as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
/** Client usado dentro de `$transaction(async (tx) => ...)` de um TenantDb. */
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
