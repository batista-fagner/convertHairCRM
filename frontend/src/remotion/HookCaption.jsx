import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { toTimelineSec } from './timeline';
import { DISPLAY_STACK, CONDENSED_STACK } from './fonts';

// Tempo que cada palavra leva pra assentar depois de ser falada. Curto de
// propósito: se passar disso, a palavra ainda está entrando quando a próxima
// começa e o bloco vira uma papa visual.
const REVEAL_SEC = 0.16;

const STYLE_PRESETS = {
  display_serif: {
    fontFamily: DISPLAY_STACK,
    fontWeight: 900,
    letterSpacing: '-0.02em',
    lineHeight: 0.86,
  },
  condensed_sans: {
    fontFamily: CONDENSED_STACK,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    lineHeight: 0.95,
  },
};

const Word = ({ word, isDisplay, nowSec, appearSec, gapPx }) => {
  // Sem tempo de palavra (plano de emergência, ou legenda escrita à mão no
  // desenvolvimento) o bloco aparece inteiro em vez de sumir.
  const hasTiming = Number.isFinite(appearSec);
  const p = hasTiming
    ? interpolate(nowSec, [appearSec, appearSec + REVEAL_SEC], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.out(Easing.cubic),
      })
    : 1;

  // A palavra-chave entra crescendo — é o momento que o formato inteiro existe
  // pra entregar. As outras só sobem e acendem, pra não competir com ela.
  const scale = isDisplay ? 0.82 + 0.18 * p : 1;
  const translateY = isDisplay ? (1 - p) * 8 : (1 - p) * 14;

  return (
    <span
      style={{
        display: 'inline-block',
        marginRight: gapPx,
        opacity: p,
        transform: `translateY(${translateY}px) scale(${scale})`,
        transformOrigin: 'center bottom',
        willChange: 'transform, opacity',
      }}
    >
      {word.text}
    </span>
  );
};

const Line = ({ line, plan, timeline, segmentId, nowSec }) => {
  const preset = STYLE_PRESETS[line.style] ?? STYLE_PRESETS.condensed_sans;
  const isDisplay = line.style === 'display_serif';
  const sizePx = Number.isFinite(line.sizePx) ? line.sizePx : (isDisplay ? 240 : 62);

  return (
    <div
      style={{
        ...preset,
        fontSize: sizePx,
        // O encavalamento das linhas é o que faz o bloco parecer composto em
        // vez de empilhado. Vem do plano, calculado por contagem de caracteres.
        marginTop: Number.isFinite(line.offsetYPx) ? line.offsetYPx : 0,
        marginLeft: Number.isFinite(line.offsetXPx) ? line.offsetXPx : 0,
        whiteSpace: 'nowrap',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-end',
      }}
    >
      {(line.words ?? []).map((word, i) => (
        <Word
          key={`${word.text}-${i}`}
          word={word}
          isDisplay={isDisplay}
          nowSec={nowSec}
          appearSec={
            Number.isFinite(word.srcStartSec)
              ? toTimelineSec(word.srcStartSec, segmentId, plan, timeline)
              : undefined
          }
          gapPx={isDisplay ? sizePx * 0.06 : sizePx * 0.22}
        />
      ))}
    </div>
  );
};

// Bloco editorial do gancho: duas tipografias na mesma frase, caixa baixa,
// branco sobre o vídeo, linhas encavaladas, posicionado no meio-baixo pra
// deixar o rosto livre.
export const HookCaption = ({ caption, plan, timeline, segmentId = 'hook' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowSec = frame / fps;

  if (!caption?.lines?.length) return null;

  const anchorY = Number.isFinite(caption.anchorY) ? caption.anchorY : 0.62;
  const shadow = caption.shadow ?? {};
  const blurPx = Number.isFinite(shadow.blurPx) ? shadow.blurPx : 18;
  const dyPx = Number.isFinite(shadow.dyPx) ? shadow.dyPx : 2;
  const shadowOpacity = Number.isFinite(shadow.opacity) ? shadow.opacity : 0.45;

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
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: caption.colorHex ?? '#FFFFFF',
          textTransform: 'lowercase',
          textShadow: `0 ${dyPx}px ${blurPx}px rgba(0,0,0,${shadowOpacity})`,
          padding: '0 48px',
        }}
      >
        {caption.lines.map((line, i) => (
          <Line
            key={i}
            line={line}
            plan={plan}
            timeline={timeline}
            segmentId={segmentId}
            nowSec={nowSec}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
