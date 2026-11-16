import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { tenantDb, TenantIsolationError, type TenantDb } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { assertPermission, ForbiddenError, type Permission } from "@/lib/permissions";
import { getOrgContext, UnauthorizedError, type OrgContext } from "@/lib/session";
import { Prisma } from "@/generated/prisma/client";

export type ActionResult<T = unknown> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

type HandlerArgs<I> = { ctx: OrgContext; db: TenantDb; input: I };

/** Converte FormData em objeto simples (campos vazios viram undefined). */
function formDataToObject(fd: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("$ACTION")) continue; // metadados internos do React
    if (typeof value === "string" && value.trim() === "") continue;
    obj[key] = value;
  }
  return obj;
}

const baseSchema = z.object({ orgSlug: z.string().min(1) });

/**
 * Fábrica de Server Actions seguras. Ordem garantida:
 * 1. Zod valida o input  2. sessão autenticada  3. membership na org do slug
 * 4. RBAC  5. handler com client isolado pelo tenant  6. revalidação de rota.
 *
 * O `orgSlug` vem no input, mas o `organizationId` é SEMPRE resolvido no servidor
 * a partir da membership do usuário logado.
 */
export function createAction<S extends z.ZodObject, T>(opts: {
  schema: S;
  permission: Permission;
  /** Caminho relativo à org para revalidar, ex.: "/estoque". */
  revalidate?: string;
  successMessage?: string;
  /**
   * Caminho relativo à org para onde ir após sucesso (ex.: "/cadastros" após excluir).
   * O redirect é feito no servidor: a página atual pode nem existir mais (registro excluído).
   */
  redirectTo?: string;
  handler: (args: HandlerArgs<z.output<S>>) => Promise<T>;
}) {
  const schema = baseSchema.extend(opts.schema.shape);

  return async function action(input: FormData | Record<string, unknown>): Promise<ActionResult<T>> {
    const raw = input instanceof FormData ? formDataToObject(input) : input;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Dados inválidos. Verifique os campos.",
        fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>,
      };
    }

    let result: ActionResult<T>;
    let redirectPath: string | null = null;
    try {
      // orgSlug só serve para resolver o contexto; nunca chega ao handler
      // (handlers repassam o input ao Prisma e um campo extra quebra a escrita).
      const { orgSlug, ...input } = parsed.data as { orgSlug: string } & Record<string, unknown>;
      const ctx = await getOrgContext(orgSlug);
      if (!ctx) throw new ForbiddenError("Organização não encontrada.");
      assertPermission(ctx, opts.permission);

      const data = await opts.handler({
        ctx,
        db: tenantDb(ctx.organizationId),
        input: input as z.output<S>,
      });

      if (opts.revalidate) revalidatePath(`/${ctx.orgSlug}${opts.revalidate}`);
      if (opts.redirectTo) redirectPath = `/${ctx.orgSlug}${opts.redirectTo}`;
      result = { ok: true, data, message: opts.successMessage };
    } catch (err) {
      result = { ok: false, error: toUserMessage(err) };
    }
    // fora do try: redirect() funciona lançando uma exceção interna do Next
    if (redirectPath) redirect(redirectPath);
    return result;
  };
}

function toUserMessage(err: unknown): string {
  if (err instanceof DomainError || err instanceof ForbiddenError || err instanceof UnauthorizedError) {
    return err.message;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return "Já existe um registro com esses dados.";
    if (err.code === "P2025") return "Registro não encontrado.";
  }
  if (err instanceof TenantIsolationError) {
    console.error("[SECURITY] Violação de isolamento de tenant:", err.message);
    return "Operação não permitida.";
  }
  console.error("[action] erro inesperado:", err);
  return "Erro inesperado. Tente novamente.";
}
