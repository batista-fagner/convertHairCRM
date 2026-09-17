import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { DISPLAY_STACK, CONDENSED_STACK } from './fonts';

const IN_SEC = 0.35;
const OUT_SEC = 0.3;

// Gancho escrito sobre os primeiros segundos — é onde o anúncio ganha ou perde
// a pessoa. Diferente de tudo mais nesta pasta, os tempos aqui são da linha do
// tempo de SAÍDA (`tStartSec`/`tEndSec`), não do vídeo original: é um evento de
// composição, não algo derivado da transcrição.
export const TitleOverlay = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowSec = frame / fps;

  const text = (title?.text ?? '').trim();
  if (!text) return null;

  const start = Number.isFinite(title.tStartSec) ? title.tStartSec : 0;
  const end = Number.isFinite(title.tEndSec) ? title.tEndSec : start + 3;
  if (nowSec < start || nowSec > end) return null;

  const opacity = interpolate(
    nowSec,
    [start, start + IN_SEC, end - OUT_SEC, end],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) },
  );
  const translateY = interpolate(nowSec, [start, start + IN_SEC], [22, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const isSerif = title.style !== 'condensed_sans';

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: `${(Number.isFinite(title.anchorY) ? title.anchorY : 0.16) * 100}%`,
          transform: `translateY(calc(-50% + ${translateY}px))`,
          padding: '0 64px',
          textAlign: 'center',
          opacity,
          color: '#FFFFFF',
          textTransform: 'lowercase',
          fontFamily: isSerif ? DISPLAY_STACK : CONDENSED_STACK,
          fontWeight: isSerif ? 900 : 700,
          fontSize: Number.isFinite(title.sizePx) ? title.sizePx : 78,
          lineHeight: 0.98,
          letterSpacing: '-0.02em',
          textShadow: '0 2px 18px rgba(0,0,0,0.5)',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
