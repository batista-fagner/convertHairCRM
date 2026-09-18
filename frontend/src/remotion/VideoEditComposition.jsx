import { AbsoluteFill, Sequence, OffthreadVideo, Audio, useVideoConfig, interpolate } from 'remotion';
import { deriveTimeline, secToFrame } from './timeline.js';
import { useFontsReady } from './fonts.js';
import { HookCaption } from './HookCaption.jsx';
import { BodyCaptions } from './BodyCaptions.jsx';
import { ZoomWrapper } from './ZoomWrapper.jsx';
import { TitleOverlay } from './TitleOverlay.jsx';
import { TransitionFlash } from './TransitionFlash.jsx';

// Um trecho de vídeo: o mesmo arquivo normalizado, cortado em pontos
// diferentes. Preview e render carregam exatamente este arquivo — é o segundo
// pilar da fidelidade, junto do código compartilhado.
const Segment = ({ plan, timeline, segmentId, spec, children }) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <ZoomWrapper zooms={plan.zooms} plan={plan} timeline={timeline} segmentId={segmentId}>
        <OffthreadVideo
          src={plan.source?.normUrl}
          trimBefore={secToFrame(spec.srcStartSec ?? 0, fps)}
          trimAfter={secToFrame(spec.srcEndSec ?? 0, fps)}
          volume={plan.audio?.sourceVolume ?? 1}
          // O 9:16 sai daqui, não de um corte no ffmpeg — assim o
          // enquadramento aparece no preview também.
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </ZoomWrapper>
      {children}
    </AbsoluteFill>
  );
};

export const VideoEditComposition = (plan) => {
  const { fps } = useVideoConfig();
  const timeline = deriveTimeline(plan);
  const ready = useFontsReady();

  const assets = plan.assets ?? {};
  const music = plan.music?.assetId ? assets[plan.music.assetId] : null;
  const sfx = plan.transition?.sfxAssetId ? assets[plan.transition.sfxAssetId] : null;

  const hookFrames = Math.max(1, secToFrame(timeline.hookDurSec, fps));
  const bodyFrames = Math.max(1, secToFrame(timeline.bodyDurSec, fps));

  // O efeito entra ANTES da emenda: som chegando junto com a imagem soa
  // atrasado, porque o ouvido antecipa o corte.
  const sfxLeadIn = plan.transition?.sfxLeadInSec ?? 0.18;
  const sfxFrom = Math.max(0, secToFrame(timeline.seamSec - sfxLeadIn, fps));

  const musicFadeIn = plan.music?.fadeInSec ?? 0.5;
  const musicFadeOut = plan.music?.fadeOutSec ?? 1.5;
  const musicVolume = plan.music?.volume ?? 0.14;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      {/* Sem as fontes o primeiro quadro sairia na tipografia de reserva e o
          vídeo inteiro ficaria errado sem erro nenhum aparecer. */}
      {ready ? (
        <>
          <Sequence from={0} durationInFrames={hookFrames} name="Gancho">
            <Segment plan={plan} timeline={timeline} segmentId="hook" spec={plan.hook ?? {}}>
              <HookCaption
                caption={plan.hook?.caption}
                plan={plan}
                timeline={timeline}
                segmentId="hook"
              />
            </Segment>
          </Sequence>

          <Sequence from={hookFrames} durationInFrames={bodyFrames} name="Vídeo completo">
            <Segment plan={plan} timeline={timeline} segmentId="body" spec={plan.body ?? {}}>
              <BodyCaptions
                captions={plan.body?.captions}
                plan={plan}
                timeline={timeline}
                segmentId="body"
              />
            </Segment>
          </Sequence>

          <TransitionFlash transition={plan.transition} timeline={timeline} />
          <TitleOverlay title={plan.titleOverlay} />
        </>
      ) : null}

      {music?.url ? (
        <Audio
          src={music.url}
          startFrom={secToFrame(plan.music?.assetStartSec ?? 0, fps)}
          volume={(f) =>
            interpolate(
              f,
              [
                0,
                secToFrame(musicFadeIn, fps),
                Math.max(0, timeline.durationInFrames - secToFrame(musicFadeOut, fps)),
                timeline.durationInFrames,
              ],
              [0, musicVolume, musicVolume, 0],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
            )
          }
        />
      ) : null}

      {sfx?.url ? (
        <Sequence from={sfxFrom} name="Efeito de corte">
          <Audio src={sfx.url} volume={plan.transition?.sfxVolume ?? 0.8} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
