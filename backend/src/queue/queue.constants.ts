// Nomes de fila e de job em um lugar só — produtor e processor precisam concordar
// exatamente na string, e errar isso não quebra o build, só faz o job nunca rodar.

// Liga o caminho novo (filas) no lugar dos @Cron que varrem o banco. Qualquer valor
// diferente de 'bullmq' mantém o comportamento legado — é a chave de rollback.
export const QUEUE_ENGINE_BULLMQ = 'bullmq';

// --- ig-posts (Fase 2) ---
export const IG_POST_QUEUE_NAME = 'ig-post-publish';
export const JOB_PUBLISH_POST = 'publish';
export const JOB_POLL_CONTAINER = 'poll-container';

// --- sdr-followup (Fase 3) ---
// Só troca o GATILHO do scan (cron -> job repetível) — a query e o lock
// continuam os mesmos, ver runFollowupScan() em sdr-followup.service.ts.
export const SDR_FOLLOWUP_QUEUE_NAME = 'sdr-followup-scan';
export const JOB_SCAN_FOLLOWUPS = 'scan';
export const SDR_FOLLOWUP_SCHEDULER_ID = 'sdr-followup-scan-scheduler';

// --- video-edit (editor de vídeo com IA) ---
// Consumidas por um serviço Railway SEPARADO (render-service/, fora deste
// projeto Nest — ver Dockerfile lá) que não importa este arquivo. As strings
// abaixo são copiadas literalmente em render-service/src/worker.js: mudar um
// nome aqui sem mudar lá faz o job ficar parado no Redis pra sempre, sem erro.
//
// video-edit-prepare: backend produz -> render-service consome (ffprobe,
// normaliza, extrai áudio, sobe pro R2).
// video-edit-analyze: render-service produz -> backend consome (Whisper, GPT,
// monta o EditPlan) — entra na Etapa 3.
// video-edit-render: backend produz (na aprovação do usuário) -> render-service
// consome (Remotion + loudnorm + upload) — entra na Etapa 5.
export const VIDEO_EDIT_PREPARE_QUEUE = 'video-edit-prepare';
export const VIDEO_EDIT_ANALYZE_QUEUE = 'video-edit-analyze';
export const VIDEO_EDIT_RENDER_QUEUE = 'video-edit-render';
export const JOB_PREPARE = 'prepare';
export const JOB_ANALYZE = 'analyze';
export const JOB_RENDER = 'render';

// --- greenn pix-pendente (espera antes de mandar a recuperação) ---
// Dá 8min pro lead pagar o Pix já gerado antes de mandar a mensagem de
// recuperação — se o webhook de "paid" chegar antes disso (tag greenn_comprou
// no Lead), o job cancela o envio em vez de incomodar quem já pagou.
export const GREENN_PIX_PENDING_QUEUE = 'greenn-pix-pending';
export const JOB_CHECK_PIX_PENDING = 'check-pix-pending';
export const GREENN_PIX_PENDING_DELAY_MS = 8 * 60 * 1000;
