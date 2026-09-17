import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// { durationSec, width, height, hasAudio, rotationDeg }
export const probe = async (path) => {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    path,
  ]);
  const data = JSON.parse(stdout);
  const video = (data.streams ?? []).find((s) => s.codec_type === 'video');
  const audio = (data.streams ?? []).find((s) => s.codec_type === 'audio');
  if (!video) throw new Error('Nenhuma faixa de vídeo encontrada no arquivo enviado');

  // Rotação pode vir como tag clássica (rotate) ou como side_data (display
  // matrix) em exports mais novos de iPhone — checar os dois.
  const rotateTag = Number(video.tags?.rotate ?? 0);
  const displayMatrixRotation = (video.side_data_list ?? [])
    .find((sd) => sd.side_data_type === 'Display Matrix')?.rotation;
  const rotationDeg = Number.isFinite(displayMatrixRotation) ? Math.abs(displayMatrixRotation) : rotateTag;

  return {
    durationSec: Number(data.format?.duration ?? video.duration ?? 0),
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    hasAudio: Boolean(audio),
    rotationDeg,
  };
};

// H.264/yuv420p/30fps constante/+faststart. Resolve três coisas de uma vez:
// vídeo de celular é taxa de quadros variável e às vezes HEVC (que o Chrome
// nem decodifica), e o resultado é o MESMO arquivo que o preview e o
// renderizador vão carregar depois — segundo pilar da fidelidade preview×render,
// junto do código React compartilhado.
export const normalizeVideo = (srcPath, outPath) =>
  execFileAsync('ffmpeg', [
    '-y',
    '-i', srcPath,
    '-vf', "scale='min(1080,iw)':-2:flags=lanczos,fps=30",
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outPath,
  ]);

// Mono 16kHz — cabe folgado no limite de 25MB do Whisper mesmo pra um vídeo de
// alguns minutos, e é tudo que a transcrição precisa.
export const extractAudio = (srcPath, outPath) =>
  execFileAsync('ffmpeg', [
    '-y',
    '-i', srcPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-b:a', '64k',
    outPath,
  ]);

// Normalização de volume no arquivo final — usado só na Etapa 5 (render), já
// deixado pronto aqui porque é o mesmo wrapper de execFile.
export const loudnormCopy = (srcPath, outPath) =>
  execFileAsync('ffmpeg', [
    '-y',
    '-i', srcPath,
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
    '-c:v', 'copy',
    '-movflags', '+faststart',
    outPath,
  ]);
