import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

// Lampejo sobre a emenda entre o gancho e o vídeo completo. Acompanha o efeito
// sonoro de corte (que entra um pouco ANTES — ver sfxLeadInSec no plano; som
// chegando junto com a imagem parece atrasado).
//
// Não soma tempo à linha do tempo: é uma camada por cima do corte, não um
// trecho entre os dois.
export const TransitionFlash = ({ transition, timeline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowSec = frame / fps;

  if (!transition || transition.kind === 'hard_cut') return null;

  const seam = timeline?.seamSec ?? 0;
  const dur = Number.isFinite(transition.tDurationSec) ? transition.tDurationSec : 0.3;
  const half = Math.max(0.05, dur / 2);

  if (nowSec < seam - half || nowSec > seam + half) return null;

  const opacity = interpolate(
    nowSec,
    [seam - half, seam, seam + half],
    [0, 0.82, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill
      style={{ backgroundColor: '#FFFFFF', opacity, pointerEvents: 'none' }}
    />
  );
};
