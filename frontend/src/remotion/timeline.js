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

// Trechos do corpo que sobram depois de cortar pausa/respiro (ver
// buildBodySegments no backend). Sem isso (plano antigo, ou feature não
// pedida) o corpo é UM trecho contínuo só — mesma conta de sempre.
const resolveBodySegments = (plan) => {
  const raw = plan?.body?.segments;
  if (Array.isArray(raw) && raw.length > 0) return raw;
  return [{ srcStartSec: num(plan?.body?.srcStartSec, 0), srcEndSec: num(plan?.body?.srcEndSec, 0) }];
};

export const deriveTimeline = (plan) => {
  const fps = num(plan?.fps, FPS);

  const hookStart = num(plan?.hook?.srcStartSec, 0);
  const hookEnd = num(plan?.hook?.srcEndSec, 0);
  const hookDur = Math.max(0, hookEnd - hookStart);

  // Cada trecho mantido vira um pedacinho da linha do tempo LOCAL do corpo,
  // colado no anterior sem espaço — é aqui que a pausa "desaparece": ela
  // nunca ganha um lugar na linha do tempo de saída.
  let cursor = 0;
  const bodySegments = resolveBodySegments(plan).map((seg) => {
    const dur = Math.max(0, seg.srcEndSec - seg.srcStartSec);
    const withOffset = { srcStartSec: seg.srcStartSec, srcEndSec: seg.srcEndSec, localStartSec: cursor, dur };
    cursor += dur;
    return withOffset;
  });
  const bodyDur = cursor;

  // Os dois trechos são adjacentes: o gancho abre, o corpo entra logo depois.
  // A transição é um lampejo SOBRE a emenda, não tempo somado — por isso ela
  // não entra nesta conta.
  const segments = {
    hook: { id: 'hook', tStartSec: 0, tEndSec: hookDur, srcOffsetSec: hookStart },
    body: { id: 'body', tStartSec: hookDur, tEndSec: hookDur + bodyDur, srcOffsetSec: bodySegments[0]?.srcStartSec ?? 0 },
  };

  const totalSec = hookDur + bodyDur;

  return {
    fps,
    segments,
    bodySegments,
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
  const offset = num(plan?.audio?.captionOffsetSec, 0);

  // Corpo com corte de pausa: mais de um trecho mantido, então o mapeamento
  // não é um deslocamento fixo — precisa achar EM QUAL trecho esse instante
  // cai e somar o quanto já foi "engolido" pelas pausas removidas antes dele.
  // Palavra de legenda/zoom sempre cai DENTRO de algum trecho (nunca numa
  // pausa cortada — é assim que buildBodySegments constrói), então o `find`
  // abaixo sempre acha um lar; o clamp é só rede de segurança pra ponta solta
  // por arredondamento de ponto flutuante.
  if (segmentId === 'body' && timeline?.bodySegments?.length > 1) {
    const segs = timeline.bodySegments;
    const hit = segs.find((s) => srcSec >= s.srcStartSec - 0.01 && srcSec <= s.srcEndSec + 0.01);
    if (hit) return hit.localStartSec + clampToSeg(srcSec, hit) + offset;
    // Caiu antes do primeiro ou depois do último por folga de arredondamento.
    if (srcSec < segs[0].srcStartSec) return offset;
    const last = segs[segs.length - 1];
    return last.localStartSec + last.dur + offset;
  }

  const seg = timeline?.segments?.[segmentId];
  if (!seg) return srcSec;
  return srcSec - seg.srcOffsetSec + offset;
};

const clampToSeg = (srcSec, seg) => Math.max(0, Math.min(srcSec - seg.srcStartSec, seg.dur));

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
