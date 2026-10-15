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
| `FB_LEADS_TOKEN` | ✅ configurado | Token de usuário de longa duração (~60 dias) com `leads_retrieval` — busca os dados do Formulário Instantâneo. **Expira em 2026-12-13 — renovar antes** (ver seção Formulário Instantâneo) |
| `FB_LEADS_FORM_ID` | ✅ `1947596935912490` | ID do formulário "ConvertHair50" |
| `LEADGEN_WEBHOOK_VERIFY_TOKEN` | ✅ `converthair-leadgen-2026` | Verify token do webhook de Lead Ads — precisa bater com o cadastrado no App Dashboard (Meta) |
| `JWT_SECRET` | ⚠️ obrigatório | Assina o login do CRM. **Sem ele o backend nem sobe** (AuthModule lança erro no boot) |
| `JWT_EXPIRES_IN` | opcional | Duração da sessão, padrão `7d` |
| `RESEND_API_KEY` | ⚠️ pendente | Mesma chave do fisio-secretary — envia os dados de acesso dos usuários |
| `RESEND_FROM_EMAIL` | opcional | Padrão `Convert Hair <contato@converthair.com.br>` (domínio já verificado no Resend) |
| `CRM_URL` | opcional | URL do front (sem `/login`) — vira o link "Entrar no CRM" no email de acesso |

### 🔐 Login (JWT) — `backend/src/auth/`
- Tabela `users` (email, nome, senha bcrypt, `role` = `socio` | `sdr`, `active`). Sócio gerencia usuários em **Sistema → Usuários** (`/usuarios`): cria (senha gerada e enviada por email via Resend; se o email falhar, a senha aparece na tela), reenvia acesso (gera senha nova), troca papel, desativa.
- **Guard global**: toda rota da API exige `Authorization: Bearer <jwt>`. **Rota chamada de fora do CRM (webhook novo, página pública do ConvertHairPage) precisa de `@Public()`** (`auth/auth.decorators.ts`), senão passa a responder 401. GET também aceita `?token=` (links de download / conectar Google Calendar).
- O guard confere no banco se o usuário segue ativo (cache 60s, invalidado ao editar) — desativar corta o acesso na hora.
- Socket.IO (`RealtimeGateway`) recusa conexão sem JWT em `handshake.auth.token`.
- Front: `frontend/src/lib/auth.js` intercepta o `fetch` global (anexa o token, 401 → volta pro login). Sessão em `localStorage`. Não há mais bypass de login em dev.
- Primeiro sócio (a tela exige estar logado): `npm run create-user -- email@x.com "Nome" socio [senha]` no `backend/`.
- Pendente: troca de senha pelo próprio usuário.

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
6. Raias **criadas pelo usuário** direto no Kanban (botão "Nova raia") — ver seção "Raias customizadas do Kanban" abaixo. A IA nunca move um lead pra nenhuma delas.

**Fluxo de qualificação (2 perguntas — desde 2026-10-01):**
Abertura = saudação (bolha 1, calculada no código) + já a pergunta 1 (bolha 2).
1. Quantas mensagens recebe por dia no WhatsApp? (`mensagensPorDia`)
2. Faz tráfego pago? (`investeAnuncio`) — só perguntada se volume >= 15

**Critério de QUALIFICADO:** `mensagensPorDia >= 10` (`MIN_MENSAGENS_POR_DIA` em `sdr.service.ts`), faça tráfego ou não. Não pergunta mais se vende cabelo nem Instagram — só desqualifica `vendeCabelo=false` se o lead disser espontaneamente (ou cliente final comprando pra si).

- Volume >= 15 → MQL pro Meta na hora (raia "qualificado")
- Resposta de tráfego (ou Sofia desistiu dela → `stage=encerrado`) → handoff: mensagem de transferência + `aiPaused=true` + notificação ao operador (inclui "Faz tráfego pago: sim/não")
- Não soube estimar volume (`semEstimativaVolume`) → também faz handoff, sem virar MQL
- Volume < 15 / iniciante → encerra, stage=frio, IA pausa

⚠️ O prompt que roda em produção é o salvo no banco (`settings.sdr_prompt`), não o do código — mudança de fluxo exige atualizar os dois (e subir o código ANTES de trocar o do banco, senão a lógica de qualificação/handoff fica desalinhada).

**Prompt:** `backend/src/sdr/sdr.prompt.ts` — `DEFAULT_SDR_PROMPT` (editável em Settings, com chat simulador)

**Modelo de IA:** configurável em Settings (GPT-5.4-mini ou GPT-4.1-mini)

**Desqualificação automática:** stage=frio → `aiPaused=true` (IA para de responder)

**Extração de dados:** IA retorna `mensagensPorDia` / `investeAnuncio` no JSON → salvos no lead, exibidos na notificação ao operador

---

## 👩‍💼 Login da SDR (agendamentos por telefone)

**O que é:** um segundo login (`sessionStorage.crm_role = 'sdr'`) pra uma SDR humana ligar pros leads e agendar call — sem envolver a Sofia (IA). Adicionado em 2026-09-23.

**Como funciona:**
- `frontend/src/pages/Login.jsx` — segundo par de credenciais via env (`VITE_SDR_USER` / `VITE_SDR_PASSWORD_HASH`, mesmo esquema SHA-256 client-side do login do sócio — **não é autenticação real de backend**, é o mesmo nível de proteção que já existia). Login como SDR grava `crm_role='sdr'` no `sessionStorage` e manda direto pro `/kanban`.
- `frontend/src/App.jsx` (`RequireRole`) — com `crm_role='sdr'`, qualquer rota fora de `/kanban` redireciona de volta pra lá (mesmo digitando a URL direto).
- `frontend/src/components/Layout.jsx` — menu lateral da SDR só mostra "Kanban" (array `SDR_NAV_GROUPS`); o sócio continua vendo o menu completo.
- A SDR enxerga o **mesmo board** de leads que o sócio (não é uma view filtrada) — só o menu é mais curto.
- Fluxo de trabalho sugerido: SDR liga pro lead → se agendar, arrasta o card pra uma raia tipo "Agendamentos"; enquanto está no meio da ligação/tentativa, usa uma raia tipo "Atendimento pelo SDR" (essas raias não existem prontas — o sócio cria pelo Kanban, ver seção abaixo). Se a Sofia (IA) ainda estiver ativa nesse lead, ela continua respondendo normalmente — a SDR precisa pausar manualmente (switch que já existe no card/modal do Kanban) antes de assumir a conversa.

**Agendamento de reunião pro closer** (adicionado em 2026-10-01): no modal do lead (Kanban), botão "Reunião" abre um campo de data/hora. Salvar chama `PATCH /leads/:id/meeting` (`leads.controller.ts`), grava `leads.meeting_at` e manda WhatsApp (instância do CRM, `SDR_UAZAPI_TOKEN`) pros números de Configurações → "Aviso de Reunião Agendada (closer)" (setting `meeting_notify_phones`). Avisa ao agendar, remarcar e desmarcar; o card mostra um selo com a data. Não move o card de raia sozinho e não manda lembrete antes da reunião.

⚠️ **Limitação conhecida (mesma do login do sócio):** é só uma trava de UI. Nenhum endpoint do backend valida token/role — quem tiver a URL da API pode chamar qualquer rota direto. Não é um problema novo introduzido aqui, é a mesma superfície que o CRM já tinha.

---

## 🧩 Raias customizadas do Kanban

**O que é:** qualquer raia além das fixas listadas acima pode ser criada, renomeada e excluída **pelo próprio usuário**, direto no Kanban — sem precisar de deploy. Adicionado em 2026-09-23 (ex.: as raias de trabalho da SDR).

**Como funciona:**
- `backend/src/common/entities/kanban-custom-stage.entity.ts` — tabela `kanban_custom_stages` (`id`, `stage_key`, `title`, `created_at`). `stage_key` é gerado (slug do título) na criação e **nunca muda** depois — mesmo que o título seja renomeado, senão todo lead que já está na raia ficaria com `kanban_stage` apontando pra uma chave inexistente.
- `LeadsService.getCustomStages/createCustomStage/renameCustomStage/deleteCustomStage` (`leads.service.ts`) + rotas em `leads.controller.ts`: `GET/POST /leads/kanban-stages`, `PATCH/DELETE /leads/kanban-stages/:id`.
- `LeadsService.findKanban()` une `KANBAN_STAGES` (fixas) com as raias customizadas antes de montar o board — uma raia nova aparece automaticamente pra quem abrir o Kanban, sem mexer em nenhum código.
- Excluir uma raia é bloqueado (409) enquanto ela tiver leads dentro — precisa mover os leads pra outra raia antes.
- Frontend: `frontend/src/pages/KanbanLeads.jsx` — botão "Nova raia" no fim do board; raias customizadas ganham ícone/cor genéricos (ciclam por `CUSTOM_COLUMN_STYLES`) e mostram lápis (renomear) e lixeira (excluir) no cabeçalho — as raias fixas não têm esses controles.
- A IA (Sofia) nunca move um lead pra uma raia customizada — `deriveKanbanStage` (`sdr.service.ts`) só conhece as fixas. São raias 100% manuais (drag-and-drop).

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

## 📋 Formulário Instantâneo (Lead Ads) — campanha "Tráfego pago" (serviço de tráfego)

Segundo funil, **separado** do WhatsApp/Sofia — usa Meta Lead Ads (formulário nativo do Instagram/Facebook, "ConvertHair - Trafego Pago") em vez de Click-to-WhatsApp. O formulário é **condicional**: quem desqualifica cai numa página de "não lead" e nada é enviado; só chega ao CRM quem completa e envia (e é esse que o Meta cobra como lead). **Não há evento de qualificação** (o antigo `MQL+30` foi removido em 2026-10-14 — o filtro de qualidade é o próprio formulário). Nome, e-mail e telefone vêm **preenchidos automaticamente** do perfil.

### Fluxo

```
Anúncio (formulário instantâneo) → lead envia
  → Meta chama POST /api/webhooks/leadgen (Page webhook do app "ConvertHair Leads")
  → backend busca os dados completos (Graph API + FB_LEADS_TOKEN): respostas + campanha/conjunto/anúncio/plataforma
  → salva no CRM (utm_source=formulario-instantaneo) e cria o card na raia "Novo" do Kanban
     com a Sofia PAUSADA (agentMode='sdr', aiPaused=true) — abordagem pessoal (SDR/closer liga)
```

**Rastreamento do anúncio:** campanha → `utm_campaign`, conjunto → `utm_term`, anúncio → `utm_content`, plataforma (instagram/facebook) → `utm_medium`; os IDs (`anuncio_id | conjunto_id | campanha_id`) ficam no início do `notes`. Se o lead já existia (mesmo telefone, outro canal), mantém a origem original e só preenche o que estava vazio. Se o Meta recusar os campos de anúncio, o backend repete só com os básicos (o lead não se perde). Leads de teste do Meta não trazem campanha/anúncio.

### Arquitetura (backend)

- `backend/src/instant-forms/instant-forms.controller.ts` — webhook (`GET` verify + `POST` receive) em `/api/webhooks/leadgen` (`@Public()`)
- `backend/src/instant-forms/instant-forms.service.ts` — busca `field_data`, faz matching por substring do nome da pergunta (nome: `full_name`/`nome`; telefone: `número`/`numero`/`phone`/`telefone` — **o 1º campo que casar vence**), salva o lead e grava a origem do anúncio
- `backend/src/instant-forms/instant-form-leads.controller.ts` — leitura pra tela: `GET /api/instant-form-leads` e `/stats`
- `Lead.formAnswers` (jsonb, `field_data` bruto). A coluna `form_mql_30` ficou no banco sem uso.
- `FacebookService.sendCrmLeadEvent()` existe mas **não é mais chamado** (evento de CRM genérico, `action_source: system_generated`).

### Tela no CRM

O lead também aparece no **Kanban** (raia Novo, IA pausada; constante `KANBAN_ENTRY` em `instant-forms.service.ts` — pra ligar a Sofia nesse funil, tirar o `aiPaused`). A tela `/instant-form-leads` (menu "Formulário Instantâneo") continua como relatório com as respostas completas — total, tabela com nome/telefone/status/campanha›anúncio/data e modal "Ver respostas". **Não atualiza sozinha** (recarregar). Não é Kanban de propósito.

### Setup no Meta (refeito em 2026-10-14)

- **App novo: "ConvertHair Leads" (ID `2843338079378067`)**, dono = portfólio "BM - afiliado" (o mesmo da Página). O app antigo CRM-CLAUDE (`985107870705224`) pertence a outro portfólio e **nunca recebeu leads reais** (Página não estava ligada a ele, app em modo desenvolvimento) — não usar.
- Permissões do app: `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `business_management`. **App publicado** (sem isso só chegam leads de teste).
- Webhook: App Dashboard → Casos de uso → Webhooks → objeto **Page** → URL `https://converthaircrm-production.up.railway.app/api/webhooks/leadgen`, verify token `LEADGEN_WEBHOOK_VERIFY_TOKEN`, campo `leadgen` assinado.
- **Página ligada ao app:** `POST /{page_id}/subscribed_apps?subscribed_fields=leadgen` com token de Página (Página `Convert hair` = `1169787736220659`). Conferir com `GET /{page_id}/subscribed_apps` — se não listar o app, nenhum lead chega.
- Teste: developers.facebook.com/tools/lead-ads-testing → "Ver prévia do formulário" (envio real com dados preenchidos; o botão "Criar lead" gera dados fictícios; só 1 lead por formulário, excluir antes de refazer).
- `FB_LEADS_TOKEN`: token de usuário (~60 dias) com `leads_retrieval`, **expira 2026-12-13**. Renovar: Graph API Explorer → gerar token → depurador de token → "Estender token de acesso" (pede a senha do Facebook).

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

- [ ] **Configurar `VITE_SDR_USER`/`VITE_SDR_PASSWORD_HASH` no Vercel do frontend do CRM** — código já pronto (ver seção "Login da SDR" acima), mas sem essas env vars a SDR não consegue logar em produção. Credenciais geradas nesta sessão: usuário `sdr`, hash em posse do sócio (repassar a senha à SDR por fora, não fica em texto no repositório).
- [ ] Configurar instância uazapi separada do SDR (`SDR_UAZAPI_TOKEN`, `SDR_UAZAPI_BASE_URL`)
- [ ] Preencher `SDR_OPERATOR_PHONE` (número do sócio para notificações)
- [ ] Definir prompt final da Sofia em Settings (baseado no padrão fornecido)
- [ ] Testar end-to-end: lead entra → fluxo completo → MQL
- [ ] Resolver bloqueio de IP da RapidAPI no Railway (ver memória `project_converthaircrm_rapidapi_ip_block`)
- [ ] **Renovar `FB_LEADS_TOKEN`** antes de **2026-12-13** (token de 60 dias) — sem isso o webhook do Formulário Instantâneo para de buscar os dados dos leads
- [ ] Definir a abordagem humana pós-captura do Formulário Instantâneo (WhatsApp exige template aprovado pra iniciar conversa, já que quem preenche o formulário não manda mensagem primeiro) — só depois definir se vale virar Kanban
- [ ] Separar nos relatórios do Meta o `Purchase` simbólico do MQL (WhatsApp, value=1) da venda real (`Purchase` do botão "Converter Agora") — hoje só têm `event_id` diferentes (evita duplicata), mas aparecem juntos no Ads Manager. Ver opções A/B/C discutidas (Custom Conversion por valor, `content_name`, ou parar de mandar o simbólico). **Escolhida (2026-10-13, ainda não feita): B** — `custom_data.content_name` = `mql_whatsapp` no Purchase simbólico (`sendMqlEvent`) e `venda` no real (`sendPurchaseEvent`). Confirmar antes se o Gerenciador de Eventos aceita Conversão Personalizada sobre evento `business_messaging`; se não aceitar, alternativa é painel de ROAS real no CRM (gasto via API do Meta + vendas do banco). Não muda a otimização (ela segue no Purchase padrão, que soma MQL + venda)
- [ ] **Migração Redis+BullMQ do sdr-followup: trocar scan de 5 em 5 min por job por lead (Opção A do plano)** — hoje (`QUEUE_ENGINE=bullmq`, ativado em 2026-08-22) o `SdrFollowupQueueService` só trocou quem aciona o scan (era `@Cron`, agora é `upsertJobScheduler` do BullMQ), mas o disparo continua sendo uma varredura completa a cada 5 min (`runFollowupScan()` em `sdr-followup.service.ts`), não orientado a evento. Ficou assim de propósito na migração (ver `sdr-followup-scan.processor.ts` e plano em `/Users/fagnerbatista/.claude/plans/spicy-humming-boole.md`, seção "Fase 3") por ser a área de maior risco do sistema (envia WhatsApp real, já causou duplicidade uma vez). Trocar para job por lead — agendado exatamente pro momento do próximo toque de cada lead, sem scan nenhum — elimina esse polling residual. Mexe em 5 pontos de mutação de estado (`sendFollowup`/`sendFollowupVideo`, reset em massa no `followup.controller.ts`, reset por resposta em `sdr.controller.ts`, `broadcastNow()`) — fazer isolado, com bastante teste antes de subir em produção.

---

**Última atualização:** 2026-09-23
