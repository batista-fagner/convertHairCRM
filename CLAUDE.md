# CLAUDE.md — convertHairCRM

## 📋 Visão Geral do Projeto

**convertHairCRM** é um fork do funnel-platform adaptado para o sócio (Sofia como agente IA).
Funil: Ad Meta → ConvertHairPage (redirect) → Grupo WhatsApp → Sofia (IA) → MQL → Meta CAPI

**Tech Stack:** NestJS 11, TypeORM, PostgreSQL (Supabase), React 18 + Vite + shadcn/ui + Tailwind

**Integrações:**
- Meta Ads API (pixel `26684736604534893`)
- uazapi (WhatsApp — token do sócio)
- OpenAI GPT-4o-mini (compartilhado com funnel-platform)
- RapidAPI Instagram (compartilhado)

---

## 🏗️ Estrutura

```
convertHairCRM/
├── CLAUDE.md
├── backend/         # NestJS na porta 3002 (local)
│   ├── src/
│   └── .env         # NÃO commitar
└── frontend/        # React CRM na porta 5174 (local)
    └── .env         # VITE_API_URL=http://localhost:3002/api
```

---

## 🚀 Como Rodar Local

```bash
# Backend (porta 3002)
cd convertHairCRM/backend
npm install
npm start

# Frontend CRM (porta 5174)
cd convertHairCRM/frontend
npm install
npm run dev
```

---

## 🌐 Infraestrutura

- **Backend:** Railway → `convertHairCRM/backend/` (root directory = `backend/`)
- **Landing page:** `ConvertHairPage` → Vercel (`batista-fagner/ConvertHairPage`)
- **Banco:** Supabase próprio — projeto `bsajckksdesgwsyzutnc` (migrado em 2026-09-01, o antigo `lvnljmxppizafpbgolss` estava estourando limite de egress). ⚠️ **Sempre usar o pooler** (`aws-0-us-east-1.pooler.supabase.com`, usuário `postgres.bsajckksdesgwsyzutnc`) — o host direto (`db.<ref>.supabase.co`) só resolve em IPv6 e o Railway não tem saída IPv6 (`ENETUNREACH`), já causou downtime uma vez.
- **Storage:** mesmo projeto novo, bucket `lead-avatars` (avatares de lead, migrado junto). Carrossel usa Cloudflare R2 (`R2_BUCKET=converthair-ig`), não Supabase Storage.

---

## 🔄 Fluxo do Funil

```
Ad Meta (com UTMs) → ConvertHairPage (Vercel)
  → captura fbclid + fbp + fbc + UTMs
  → POST /api/track/click (Railway)
  → redirect automático pro grupo WhatsApp

Pessoa entra no grupo
  → SSE uazapi detecta (GroupJoinService)
  → busca nome no WhatsApp (/contacts/info)
  → cria Lead no banco
  → envia Lead event ao Meta (CAPI)
  → Sofia aborda: coleta nome (se não tiver) + faturamento

Faturamento 30k+ → MQL
  → evento MQL-CA01 enviado ao Meta (CAPI)
  → notificação WhatsApp pro sócio
  → lead marcado como MQL no CRM
```

---

## ⚙️ Variáveis de Ambiente

### Backend (Railway)

| Variável | Status | Descrição |
|----------|--------|-----------|
| `SUPABASE_DATABASE_URL` | ✅ configurado | Pooler do projeto `bsajckksdesgwsyzutnc` (migrado 2026-09-01) — nunca usar o host direto (IPv6, ver seção Infraestrutura) |
| `UAZAPI_TOKEN` | ⚠️ pendente | Token instância WhatsApp dele |
| `MQL_NOTIFICATION_PHONE` | ⚠️ pendente | Número pra receber notificação MQL |
| `FB_PIXEL_ID` | ✅ `1749062199421538` | Pixel/dataset "Convert hair" do sócio (corrigido em 2026-08-09 — valor antigo estava errado nesta doc) |
| `FB_ACCESS_TOKEN` | ✅ configurado | Token CAPI (SYSTEM_USER, não expira) |
| `OPENAI_API_KEY` | ✅ compartilhado | Mesmo do funnel-platform |
| `UAZAPI_BASE_URL` | ✅ `https://labsai.uazapi.com` | |
| `NODE_ENV` | ✅ `production` | |
| `DISABLE_GROUP_JOIN_SSE` | ✅ não colocar | SSE ativo em prod por padrão |
| `FB_LEADS_TOKEN` | ✅ configurado | Token de usuário de longa duração (~60 dias, gerado 2026-08-09, expira ~2026-10-08) com permissão `leads_retrieval` — busca os dados do Formulário Instantâneo. **Renovar antes de expirar** (ver seção abaixo) |
| `FB_LEADS_FORM_ID` | ✅ `1947596935912490` | ID do formulário "ConvertHair50" |
| `LEADGEN_WEBHOOK_VERIFY_TOKEN` | ✅ `converthair-leadgen-2026` | Verify token do webhook de Lead Ads — precisa bater com o cadastrado no App Dashboard (Meta) |

### Backend Local (.env)
- Porta: `3002`
- `DISABLE_GROUP_JOIN_SSE=true` (não escuta SSE local)

### Frontend (.env)
```
VITE_API_URL=http://localhost:3002/api
```

### ConvertHairPage (Vercel)
```
VITE_API_URL=https://<url-railway-do-socio>/api
VITE_WA_URL=https://chat.whatsapp.com/<link-do-grupo>
```

---

## 🤖 Sofia — Agente SDR WhatsApp

**Agente IA de qualificação** via WhatsApp. Conversa natural, coleta dados, qualifica leads e encaminha ao especialista.

**Webhook:** `POST /api/webhooks/sdr` (instância uazapi separada do Efraim)

**Stages (Kanban):**
1. `novo` — lead acabou de chegar, IA faz 1ª pergunta
2. `atendimento` — lead respondeu (stage=qualificacao), conversa em andamento
3. `nao-qualificado` — IA determinou fora do perfil (stage=frio)
4. `qualificado` — lead passou nos critérios (stage=quente), pronto para especialista (MQL marcado)
5. `ja-fez-prompt`, `ja-apresentado`, `em-negociacao`, `vendeu`, `perdido` — raias do operador

**Fluxo de qualificação (5 perguntas):**
1. O que a empresa vende (tipo de cabelo)
2. Tem time de vendas ou é o próprio dono que vende?
3. Quem toma as decisões (é proprietário/decisor)?
4. Já usou ou usa alguma IA?
5. O Instagram da empresa

**Critério de QUALIFICADO:**
- ✔ Atua no mercado de cabelo
- ✔ É proprietário ou decisor
- ✔ Informou o Instagram da empresa
- ✔ Respondeu **no mínimo 3 das 5 perguntas**

Quando qualificado → `stage=quente` + `handoff=true` → notificação ao operador + MQL event ao Meta

**Prompt:** `backend/src/sdr/sdr.prompt.ts` — `DEFAULT_SDR_PROMPT` (editável em Settings, com chat simulador)

**Modelo de IA:** configurável em Settings (GPT-5.4-mini ou GPT-4.1-mini)

**Desqualificação automática:** stage=frio → `aiPaused=true` (IA para de responder)

**Extração de dados:** IA retorna `instagram` no JSON → salvo no lead, exibido na notificação ao operador

---

## ⏰ Follow-up Automático

**O que faz:** Cron a cada 5 min verifica leads SDR com IA ativada que não responderam há X minutos (configurável).

**Regras:**
- IA enviou a última mensagem + lead não respondeu há X minutos → dispara 1x
- Lead responde → `followupSentAt=null` (ciclo reinicia)
- IA desativada (`aiPaused=true`) → não envia follow-up
- Stage = encerrado → pula (operador assumiu)

**Modos:**
- **Texto fixo:** você define a mensagem em Configurações
- **IA gera:** Sofia analisa histórico e cria mensagem personalizada

**Configurável em Settings → Follow-up Automático:**
- Toggle ativar/desativar
- Tempo de inatividade (minutos) — atalhos: 30min, 1h, 2h, 6h, 12h
- Modo: Texto fixo ou IA gera
- Textarea pra editar mensagem (se modo fixo)

---

## ⚙️ Settings — Configurações da Sofia

**Página de Configurações** (`/settings` no CRM):

**1. Prompt da IA SDR**
- Editor de texto grande (680px altura) com textarea
- Simulador ao lado: chat WhatsApp-style pra testar o prompt em tempo real
- Botão "Restaurar padrão" → refill textarea com DEFAULT_SDR_PROMPT
- Botão "Salvar" → persiste no banco
- Badge "Personalizado" / "Padrão" mostra status

**2. Seletor de Modelo**
- Dois botões: GPT-5.4 Mini (padrão) | GPT-4.1 Mini
- Salva automaticamente em Settings

**3. Follow-up Automático** (veja seção acima)

---

## 📋 Formulário Instantâneo (Lead Ads) — funil "MQL+30"

Segundo funil, **separado** do WhatsApp/Sofia — usa Meta Lead Ads (Formulário Instantâneo "ConvertHair50") em vez de Click-to-WhatsApp. Existe porque `business_messaging` (CTWA) só aceita `Purchase`/`LeadSubmitted` como nome de evento — aqui, via evento de CRM (`action_source: system_generated`), dá pra usar nome de evento **livre** (`MQL+30`).

**Por que existe:** testado 2x direto na Graph API — `action_source: business_messaging` rejeita qualquer `event_name` fora de `Purchase`/`LeadSubmitted` (erro `error_subcode: 2804066`). Não tem workaround; migrar pra Lead Ads foi a única forma de ter evento de qualificação com nome customizado.

### Fluxo

```
Anúncio (Formulário Instantâneo "ConvertHair50")
  → Q1 (o que vende) — "quero comprar cabelo" descarta aqui
  → Q2 (quantas msgs/dia no WhatsApp)
      < 10 → descarta
      10-30 → Q5 (faz tráfego pago?) → Q6 (telefone) ou descarta
      30-40 / acima de 50 → Q3 → Q4 → Q6 (telefone)   ← caminho "MQL+30"
  → Meta gera lead_id (só quem chega no telefone vira lead de verdade)
  → Webhook Meta → POST /api/webhooks/leadgen
  → backend busca dados completos (Graph API + FB_LEADS_TOKEN)
  → salva no CRM (todo lead, independente de qualificação)
  → se Q2 = "Entre 30 e 40" ou "Acima de 50" → dispara evento "MQL+30" pro Meta
```

**Diferença de qualificação:** o único sinal que separa MQL+30 de lead comum é a resposta da Q2 (ambos convergem no mesmo Q6/confirmação) — não dá pra saber pelo caminho de perguntas sozinho, só pela resposta.

### Arquitetura (backend)

- `backend/src/instant-forms/instant-forms.controller.ts` — webhook (`GET` verify + `POST` receive) em `/api/webhooks/leadgen`
- `backend/src/instant-forms/instant-forms.service.ts` — busca `field_data` via Graph API, faz matching por substring do nome da pergunta (não dá pra confiar em chave exata — nomes de campo custom do Meta variam), salva o lead, decide MQL+30, chama `FacebookService.sendCrmLeadEvent`
- `backend/src/instant-forms/instant-form-leads.controller.ts` — endpoints de leitura pra tela do CRM: `GET /api/instant-form-leads` (lista, filtro `?mql30=true|false`) e `GET /api/instant-form-leads/stats`
- `FacebookService.sendCrmLeadEvent()` (`facebook.service.ts`) — evento de CRM genérico (`event_source: crm`, `action_source: system_generated`, `user_data.lead_id`) — mesmo pixel/dataset do CAPI normal (`FB_PIXEL_ID` + `FB_ACCESS_TOKEN`), mas `FB_LEADS_TOKEN` é usado só pra **ler** os dados do lead (permissão `leads_retrieval`, token diferente)
- `Lead` entity ganhou 2 campos novos: `formAnswers` (jsonb, `field_data` bruto) e `formMql30` (boolean)

### Tela no CRM

`/instant-form-leads` (menu "Formulário Instantâneo", grupo Funil) — tabela com nome/telefone/status/badge MQL+30/data, filtro Todos/MQL+30/Comum, e modal "Ver respostas" com o Q&A completo. **Não é Kanban** de propósito — não tem estágio de abordagem definido ainda (ver pendências).

### Setup no Meta (já feito, referência se precisar refazer)

- App usado: **CRM-CLAUDE** (App ID `985107870705224`), conectado ao portfólio "BM - afiliado" (Configurações do Negócio → Apps)
- Permissão `leads_retrieval` concedida via login OAuth pessoal (não System User — token de usuário de longa duração via `fb_exchange_token`)
- Webhook: App Dashboard → Webhooks → objeto **Page** → URL `https://converthaircrm-production.up.railway.app/api/webhooks/leadgen` → campo `leadgen` assinado
- Testado com sucesso via botão "Teste" do App Dashboard (payload fake, confirma que o webhook chega e é processado)

## 📊 Tracking

- UTMs capturados na `ConvertHairPage` (click no botão)
- `fbclid`, `fbp`, `fbc` capturados e enviados via `keepalive: true`
- Fila FIFO no `TrackingService` — UTM consumido quando lead entra no grupo
- Sem `fbclid` → lead salvo com `utmSource: 'whatsapp-grupo'`

---

## ✅ Features Implementadas (2026-06-29)

**Kanban SDR com 9 raias:**
- ✅ Novo Lead → Atendimento → Não qualificado / Qualificado → raias do operador
- ✅ Socket.IO em tempo real (lead:created, lead:updated, lead:handoff)
- ✅ Drag & drop entre raias (operador move manualmente)
- ✅ Modal de conversa com histórico + switch pausar IA

**Sofia — Agente de Qualificação:**
- ✅ 5 perguntas obrigatórias antes de encaminhar
- ✅ Prompt customizável em Settings + chat simulador
- ✅ Seletor de modelo (GPT-5.4 Mini / GPT-4.1 Mini)
- ✅ Extração de Instagram durante conversa
- ✅ Desqualificação automática (stage=frio → IA desliga)
- ✅ Handoff com notificação WhatsApp ao operador

**Follow-up Automático:**
- ✅ Cron a cada 5 min
- ✅ Modos: texto fixo ou IA gera personalizado
- ✅ Tempo configurável + atalhos rápidos
- ✅ Respeita IA desativada (`aiPaused=true`)

**Frontend:**
- ✅ Login seguro (SHA-256 + sessionStorage)
- ✅ Settings preenche tela toda + responsivo
- ✅ Chat simulador com scroll interno
- ✅ `vercel.json` para SPA routing (F5 funciona)

---

## 🖥️ Monitorar logs do Railway (produção)

CLI já instalado e logado nessa máquina (`~/.railway/config.json` já vinculado ao projeto
`stellar-emotion` / serviço `convertHairCRM` — não precisa `railway login` nem `railway link`
de novo, só rodar de dentro da pasta `convertHairCRM`).

**Ver status do deploy:**
```bash
cd /Users/fagnerbatista/Documents/planningPsi/convertHairCRM && railway status
```

**Monitorar logs de aplicação (eventos SDR/CAPI + qualquer erro), sem duplicar histórico a cada reconexão:**
```bash
cd /Users/fagnerbatista/Documents/planningPsi/convertHairCRM && while true; do railway logs 2>&1; sleep 3; done | grep --line-buffered -E "\[SDR\]|LeadSubmitted|Purchase|\bMQL\b|evento.*Meta|qualificado|ERROR|Erro|Exception|Traceback" | awk '!seen[$0]++'
```

**Monitorar logs HTTP (confirma se o webhook `/webhooks/sdr` está chegando), sem duplicar:**
```bash
cd /Users/fagnerbatista/Documents/planningPsi/convertHairCRM && while true; do railway logs --http 2>&1; sleep 3; done | grep --line-buffered -E "webhooks/sdr" | awk '!seen[$0]++'
```

**Ver logs recentes sem ficar monitorando (janela de tempo fixa):**
```bash
cd /Users/fagnerbatista/Documents/planningPsi/convertHairCRM && railway logs --since 15m
```

⚠️ Os dois comandos de monitor ficam rodando indefinidamente (`while true`) — os processos morrem
quando a sessão do Claude Code/computador fecha. Precisa rodar de novo a cada nova sessão se quiser
acompanhar ao vivo.

---

## ⚠️ Pendências

- [ ] Configurar instância uazapi separada do SDR (`SDR_UAZAPI_TOKEN`, `SDR_UAZAPI_BASE_URL`)
- [ ] Preencher `SDR_OPERATOR_PHONE` (número do sócio para notificações)
- [ ] Definir prompt final da Sofia em Settings (baseado no padrão fornecido)
- [ ] Testar end-to-end: lead entra → fluxo completo → MQL
- [ ] Resolver bloqueio de IP da RapidAPI no Railway (ver memória `project_converthaircrm_rapidapi_ip_block`)
- [ ] **Renovar `FB_LEADS_TOKEN`** antes de ~2026-10-08 (token de 60 dias, gerado 2026-08-09) — sem isso o webhook do Formulário Instantâneo para de buscar dados dos leads
- [ ] Testar o funil do Formulário Instantâneo com um envio **real** (só foi testado com payload fake do App Dashboard até agora)
- [ ] Decidir o "passo 9" do funil MQL+30: como vai ser a abordagem humana pós-captura (WhatsApp exige template aprovado pra iniciar conversa, já que quem preenche o formulário não manda mensagem primeiro) — e só depois disso definir se vale virar Kanban
- [ ] Separar nos relatórios do Meta o `Purchase` simbólico do MQL (WhatsApp, value=1) da venda real (`Purchase` do botão "Converter Agora") — hoje só têm `event_id` diferentes (evita duplicata), mas aparecem juntos no Ads Manager. Ver opções A/B/C discutidas (Custom Conversion por valor, `content_name`, ou parar de mandar o simbólico)
- [ ] **Migração Redis+BullMQ do sdr-followup: trocar scan de 5 em 5 min por job por lead (Opção A do plano)** — hoje (`QUEUE_ENGINE=bullmq`, ativado em 2026-08-22) o `SdrFollowupQueueService` só trocou quem aciona o scan (era `@Cron`, agora é `upsertJobScheduler` do BullMQ), mas o disparo continua sendo uma varredura completa a cada 5 min (`runFollowupScan()` em `sdr-followup.service.ts`), não orientado a evento. Ficou assim de propósito na migração (ver `sdr-followup-scan.processor.ts` e plano em `/Users/fagnerbatista/.claude/plans/spicy-humming-boole.md`, seção "Fase 3") por ser a área de maior risco do sistema (envia WhatsApp real, já causou duplicidade uma vez). Trocar para job por lead — agendado exatamente pro momento do próximo toque de cada lead, sem scan nenhum — elimina esse polling residual. Mexe em 5 pontos de mutação de estado (`sendFollowup`/`sendFollowupVideo`, reset em massa no `followup.controller.ts`, reset por resposta em `sdr.controller.ts`, `broadcastNow()`) — fazer isolado, com bastante teste antes de subir em produção.

---

**Última atualização:** 2026-08-23
