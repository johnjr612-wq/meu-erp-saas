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

## Assinatura (Asaas)

Em **Configurações › Assinatura** o proprietário escolhe o plano e informa o CPF/CNPJ do pagador. O sistema cria o
cliente e uma assinatura mensal no Asaas e abre a fatura, onde o cliente paga com Pix, boleto ou cartão. O plano só
muda quando o webhook confirma o pagamento. Ao cancelar, o plano pago vale até o fim do período já pago.

Configuração:
1. `ASAAS_API_KEY` (sandbox ou produção) e `ASAAS_API_URL` (`https://api-sandbox.asaas.com/v3` ou `https://api.asaas.com/v3`).
2. No painel do Asaas, crie um webhook para `https://SEU_DOMINIO/api/webhooks/asaas` com os eventos de cobrança e
   assinatura, e defina um token igual a `ASAAS_WEBHOOK_TOKEN`.

## Recuperação de senha

Em **/recuperar-senha** o usuário informa o e-mail e recebe um link `/redefinir-senha/<token>` (uso único, 1 hora,
só o hash é salvo; máximo de 3 pedidos por hora). A resposta é sempre a mesma, exista ou não a conta. Ao salvar a nova
senha, todas as sessões abertas daquela conta são encerradas.

O envio usa o Resend (`RESEND_API_KEY` + `EMAIL_FROM`, com domínio verificado no Resend). Sem essas variáveis, em
desenvolvimento o link aparece no log do servidor; em produção o erro de configuração é registrado no log.
