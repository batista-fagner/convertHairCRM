import { FPS, WIDTH, HEIGHT } from './constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// A LINHA DO TEMPO É DERIVADA, NUNCA ARMAZENADA.
//
// O EditPlan guarda só tempos do vídeo ORIGINAL (campos `src*`). Esta função é
// a única que sabe converter isso na linha do tempo de SAÍDA (campos `t*`).
// Preview e renderizador chamam exatamente esta função — é o que garante que o
// que ele aprova é o que ele baixa.
//
// Mover o corte do gancho reposiciona legendas e zooms sozinho, porque tudo
// passa por aqui.
// ─────────────────────────────────────────────────────────────────────────────

export const secToFrame = (sec, fps = FPS) => Math.round(sec * fps);

const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);

export const deriveTimeline = (plan) => {
  const fps = num(plan?.fps, FPS);

  const hookStart = num(plan?.hook?.srcStartSec, 0);
  const hookEnd = num(plan?.hook?.srcEndSec, 0);
  const hookDur = Math.max(0, hookEnd - hookStart);

  const bodyStart = num(plan?.body?.srcStartSec, 0);
  const bodyEnd = num(plan?.body?.srcEndSec, 0);
  const bodyDur = Math.max(0, bodyEnd - bodyStart);

  // Os dois trechos são adjacentes: o gancho abre, o corpo entra logo depois.
  // A transição é um lampejo SOBRE a emenda, não tempo somado — por isso ela
  // não entra nesta conta.
  const segments = {
    hook: { id: 'hook', tStartSec: 0, tEndSec: hookDur, srcOffsetSec: hookStart },
    body: { id: 'body', tStartSec: hookDur, tEndSec: hookDur + bodyDur, srcOffsetSec: bodyStart },
  };

  const totalSec = hookDur + bodyDur;

  return {
    fps,
    segments,
    hookDurSec: hookDur,
    bodyDurSec: bodyDur,
    seamSec: hookDur,
    totalSec,
    durationInFrames: Math.max(1, Math.ceil(totalSec * fps)),
  };
};

// Converte um instante do vídeo original pro tempo LOCAL dentro do trecho
// (hook ou corpo) — não pro tempo absoluto da composição.
//
// Isso importa porque cada trecho é renderizado dentro de um <Sequence from=X>,
// e dentro de um Sequence o useCurrentFrame() do Remotion já vem relativo ao
// início dele (frame - X), não absoluto. Somar tStartSec aqui de novo faria a
// legenda/zoom do corpo nunca coincidir com o frame local — foi exatamente o
// bug que apareceu no primeiro teste visual (Etapa 1).
//
// `captionOffsetSec` é o ajuste fino global de sincronia — existe porque o
// timestamp por palavra do Whisper oscila ±100-200ms em português, e esse
// deslize aparece justamente na palavra grande do gancho.
export const toTimelineSec = (srcSec, segmentId, plan, timeline) => {
  const seg = timeline?.segments?.[segmentId];
  if (!seg) return srcSec;
  const offset = num(plan?.audio?.captionOffsetSec, 0);
  return srcSec - seg.srcOffsetSec + offset;
};

// calculateMetadata da <Composition>: a duração sai do plano, então o
// renderizador não precisa repetir a conta — selectComposition() já devolve o
// número certo de quadros.
export const calcMeta = ({ props }) => {
  const tl = deriveTimeline(props);
  return {
    durationInFrames: tl.durationInFrames,
    fps: tl.fps,
    width: num(props?.width, WIDTH),
    height: num(props?.height, HEIGHT),
  };
};
