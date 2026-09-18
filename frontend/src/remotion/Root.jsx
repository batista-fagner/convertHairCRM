import { Composition } from 'remotion';
import { COMPOSITION_ID, FPS, WIDTH, HEIGHT } from './constants.js';
import { VideoEditComposition } from './VideoEditComposition.jsx';
import { calcMeta } from './timeline.js';
import { SAMPLE_PLAN } from './sample-plan.js';

// Registrado só pelo bundler do Remotion (index.js chama registerRoot com
// isto). O Vite/CRM nunca importa este arquivo — ele usa <Player> direto com
// VideoEditComposition + o plano vindo da API.
export const RemotionRoot = () => (
  <Composition
    id={COMPOSITION_ID}
    component={VideoEditComposition}
    calculateMetadata={calcMeta}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    durationInFrames={FPS * 5}
    defaultProps={SAMPLE_PLAN}
  />
);
