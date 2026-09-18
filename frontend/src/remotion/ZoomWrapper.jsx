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
    const easeIn = Math.min(EASE_SEC, (end - start) / 2);
    scale = interpolate(
      nowSec,
      [start, start + easeIn, end - easeIn, end],
      [from, to, to, from],
      {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.inOut(Easing.cubic),
      },
    );

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
