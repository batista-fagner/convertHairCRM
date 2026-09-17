import 'dotenv/config';
import http from 'http';
import { Worker } from 'bullmq';
import { pingDb } from './db.js';
import { runPrepare } from './prepare.js';

// Mesma conexão Redis do backend — banco 3, prefixo 'converthair-bullmq' (ver
// backend/src/queue/queue.module.ts). Divergir uma vírgula aqui faz o job
// ficar parado no Redis pra sempre, sem erro nenhum: por isso os nomes vêm
// literais aqui e não de um import — este pacote é deployado sozinho, sem
// acesso ao código do backend.
const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_BULLMQ_DB ?? 3),
};

// video-edit-prepare: baixa o vídeo bruto, normaliza, extrai áudio, sobe pro
// R2. Nesta etapa (2) o processor só loga o resultado — persistir no
// VideoEditJob e enfileirar 'video-edit-analyze' entram na Etapa 3, quando a
// tabela existir.
const worker = new Worker(
  'video-edit-prepare',
  async (job) => {
    console.log(`[prepare] iniciando job ${job.id}`, job.data);
    const result = await runPrepare(job.data);
    console.log(`[prepare] job ${job.id} concluído`, result);
    return result;
  },
  { connection, prefix: 'converthair-bullmq', concurrency: 1 },
);

worker.on('failed', (job, err) => {
  console.error(`[prepare] job ${job?.id} falhou: ${err.message}`);
});

let dbOk = false;
pingDb()
  .then((now) => {
    dbOk = true;
    console.log(`[db] pooler do Supabase respondeu — ${now}`);
  })
  .catch((err) => {
    console.error(`[db] falha ao conectar no pooler do Supabase: ${err.message}`);
  });

// Healthcheck do Railway. `busy` é aproximado (BullMQ não expõe contagem
// síncrona de jobs em execução no Worker) — o objetivo aqui é só "o processo
// está vivo e respondendo", não telemetria fina.
const port = Number(process.env.PORT ?? 8080);
http
  .createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, dbOk }));
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(port, () => {
    console.log(`[health] escutando na porta ${port}`);
  });

const shutdown = async () => {
  console.log('Encerrando worker...');
  await worker.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
