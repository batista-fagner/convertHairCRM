import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { toTimelineSec } from './timeline.js';
import { CONDENSED_STACK } from './fonts.js';

// Legenda do corpo do vídeo: discreta, no rodapé, 2-3 palavras por vez. O
// visual editorial grande fica reservado pro gancho — se rodar o vídeo inteiro
// ele compete com a fala e cansa.
//
// A palavra sendo falada acende; o resto do grupo fica um tom abaixo. É o que
// dá ritmo sem precisar animar nada.
export const BodyCaptions = ({ captions, plan, timeline, segmentId = 'body' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowSec = frame / fps;

  if (!captions?.enabled) return null;
  const groups = captions.groups ?? [];
  if (!groups.length) return null;

  const active = groups.find((g) => {
    const words = g.words ?? [];
    if (!words.length) return false;
    const start = toTimelineSec(words[0].srcStartSec, segmentId, plan, timeline);
    const end = toTimelineSec(words[words.length - 1].srcEndSec, segmentId, plan, timeline);
    // Folga no fim pra não piscar entre um grupo e o próximo.
    return nowSec >= start && nowSec <= end + 0.12;
  });

  if (!active) return null;

  const anchorY = Number.isFinite(captions.anchorY) ? captions.anchorY : 0.86;
  const sizePx = Number.isFinite(captions.sizePx) ? captions.sizePx : 56;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: `${anchorY * 100}%`,
          transform: 'translateY(-50%)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '0 72px',
          fontFamily: CONDENSED_STACK,
          fontWeight: 700,
          fontSize: sizePx,
          lineHeight: 1.1,
          color: '#FFFFFF',
          textAlign: 'center',
          textShadow: '0 2px 12px rgba(0,0,0,0.55)',
        }}
      >
        <span>
          {(active.words ?? []).map((word, i) => {
            const start = toTimelineSec(word.srcStartSec, segmentId, plan, timeline);
            const end = toTimelineSec(word.srcEndSec, segmentId, plan, timeline);
            const spoken = nowSec >= start && nowSec <= end;
            return (
              <span key={i} style={{ opacity: spoken ? 1 : 0.62, marginRight: sizePx * 0.22 }}>
                {word.text}
              </span>
            );
          })}
        </span>
      </div>
    </AbsoluteFill>
  );
};
