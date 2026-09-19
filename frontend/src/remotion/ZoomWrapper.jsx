import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { toTimelineSec } from './timeline.js';

// Quanto tempo o enquadramento leva pra entrar e pra sair. O avanço precisa ser
// lento o bastante pra não parecer solavanco e rápido o bastante pra coincidir
// com a frase de impacto que o motivou.
const EASE_SEC = 0.45;

// Avanço de enquadramento nas frases de impacto que a IA marcou. Quebra a
// monotonia de quem fala parado pra câmera, que é o padrão do material bruto.
//
// A escala vem travada do backend em [1.00, 1.22] pra "medium" — zoom demais
// em vídeo de celular vira borrão, porque não há resolução sobrando.
export const ZoomWrapper = ({ zooms, plan, timeline, segmentId, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowSec = frame / fps;

  const relevant = (zooms ?? []).filter((z) => z.segment === segmentId);

  let scale = 1;
  let originX = 0.5;
  let originY = 0.5;

  for (const z of relevant) {
    const start = toTimelineSec(z.srcStartSec, segmentId, plan, timeline);
    const end = toTimelineSec(z.srcEndSec, segmentId, plan, timeline);
    if (nowSec < start || nowSec > end) continue;

    const from = Number.isFinite(z.from) ? z.from : 1;
    const to = Number.isFinite(z.to) ? z.to : 1.14;

    // Entra, segura, volta. Uma rampa linear que corta seco no fim chama
    // atenção pro efeito em vez da fala.
    //
    // Zoom curto (< 2×EASE_SEC) não cabe o platô do meio — os dois pontos de
    // "sobe até aqui" e "desce a partir daqui" colidiriam no mesmo instante,
    // e o interpolate() do Remotion EXIGE valores estritamente crescentes
    // (rejeita duplicata e derruba o render inteiro). Isso ficou mais comum
    // com o corte de pausa: um zoom que atravessa um trecho cortado encolhe
    // no mapeamento pro tempo local. Zoom curto vira triângulo (sobe até o
    // meio, desce) em vez de trapézio (sobe, segura, desce).
    const dur = end - start;
    const easeIn = Math.min(EASE_SEC, dur / 2);
    const risePoint = start + easeIn;
    const fallPoint = end - easeIn;

    const inputRange = fallPoint > risePoint
      ? [start, risePoint, fallPoint, end]
      : [start, (start + end) / 2, end];
    const outputRange = fallPoint > risePoint ? [from, to, to, from] : [from, to, from];

    scale = interpolate(nowSec, inputRange, outputRange, {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.cubic),
    });

    if (z.focal) {
      originX = Number.isFinite(z.focal.x) ? z.focal.x : 0.5;
      originY = Number.isFinite(z.focal.y) ? z.focal.y : 0.5;
    }
    break;
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        transform: `scale(${scale})`,
        transformOrigin: `${originX * 100}% ${originY * 100}%`,
        willChange: 'transform',
      }}
    >
      {children}
    </div>
  );
};
