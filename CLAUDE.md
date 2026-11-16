@AGENTS.md

# Arquitetura e Regras - ERP SaaS

## Stack Tecnológica
- **Framework:** Next.js 16 (App Router) com TypeScript estrito (`strict: true`).
  - Next 16: `middleware.ts` virou `src/proxy.ts`; `params`/`searchParams`/`cookies()` são assíncronos.
- **Estilização/UI:** Tailwind CSS v4 + Shadcn/UI (`src/components/ui`) + Lucide Icons.
- **Banco de Dados & ORM:** PostgreSQL + Prisma 7 (`prisma.config.ts`, client gerado em `src/generated/prisma`, driver adapter `@prisma/adapter-pg`).
- **Autenticação:** Auth.js (NextAuth v5) com Credentials + JWT. Organizações/membros são modelados no nosso banco.
- **Pagamentos SaaS:** Asaas via Webhook (`/api/webhooks/asaas`), isolado em `src/modules/billing`.
- **Validação:** Zod em todos os inputs de API e Server Actions.

## Regras Críticas de Negócio (NUNCA VIOLAR)
1. **Multi-Tenancy Estrito:** TODA tabela de negócio (produtos, clientes, vendas, financeiro) DEVE ter a coluna `organizationId`.
2. **Isolamento de Queries:** Nenhuma query no banco pode ser executada sem filtrar explicitamente pelo `organizationId` da sessão autenticada.
   - Use SEMPRE `tenantDb(organizationId)` (`src/lib/db.ts`) para dados de negócio. Ele injeta `organizationId` em `where`/`data` das operações de nível superior.
   - Escritas aninhadas (`items: { create: [...] }`) NÃO são cobertas pela extensão: informe `organizationId` manualmente em cada item.
   - O client cru `prisma` só pode ser usado em código de plataforma (auth, membership, webhooks) — nunca em páginas/módulos de negócio.
3. **Integridade Financeira:** Valores monetários em centavos (`Int`, sufixo `Cents`). Quantidades em `Decimal(14,3)`. Nunca use `Float` nem `parseFloat` para dinheiro (use `src/lib/money.ts`).
4. **Auditoria e Soft Delete:** Registros financeiros e fiscais não são deletados fisicamente. Use `deletedAt`/`deletedBy`, preencha `updatedBy` e grave `AuditLog`. O `tenantDb` bloqueia `delete`/`deleteMany` nesses modelos.
5. **Segurança:** Valide permissões (RBAC: `OWNER`, `ADMIN`, `FINANCIAL`, `OPERATOR`) no back-end antes de qualquer mutação, via `createAction({ permission })` (`src/lib/action.ts`) ou `assertPermission`.

## Convenções de Código
- Server Actions para mutações internas (`src/modules/*/actions.ts`, criadas com `createAction`); Route Handlers (`/api/webhooks/...`) para integrações externas.
- Lógica de negócio fica em `src/modules/<modulo>/service.ts` (sem React). Schemas Zod em `schemas.ts`.
- Componentes de UI não importam Prisma; páginas (Server Components) leem via `tenantDb` e passam dados prontos.
- Estoque é um razão (ledger): só altere saldo via `registerStockMovement` dentro de transação.
- Sempre rode `npx tsc --noEmit` após criar ou alterar múltiplos arquivos.
