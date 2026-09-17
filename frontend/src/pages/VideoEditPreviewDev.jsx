import { Player } from '@remotion/player';
import { VideoEditComposition } from '../remotion/VideoEditComposition';
import { deriveTimeline } from '../remotion/timeline';
import { SAMPLE_PLAN } from '../remotion/sample-plan';
import { FPS, WIDTH, HEIGHT } from '../remotion/constants';

// Rota temporária da Etapa 1 do módulo de edição de vídeo — só pra bater o
// visual da legenda do gancho contra a referência antes de existir backend.
// Remover quando VideoEdit.jsx (Etapa 4) assumir o preview de verdade.
export default function VideoEditPreviewDev() {
  const timeline = deriveTimeline(SAMPLE_PLAN);

  return (
    <div style={{ padding: 24, display: 'flex', justifyContent: 'center', background: '#0b0b0f', minHeight: '100vh' }}>
      <div style={{ width: 338 }}>
        <Player
          component={VideoEditComposition}
          inputProps={SAMPLE_PLAN}
          durationInFrames={timeline.durationInFrames}
          compositionWidth={WIDTH}
          compositionHeight={HEIGHT}
          fps={FPS}
          style={{ width: '100%', aspectRatio: `${WIDTH} / ${HEIGHT}`, borderRadius: 12, overflow: 'hidden' }}
          controls
          loop
        />
      </div>
    </div>
  );
}
