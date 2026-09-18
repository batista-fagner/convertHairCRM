import 'dotenv/config';
import http from 'http';
import { Worker, Queue } from 'bullmq';
import { pingDb, query } from './db.js';
import { runPrepare } from './prepare.js';
import { renderPlan } from './render.js';

// Mesma conexão Redis do backend — banco 3, prefixo 'converthair-bullmq' (ver
// backend/src/queue/queue.module.ts). Divergir uma vírgula aqui faz o job
// ficar parado no Redis pra sempre, sem erro nenhum: por isso os nomes vêm
// literais aqui e não de um import — este pacote é deployado sozinho, sem
// acesso ao código do backend. Precisam bater com
// backend/src/queue/queue.constants.ts.
const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_BULLMQ_DB ?? 3),
};
const PREFIX = 'converthair-bullmq';
const VIDEO_EDIT_ANALYZE_QUEUE = 'video-edit-analyze';
const VIDEO_EDIT_RENDER_QUEUE = 'video-edit-render';

const analyzeQueue = new Queue(VIDEO_EDIT_ANALYZE_QUEUE, { connection, prefix: PREFIX });

// video-edit-prepare: baixa o vídeo bruto, normaliza, extrai áudio, sobe pro
// R2, grava o resultado no video_edit_jobs (UPDATE cru — nunca TypeORM/
// synchronize aqui, o backend é o único dono do schema) e enfileira
// video-edit-analyze pro backend continuar (transcrição + plano).
const worker = new Worker(
  'video-edit-prepare',
  async (job) => {
    const { jobId, sourceUrl } = job.data;
    console.log(`[prepare] iniciando job ${jobId}`);

    await query(
      `update video_edit_jobs set status='preparing', stage='normalizando vídeo', updated_at=now() where id=$1`,
      [jobId],
    );

    try {
      const result = await runPrepare({ jobId, sourceUrl });

      await query(
        `update video_edit_jobs set
           norm_storage_path=$2, norm_url=$3,
           audio_storage_path=$4, audio_url=$5,
           src_duration_sec=$6, src_width=$7, src_height=$8,
           status='audio_ready', stage=null, updated_at=now()
         where id=$1`,
        [
          jobId,
          result.normStoragePath,
          result.normUrl,
          result.audioStoragePath,
          result.audioUrl,
          result.srcDurationSec,
          result.srcWidth,
          result.srcHeight,
        ],
      );

      await analyzeQueue.add(
        'analyze',
        { jobId },
        { jobId: `video-edit-analyze_${jobId}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
      );

      console.log(`[prepare] job ${jobId} concluído, video-edit-analyze enfileirado`);
      return result;
    } catch (err) {
      await query(
        `update video_edit_jobs set status='failed', error_message=$2, updated_at=now() where id=$1`,
        [jobId, err.message ?? String(err)],
      ).catch((dbErr) => console.error(`[prepare] job ${jobId} falhou E não conseguiu gravar o erro: ${dbErr.message}`));
      throw err;
    }
  },
  { connection, prefix: PREFIX, concurrency: 1 },
);

worker.on('failed', (job, err) => {
  console.error(`[prepare] job ${job?.id} falhou: ${err.message}`);
});

// video-edit-render: pega o plano já pronto (Etapa 3/4), compõe a cena com
// Remotion, normaliza o volume e sobe o MP4 final pro R2. Concurrency 1 no
// BullMQ (um render de cada vez por instância) — a concorrência DENTRO de
// cada render (quantas abas de Chrome) é outra coisa, controlada por
// REMOTION_CONCURRENCY dentro de render.js.
const renderWorker = new Worker(
  VIDEO_EDIT_RENDER_QUEUE,
  async (job) => {
    const { jobId } = job.data;
    console.log(`[render] iniciando job ${jobId}`);

    const { rows } = await query('select plan, name from video_edit_jobs where id=$1', [jobId]);
    const plan = rows[0]?.plan;
    const name = rows[0]?.name;
    if (!plan) throw new Error('Job sem plano salvo — não é possível renderizar');

    await query(
      `update video_edit_jobs set status='rendering', stage='compondo cena', progress=0, render_started_at=now(), updated_at=now() where id=$1`,
      [jobId],
    );

    // Throttle — sem isso o onProgress do Remotion (chamado a cada poucos
    // quadros) hammer o Postgres com um UPDATE por tick.
    let lastWrite = 0;
    const onProgress = (progress) => {
      const now = Date.now();
      if (now - lastWrite < 3000) return;
      lastWrite = now;
      query(`update video_edit_jobs set progress=$2, updated_at=now() where id=$1`, [jobId, progress]).catch(() => {});
    };

    try {
      const result = await renderPlan({ jobId, name, plan, onProgress });

      await query(
        `update video_edit_jobs set
           output_storage_path=$2, output_url=$3,
           status='done', stage=null, progress=100, render_finished_at=now(), updated_at=now()
         where id=$1`,
        [jobId, result.outputStoragePath, result.outputUrl],
      );

      console.log(`[render] job ${jobId} concluído — ${result.outputUrl}`);
      return result;
    } catch (err) {
      await query(
        `update video_edit_jobs set status='failed', error_message=$2, updated_at=now() where id=$1`,
        [jobId, err.message ?? String(err)],
      ).catch((dbErr) => console.error(`[render] job ${jobId} falhou E não conseguiu gravar o erro: ${dbErr.message}`));
      throw err;
    }
  },
  // attempts:1 é setado do lado de quem produz (backend) — um render de
  // vários minutos não deve reentrar sozinho. Concurrency 1: um render por
  // vez nesta instância, é isso que o risco #3 do plano pede.
  { connection, prefix: PREFIX, concurrency: 1 },
);

renderWorker.on('failed', (job, err) => {
  console.error(`[render] job ${job?.id} falhou: ${err.message}`);
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
  await renderWorker.close();
  await analyzeQueue.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
