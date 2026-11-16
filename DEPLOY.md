# Colocar o Meu ERP no ar

Ordem recomendada: **banco → hospedagem → e-mail → cobrança**. Tempo estimado: 1 a 2 horas
(a verificação de domínio do e-mail pode levar mais, pois depende de DNS).

> As contas abaixo precisam ser criadas por você (pedem e-mail, dados da empresa e, no Asaas, CPF/CNPJ).
> **Nunca** cole chaves e senhas em chats, e-mails ou no código. Elas vão só nas variáveis de ambiente da Vercel.

---

## 1. Banco de dados: Neon (PostgreSQL)

1. Crie uma conta em **neon.tech** e um projeto. Escolha a região **São Paulo (AWS sa-east-1)**.
2. No painel do projeto, em *Connect*, copie **duas** URLs de conexão:
   - com **connection pooling ligado** (o host contém `-pooler`) → será `DATABASE_URL`;
   - com **pooling desligado** (conexão direta) → será `DIRECT_DATABASE_URL` (usada só nas migrations).
3. Garanta que as URLs terminem com `?sslmode=require`.

## 2. Hospedagem: Vercel

> O plano **Hobby** (grátis) da Vercel é só para uso **não comercial**. Para vender o ERP como SaaS, use o plano **Pro**.

1. Crie a conta em **vercel.com** entrando com o GitHub.
2. *Add New → Project* → importe o repositório **meu-erp-saas**. O framework (Next.js) é detectado sozinho.
3. Antes de clicar em *Deploy*, abra **Environment Variables** e cadastre:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | URL do Neon **com** pooling |
| `DIRECT_DATABASE_URL` | URL do Neon **sem** pooling |
| `AUTH_SECRET` | rode `npx auth secret` no seu computador e cole o valor gerado |
| `APP_URL` | por enquanto `https://<nome-do-projeto>.vercel.app`; troque pelo seu domínio depois |

4. Clique em **Deploy**. O build roda as migrations automaticamente (`vercel-build`) e cria as tabelas.
5. Teste: abra `https://SEU_ENDERECO/api/health`. Deve aparecer `{"status":"ok"}`.
6. Crie sua conta em `/registro` (você vira o **Proprietário** da empresa). **Não** rode o `db:seed` em produção.

**Domínio próprio (opcional):** *Settings → Domains* → adicione `erp.suaempresa.com.br`, crie no seu provedor
de DNS o registro que a Vercel indicar e depois atualize `APP_URL` com o novo endereço (e faça *Redeploy*).

Se faltar alguma variável obrigatória, o log do deploy mostra `[config] Configuração inválida:` dizendo qual.

## 3. E-mail: Resend (convites e recuperação de senha)

1. Crie a conta em **resend.com**.
2. *Domains → Add Domain* → informe o domínio da empresa (ex.: `suaempresa.com.br`).
3. Crie no DNS do domínio os registros que o Resend mostrar (SPF/DKIM) e aguarde o status **Verified**.
4. *API Keys → Create* (permissão de envio) → copie a chave.
5. Na Vercel, cadastre e faça *Redeploy*:

| Variável | Valor |
| --- | --- |
| `RESEND_API_KEY` | a chave criada |
| `EMAIL_FROM` | `Meu ERP <nao-responda@suaempresa.com.br>` (precisa ser do domínio verificado) |

6. Teste: em `/recuperar-senha`, peça um link para o seu e-mail.

## 4. Cobrança: Asaas (primeiro no sandbox)

### 4.1 Sandbox (testes, sem dinheiro real)
1. Crie a conta em **sandbox.asaas.com**.
2. Em *Integrações* (ou *Minha conta → Integrações*), gere a **chave de API**.
3. Na Vercel, cadastre:

| Variável | Valor |
| --- | --- |
| `ASAAS_API_URL` | `https://api-sandbox.asaas.com/v3` |
| `ASAAS_API_KEY` | a chave do sandbox |
| `ASAAS_WEBHOOK_TOKEN` | um texto aleatório longo (ex.: gere com `openssl rand -hex 32`) |

4. No Asaas, em *Integrações → Webhooks*, crie um webhook:
   - URL: `https://SEU_ENDERECO/api/webhooks/asaas`
   - Token de autenticação: o **mesmo** valor de `ASAAS_WEBHOOK_TOKEN`
   - Eventos de **cobranças**: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`
   - Eventos de **assinaturas**: `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED`
5. *Redeploy* na Vercel.
6. Teste: em *Configurações → Assinatura*, assine o Starter com um CPF/CNPJ válido. Na fatura do sandbox, simule
   o pagamento. Em segundos o plano deve aparecer como **Ativa**.

### 4.2 Produção
Repita na conta **real** do Asaas (asaas.com, após a aprovação da conta), com
`ASAAS_API_URL=https://api.asaas.com/v3`, a chave de produção e um webhook novo. Enquanto `ASAAS_API_URL`
apontar para o sandbox, o log avisa que as cobranças não são reais.

---

## Checklist final
- [ ] `/api/health` responde `{"status":"ok"}`
- [ ] Cadastro em `/registro` e login funcionando
- [ ] Convite de usuário chega por e-mail
- [ ] "Esqueci a senha" chega por e-mail
- [ ] Assinatura no sandbox fica **Ativa** depois do pagamento simulado
- [ ] Log do deploy sem `[config] Configuração inválida` (avisos `[config]` indicam integrações que faltam)
- [ ] (Recomendado) Monitor de disponibilidade apontando para `/api/health` (ex.: UptimeRobot, grátis)
- [ ] (Recomendado) Backups do Neon: confira o período de retenção do seu plano
