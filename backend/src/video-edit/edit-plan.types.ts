// Espelha EXATAMENTE o formato que frontend/src/remotion/sample-plan.js já usa
// e que os componentes (HookCaption, BodyCaptions, ZoomWrapper, TitleOverlay,
// VideoEditComposition) já consomem — construído e testado visualmente na
// Etapa 1. Qualquer campo novo aqui precisa nascer também lá, e vice-versa;
// não existe terceiro lugar que descreva esse contrato.
//
// Ver frontend/src/remotion/timeline.js pro porquê da separação srcSec (tempo
// no vídeo ORIGINAL) vs tSec (tempo na linha do tempo de SAÍDA) — a IA só
// emite índices de palavra, nunca timestamp; este arquivo já é a forma
// EXPANDIDA (determinística, ver edit-plan-builder.ts), não a saída crua do
// modelo (ver edit-plan-draft.types.ts).

export interface EditPlanWord {
  text: string;
  srcStartSec: number;
  srcEndSec: number;
}

export interface EditPlanHookLine {
  style: 'display_serif' | 'condensed_sans';
  sizePx: number;
  offsetXPx: number;
  offsetYPx: number;
  words: EditPlanWord[];
}

export interface EditPlanHookCaption {
  anchorY: number;
  colorHex: string;
  shadow: { blurPx: number; dyPx: number; opacity: number };
  lines: EditPlanHookLine[];
}

export interface EditPlanHook {
  srcStartSec: number;
  srcEndSec: number;
  reason: string;
  caption: EditPlanHookCaption;
}

export interface EditPlanTransition {
  kind: 'hard_cut' | 'whoosh_flash';
  tDurationSec: number;
  sfxAssetId: string | null;
  sfxLeadInSec: number;
  sfxVolume: number;
}

export interface EditPlanCaptionGroup {
  words: EditPlanWord[];
}

export interface EditPlanBodyCaptions {
  enabled: boolean;
  style: 'discreet_bottom';
  anchorY: number;
  sizePx: number;
  groups: EditPlanCaptionGroup[];
}

export interface EditPlanBodySegment {
  srcStartSec: number;
  srcEndSec: number;
}

export interface EditPlanBody {
  srcStartSec: number;
  srcEndSec: number;
  // Corte de pausa/respiro (opcional) — quando presente e não-vazio, o corpo
  // toca esses trechos em sequência, PULANDO os intervalos entre eles (as
  // pausas removidas). srcStartSec/srcEndSec acima continuam representando o
  // vídeo inteiro (fim = duração da fonte); ausente/vazio = comportamento
  // antigo, um trecho contínuo só, sem corte nenhum — retrocompatível com
  // qualquer plano salvo antes desta feature existir.
  segments?: EditPlanBodySegment[];
  captions: EditPlanBodyCaptions;
}

export interface EditPlanZoom {
  segment: 'hook' | 'body';
  srcStartSec: number;
  srcEndSec: number;
  from: number;
  to: number;
  focal: { x: number; y: number };
}

export interface EditPlanTitleOverlay {
  text: string;
  tStartSec: number;
  tEndSec: number;
  style: 'display_serif' | 'condensed_sans';
  sizePx: number;
  anchorY: number;
}

export interface EditPlanMusic {
  assetId: string | null;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
  assetStartSec: number;
}

export interface EditPlanAudio {
  sourceVolume: number;
  // Ajuste fino global de sincronia — existe porque o timestamp por palavra do
  // Whisper oscila ±100-200ms em português. Editável na tela (Etapa 6).
  captionOffsetSec: number;
}

export interface EditPlanAsset {
  url: string;
  name: string;
  durationSec?: number | null;
}

export interface EditPlanSource {
  normUrl: string;
  srcDurationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface EditPlan {
  version: 1;
  fps: number;
  width: number;
  height: number;
  source: EditPlanSource;
  hook: EditPlanHook;
  transition: EditPlanTransition;
  body: EditPlanBody;
  zooms: EditPlanZoom[];
  titleOverlay: EditPlanTitleOverlay;
  music: EditPlanMusic;
  audio: EditPlanAudio;
  assets: Record<string, EditPlanAsset>;
  warnings: string[];
}

// Saída crua do Whisper (response_format verbose_json + timestamp_granularities
// word) — guardada no job pra permitir re-planejar sem transcrever de novo.
export interface EditPlanTranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface EditPlanTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface EditPlanTranscript {
  text: string;
  words: EditPlanTranscriptWord[];
  segments: EditPlanTranscriptSegment[];
  language: string;
  duration: number;
}
