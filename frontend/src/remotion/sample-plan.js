// EditPlan escrito à mão pra validar o visual da composição contra a
// referência (print do @tallisgomes) antes de qualquer IA/backend existir.
// Reflete a frase de exemplo do plano: "o que você faria diferente se
// estivesse começando hoje?" — palavra-chave "diferente" no serif grande.
//
// Vídeo sintético gerado localmente (ffmpeg testsrc2 + timer) em
// public/dev/sample.mp4 — já 9:16, sem depender de URL externa instável.
// Arquivo ignorado no git (ver .gitignore); gerar de novo com:
//   ffmpeg -f lavfi -i "testsrc2=size=1080x1920:rate=30:duration=20" \
//     -f lavfi -i "sine=frequency=440:duration=20" \
//     -vf "drawtext=text='%{pts\:hms}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=h-150" \
//     -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart public/dev/sample.mp4
const SAMPLE_VIDEO_URL = '/dev/sample.mp4';

export const SAMPLE_PLAN = {
  version: 1,
  fps: 30,
  width: 1080,
  height: 1920,

  source: {
    normUrl: SAMPLE_VIDEO_URL,
    srcDurationSec: 20,
    width: 1080,
    height: 1920,
    hasAudio: true,
  },

  hook: {
    srcStartSec: 10,
    srcEndSec: 15,
    reason: 'Exemplo de desenvolvimento — não veio de IA nenhuma.',
    caption: {
      anchorY: 0.62,
      colorHex: '#FFFFFF',
      shadow: { blurPx: 18, dyPx: 2, opacity: 0.45 },
      lines: [
        {
          style: 'condensed_sans',
          sizePx: 62,
          offsetXPx: -18,
          offsetYPx: 0,
          words: [
            { text: 'o', srcStartSec: 10.0, srcEndSec: 10.12 },
            { text: 'que', srcStartSec: 10.12, srcEndSec: 10.31 },
            { text: 'você', srcStartSec: 10.31, srcEndSec: 10.6 },
            { text: 'faria', srcStartSec: 10.6, srcEndSec: 10.95 },
          ],
        },
        {
          style: 'display_serif',
          sizePx: 240,
          offsetXPx: 0,
          offsetYPx: -26,
          words: [{ text: 'diferente', srcStartSec: 10.95, srcEndSec: 11.82 }],
        },
        {
          style: 'condensed_sans',
          sizePx: 62,
          offsetXPx: 24,
          offsetYPx: -14,
          words: [
            { text: 'se', srcStartSec: 11.82, srcEndSec: 11.95 },
            { text: 'estivesse', srcStartSec: 11.95, srcEndSec: 12.4 },
          ],
        },
        {
          style: 'condensed_sans',
          sizePx: 62,
          offsetXPx: 0,
          offsetYPx: -14,
          words: [
            { text: 'começando', srcStartSec: 12.4, srcEndSec: 12.95 },
            { text: 'hoje?', srcStartSec: 12.95, srcEndSec: 13.3 },
          ],
        },
      ],
    },
  },

  transition: {
    kind: 'whoosh_flash',
    tDurationSec: 0.3,
    sfxAssetId: null,
    sfxLeadInSec: 0.18,
    sfxVolume: 0.8,
  },

  body: {
    srcStartSec: 0,
    srcEndSec: 20,
    captions: {
      enabled: true,
      style: 'discreet_bottom',
      anchorY: 0.86,
      sizePx: 56,
      groups: [
        {
          words: [
            { text: 'então', srcStartSec: 0.4, srcEndSec: 0.71 },
            { text: 'vamos', srcStartSec: 0.71, srcEndSec: 0.95 },
            { text: 'começar', srcStartSec: 0.95, srcEndSec: 1.3 },
          ],
        },
        {
          words: [
            { text: 'do', srcStartSec: 1.3, srcEndSec: 1.42 },
            { text: 'jeito', srcStartSec: 1.42, srcEndSec: 1.65 },
            { text: 'certo', srcStartSec: 1.65, srcEndSec: 1.95 },
          ],
        },
      ],
    },
  },

  zooms: [
    { segment: 'body', srcStartSec: 2, srcEndSec: 4.5, from: 1.0, to: 1.16, focal: { x: 0.5, y: 0.42 } },
  ],

  titleOverlay: {
    text: 'exemplo de desenvolvimento',
    tStartSec: 0.25,
    tEndSec: 3.1,
    style: 'display_serif',
    sizePx: 78,
    anchorY: 0.16,
  },

  music: { assetId: null, volume: 0.14, fadeInSec: 0.5, fadeOutSec: 1.5, assetStartSec: 0 },
  audio: { sourceVolume: 1.0, captionOffsetSec: 0.0 },

  assets: {},
  warnings: [],
};
