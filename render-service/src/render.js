import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { selectComposition, renderMedia } from '@remotion/renderer';
import { loudnormCopy } from './ffmpeg.js';
import { uploadFile } from './r2.js';

const COMPOSITION_ID = 'VideoEdit';
const BUNDLE_DIR = process.env.REMOTION_SERVE_URL ?? '/app/bundle';

// Renderiza o EditPlan pro MP4 final. Não sabe nada de banco/fila — recebe o
// plano já resolvido (com assets{} preenchidos) e devolve onde o resultado
// ficou. `onProgress` é opcional e chamado com um número 0-100.
const toFilenameSafe = (name) =>
  (name || 'video')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acento
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'video';

export const renderPlan = async ({ jobId, name, plan, onProgress }) => {
  const composition = await selectComposition({
    serveUrl: BUNDLE_DIR,
    id: COMPOSITION_ID,
    inputProps: plan,
  });

  const dir = await mkdtemp(join(tmpdir(), `video-edit-render-${jobId}-`));
  const rawPath = join(dir, 'raw.mp4');
  const finalPath = join(dir, 'final.mp4');

  try {
    await renderMedia({
      composition,
      serveUrl: BUNDLE_DIR,
      codec: 'h264',
      outputLocation: rawPath,
      inputProps: plan,
      crf: 20,
      x264Preset: 'medium',
      // Fixado explicitamente — o padrão do Remotion é "metade das threads
      // detectadas", e dentro de container ele pode ler os núcleos do HOST,
      // abrir Chrome tabs demais e morrer por falta de memória. É a falha
      // mais provável do primeiro render (ver plano, risco #3).
      concurrency: Number(process.env.REMOTION_CONCURRENCY ?? 2),
      chromiumOptions: { enableMultiProcessOnLinux: true },
      offthreadVideoCacheSizeInBytes: 1_000_000_000,
      timeoutInMilliseconds: 120_000,
      onProgress: onProgress
        ? ({ progress }) => onProgress(Math.round(progress * 95))
        : undefined,
    });

    // Normaliza volume no arquivo final — mesmo wrapper de ffmpeg do preparo.
    await loudnormCopy(rawPath, finalPath);

    const buffer = await readFile(finalPath);
    const key = `video-edit/output/${jobId}.mp4`;
    const filename = `${toFilenameSafe(name)}.mp4`;
    const { url } = await uploadFile(key, buffer, 'video/mp4', `attachment; filename="${filename}"`);

    return { outputStoragePath: key, outputUrl: url };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
