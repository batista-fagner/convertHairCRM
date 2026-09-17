import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { probe, normalizeVideo, extractAudio } from './ffmpeg.js';
import { downloadToFile, uploadFile } from './r2.js';

// Orquestra o pipeline de preparo de um vídeo bruto: baixa, sonda, normaliza
// pra um formato único (H.264/30fps constante), extrai o áudio, sobe os dois
// resultados pro R2. Não faz corte nem crop — o 9:16 sai do objectFit da
// composição React, não daqui, pra aparecer igual no preview.
//
// Entrada: { jobId, sourceUrl }. Saída: dados que o chamador (worker.js, ou o
// script de teste manual desta etapa) decide o que fazer — este módulo não
// sabe nada de banco nem de fila, só de mídia.
export const runPrepare = async ({ jobId, sourceUrl }) => {
  if (!jobId) throw new Error('jobId é obrigatório');
  if (!sourceUrl) throw new Error('sourceUrl é obrigatório');

  const dir = await mkdtemp(join(tmpdir(), `video-edit-${jobId}-`));
  const srcPath = join(dir, 'src.mp4');
  const normPath = join(dir, 'norm.mp4');
  const audioPath = join(dir, 'audio.mp3');

  try {
    await downloadToFile(sourceUrl, srcPath);

    const info = await probe(srcPath);
    if (!info.durationSec || info.durationSec <= 0) {
      throw new Error('Não foi possível ler a duração do vídeo — arquivo corrompido ou formato não suportado');
    }

    await normalizeVideo(srcPath, normPath);
    if (info.hasAudio) {
      await extractAudio(srcPath, audioPath);
    }

    const normBuffer = await readFile(normPath);
    const audioBuffer = info.hasAudio ? await readFile(audioPath) : null;

    const [norm, audio] = await Promise.all([
      uploadFile(`video-edit/norm/${jobId}.mp4`, normBuffer, 'video/mp4'),
      audioBuffer ? uploadFile(`video-edit/audio-src/${jobId}.mp3`, audioBuffer, 'audio/mpeg') : Promise.resolve(null),
    ]);

    return {
      normUrl: norm.url,
      audioUrl: audio?.url ?? null,
      srcDurationSec: info.durationSec,
      srcWidth: info.width,
      srcHeight: info.height,
      srcHasAudio: info.hasAudio,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
