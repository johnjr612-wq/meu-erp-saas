# Meu ERP SaaS

ERP multi-tenant para indústrias de produtos de limpeza: produção (fórmulas, OPs, lotes), estoque (ledger com custo médio), vendas e financeiro (baixas parciais, estorno, conciliação). Regras de arquitetura em [`CLAUDE.md`](./CLAUDE.md).

## Rodando localmente

```bash
cp .env.example .env        # ajuste DATABASE_URL e gere AUTH_SECRET com: npx auth secret
npm install                 # também gera o Prisma Client
npm run db:migrate          # aplica as migrations
npm run db:seed             # empresa demo: demo@limpatudo.com.br / demo12345
npm run dev
```

## Scripts

| Script | O que faz |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:smoke` | Testa isolamento de tenant, soft delete, produção, vendas e financeiro contra o banco |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Dados de demonstração |

## Estrutura

- `src/lib/db.ts` — `tenantDb(organizationId)`: injeta o tenant em toda query e bloqueia DELETE físico em financeiro/ledger.
- `src/lib/action.ts` — `createAction`: Zod → sessão → membership → RBAC → handler.
- `src/modules/*` — regras de negócio (`service.ts`), schemas Zod e Server Actions.
- `src/app/api/webhooks/asaas` — webhook de assinatura (token + idempotência).
