# Serviço de render separado do backend NestJS de propósito: o commit
# a254a2d (2026-06-27) removeu o puppeteer do backend porque o Chromium
# (~577MB) quebrava o build no Railway. O Remotion precisa do mesmo Chromium
# — por isso mora aqui, isolado, e não no backend.
#
# ATENÇÃO — build context é a RAIZ do repositório (Root Directory "/" no
# Railway, RAILWAY_DOCKERFILE_PATH=render-service/Dockerfile), não esta pasta.
# É assim de propósito: copiamos frontend/src/remotion pra dentro desta
# imagem, pra preview (Vite) e render (aqui) compilarem exatamente o mesmo
# código React. Todo COPY abaixo é relativo à raiz do repo.
FROM node:22-bookworm-slim

# ffmpeg pro preparo/finalização (Etapa 2) + as bibliotecas do Chrome Headless
# Shell que o Remotion usa pra render (lista oficial em remotion.dev/docs/docker).
# ATENÇÃO: libasound2 é o nome certo no bookworm — no trixie virou
# libasound2t64 e o build quebra, então não trocar a imagem base sem revisar.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates \
    libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 \
    libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 \
    libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY render-service/package.json render-service/package-lock.json ./
RUN npm ci --omit=dev

# Fontes hospedadas no repo (nunca buscadas pela rede durante o render — um
# render de vários minutos não pode depender de fonts.gstatic.com responder)
# e as composições React compartilhadas com o preview do CRM.
COPY frontend/public ./public
COPY frontend/src/remotion ./src/remotion
COPY render-service/src ./src
COPY render-service/scripts ./scripts

# Baixa o Chrome Headless Shell e empacota as composições em tempo de BUILD —
# nenhum job paga esse custo em runtime.
RUN node scripts/ensure-browser.mjs
RUN node scripts/bundle.mjs

ENV NODE_ENV=production
ENV REMOTION_SERVE_URL=/app/bundle

CMD ["node", "src/worker.js"]
