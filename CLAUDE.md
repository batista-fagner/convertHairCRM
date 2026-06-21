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
- **Banco:** Supabase do sócio (DATABASE_URL própria)

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
| `SUPABASE_DATABASE_URL` | ⚠️ pendente | Banco Supabase do sócio |
| `UAZAPI_TOKEN` | ⚠️ pendente | Token instância WhatsApp dele |
| `MQL_NOTIFICATION_PHONE` | ⚠️ pendente | Número pra receber notificação MQL |
| `FB_PIXEL_ID` | ✅ `26684736604534893` | Pixel do sócio |
| `FB_ACCESS_TOKEN` | ✅ configurado | Token CAPI (SYSTEM_USER, não expira) |
| `OPENAI_API_KEY` | ✅ compartilhado | Mesmo do funnel-platform |
| `UAZAPI_BASE_URL` | ✅ `https://labsai.uazapi.com` | |
| `NODE_ENV` | ✅ `production` | |
| `DISABLE_GROUP_JOIN_SSE` | ✅ não colocar | SSE ativo em prod por padrão |

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

## 🤖 Sofia — Agente WhatsApp

**Equivalente ao Efraim** no funnel-platform. Prompt e nome a adaptar em:
- `backend/src/efraim/efraim.service.ts` — prompt principal
- `backend/src/efraim/group-join.service.ts` — mensagem de abertura

**Stages:** `aguardando_nome` → `aguardando_faturamento` → `abertura` → `escuta` → `rapport` → `video` → `fechamento` → `confirmado/perdido` → `encerrado`

**MQL_REVENUES:** `30k-100k`, `100k-300k`, `acima-300k`

---

## 📊 Tracking

- UTMs capturados na `ConvertHairPage` (click no botão)
- `fbclid`, `fbp`, `fbc` capturados e enviados via `keepalive: true`
- Fila FIFO no `TrackingService` — UTM consumido quando lead entra no grupo
- Sem `fbclid` → lead salvo com `utmSource: 'whatsapp-grupo'`

---

## ⚠️ Pendências

- [ ] Criar banco Supabase do sócio e preencher `SUPABASE_DATABASE_URL`
- [ ] Instância uazapi do sócio → preencher `UAZAPI_TOKEN`
- [ ] Preencher `MQL_NOTIFICATION_PHONE`
- [ ] Adaptar prompt do Efraim → Sofia (`efraim.service.ts`)
- [ ] Adaptar nome "Efraim" → "Sofia" nas mensagens (`group-join.service.ts`, `efraim.controller.ts`)
- [ ] Adaptar `ConvertHairPage` — remover formulário, adicionar redirect automático pro WhatsApp
- [ ] Deploy Railway — configurar root directory = `backend/`
- [ ] Deploy Vercel — `ConvertHairPage` com `VITE_API_URL` apontando pro Railway

---

**Última atualização:** 2026-06-21
