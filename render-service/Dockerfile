# Serviço de render separado do backend NestJS de propósito: o commit
# a254a2d (2026-06-27) removeu o puppeteer do backend porque o Chromium
# (~577MB) quebrava o build no Railway. O Remotion (Etapa 5) precisa do mesmo
# Chromium — por isso mora aqui, isolado, e não no backend.
#
# ATENÇÃO — build context é a RAIZ do repositório (Root Directory "/" no
# Railway, RAILWAY_DOCKERFILE_PATH=render-service/Dockerfile), não esta pasta.
# É assim de propósito: a Etapa 5 vai copiar frontend/src/remotion pra dentro
# desta imagem, pra preview (Vite) e render (aqui) compilarem exatamente o
# mesmo código React. Todo COPY abaixo é relativo à raiz do repo.
#
# Nesta etapa (2) só ffmpeg — sem Chromium, sem bundle do Remotion. Isso entra
# na Etapa 5, quando o render de verdade existir.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY render-service/package.json render-service/package-lock.json ./
RUN npm ci --omit=dev

COPY render-service/src ./src

ENV NODE_ENV=production

CMD ["node", "src/worker.js"]
