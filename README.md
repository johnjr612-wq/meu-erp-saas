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
- `src/modules/members` — convites (token com hash, 7 dias), cargos e remoção de membros.

## Convites de usuários

Em **Configurações**, OWNER/ADMIN convidam por e-mail. O link `/convite/<token>` é exibido para copiar
(ex.: enviar por WhatsApp) e, se `RESEND_API_KEY` e `EMAIL_FROM` estiverem configurados, também vai por e-mail.
OWNER concede ADMIN/FINANCIAL/OPERATOR; ADMIN concede FINANCIAL/OPERATOR. Convites pendentes contam no limite
de usuários do plano. Defina `APP_URL` em produção para que o link use o domínio correto.
