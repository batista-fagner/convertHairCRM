import { EditPlanDraft } from './edit-plan-draft.types';
import {
  EditPlan,
  EditPlanBodySegment,
  EditPlanHook,
  EditPlanHookLine,
  EditPlanTranscript,
  EditPlanTranscriptWord,
  EditPlanWord,
  EditPlanZoom,
} from './edit-plan.types';

// Expande o EditPlanDraft (índices de palavra) no EditPlan completo (segundos)
// por regra fixa — NUNCA por decisão do modelo. É isto que torna hallucinação
// de tempo estruturalmente impossível: a IA escolhe O QUÊ, este arquivo decide
// COMO desenhar.

const HEAD_PAD_SEC = 0.12;
const TAIL_PAD_SEC = 0.25;
const MAX_ZOOM_DUR_SEC = 2.5;
const ZOOM_SCALE: Record<'medium' | 'strong', number> = { medium: 1.22, strong: 1.3 };
const MAX_CAPTION_GROUP_WORDS = 3;
const MAX_CAPTION_GROUP_SEC = 1.6;

// Só corta pausa/respiro ACIMA desse tamanho — abaixo disso é ritmo natural
// de fala, cortar vira "gagueira" no vídeo em vez de corte limpo. E mantém
// uma pontinha de silêncio (PAUSE_PAD_SEC) nas duas bordas do corte pra não
// engolir o fim/começo do som da palavra, que o timestamp do Whisper às
// vezes corta rente demais.
//
// 0.3s (não 0.5s) depois de testar com vídeo real (IMG_4993, Fagner,
// 2026-09-19): a 0.5s, pausas de 0.3-0.46s no corpo (respiração normal entre
// frases de quem fala num ritmo mais pausado) nunca eram cortadas, e o
// usuário via isso como "não cortou nada". A 0.3s, o mesmo vídeo passou de 2
// pra 9 trechos, todos com duração saudável (o menor com 0.40s — nada de
// corte quase invisível) — testado e comparado contra 0.5/0.35/0.3/0.25/0.2/
// 0.15 antes de fixar este valor.
const PAUSE_GAP_THRESHOLD_SEC = 0.3;
const PAUSE_PAD_SEC = 0.06;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toWord = (w: EditPlanTranscriptWord): EditPlanWord => ({
  text: w.word,
  srcStartSec: w.start,
  srcEndSec: w.end,
});

// Tamanho da fonte por contagem de caractere — palavra/linha curta ganha mais
// destaque, longa encolhe pra não estourar a largura do quadro (1080px).
const displaySizeFor = (text: string): number => {
  if (text.length <= 6) return 260;
  if (text.length <= 9) return 220;
  if (text.length <= 13) return 180;
  return 150;
};

const condensedSizeFor = (text: string): number => {
  if (text.length <= 18) return 62;
  if (text.length <= 26) return 54;
  return 46;
};

// Padrão de encavalamento fixo (mesmo que validado visualmente na Etapa 1):
// linhas alternam nudge horizontal e sobem um pouco pra "grudar" na linha
// vizinha, em vez de ficarem empilhadas certinho.
const staggerFor = (lineIndex: number): { offsetXPx: number; offsetYPx: number } => ({
  offsetXPx: lineIndex % 2 === 0 ? -18 : 24,
  offsetYPx: lineIndex === 0 ? 0 : -14,
});

const splitIntoLineGroups = (globalIndices: number[], breakAfter: Set<number>): number[][] => {
  const lines: number[][] = [];
  let current: number[] = [];
  for (const idx of globalIndices) {
    current.push(idx);
    if (breakAfter.has(idx)) {
      lines.push(current);
      current = [];
    }
  }
  if (current.length) lines.push(current);
  return lines;
};

const buildHookCaption = (
  words: EditPlanTranscriptWord[],
  draft: EditPlanDraft,
  hookStartIdx: number,
  hookEndIdx: number,
): { lines: EditPlanHookLine[] } => {
  const displayIdx = clamp(draft.hookDisplayWordIdx, hookStartIdx, hookEndIdx);
  const breakSet = new Set(draft.hookLineBreaksAfterIdx.filter((i) => i >= hookStartIdx && i < hookEndIdx));

  const beforeGlobal: number[] = [];
  for (let i = hookStartIdx; i < displayIdx; i++) beforeGlobal.push(i);
  const afterGlobal: number[] = [];
  for (let i = displayIdx + 1; i <= hookEndIdx; i++) afterGlobal.push(i);

  const beforeLines = splitIntoLineGroups(beforeGlobal, breakSet);
  const afterLines = splitIntoLineGroups(afterGlobal, breakSet);

  const lines: EditPlanHookLine[] = [];
  let lineCursor = 0;

  for (const group of beforeLines) {
    const groupWords = group.map((i) => toWord(words[i]));
    const text = groupWords.map((w) => w.text).join(' ');
    lines.push({ style: 'condensed_sans', sizePx: condensedSizeFor(text), ...staggerFor(lineCursor), words: groupWords });
    lineCursor++;
  }

  const displayWord = toWord(words[displayIdx]);
  lines.push({
    style: 'display_serif',
    sizePx: displaySizeFor(displayWord.text),
    offsetXPx: 0,
    offsetYPx: -26,
    words: [displayWord],
  });
  lineCursor++;

  for (const group of afterLines) {
    const groupWords = group.map((i) => toWord(words[i]));
    const text = groupWords.map((w) => w.text).join(' ');
    lines.push({ style: 'condensed_sans', sizePx: condensedSizeFor(text), ...staggerFor(lineCursor), words: groupWords });
    lineCursor++;
  }

  return { lines };
};

// Agrupa TODA a transcrição (o corpo toca o vídeo inteiro desde o início,
// sempre) em blocos de até 3 palavras / 1.6s, quebrando também em pontuação —
// é o que dá ritmo à legenda discreta sem precisar de nenhuma decisão da IA.
const buildBodyCaptionGroups = (words: EditPlanTranscriptWord[]) => {
  const groups: EditPlanTranscriptWord[][] = [];
  let current: EditPlanTranscriptWord[] = [];

  for (const word of words) {
    if (current.length === 0) {
      current = [word];
      continue;
    }
    const span = word.end - current[0].start;
    const prevEndsWithPunct = /[.!?;:]$/.test(current[current.length - 1].word);
    if (current.length >= MAX_CAPTION_GROUP_WORDS || span > MAX_CAPTION_GROUP_SEC || prevEndsWithPunct) {
      groups.push(current);
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length) groups.push(current);

  return groups.map((g) => ({ words: g.map(toWord) }));
};

const buildZooms = (
  words: EditPlanTranscriptWord[],
  draft: EditPlanDraft,
): EditPlanZoom[] => {
  const raw = draft.impactRanges
    .filter((r) => r.startWordIdx >= 0 && r.endWordIdx < words.length && r.startWordIdx <= r.endWordIdx)
    .map((r) => {
      const startSec = words[r.startWordIdx].start;
      let endSec = words[r.endWordIdx].end;
      if (endSec - startSec > MAX_ZOOM_DUR_SEC) endSec = startSec + MAX_ZOOM_DUR_SEC;
      return { srcStartSec: startSec, srcEndSec: endSec, strength: r.strength };
    })
    .sort((a, b) => a.srcStartSec - b.srcStartSec);

  // Funde sobreposições — dois avanços de zoom colados viram um só, mais forte.
  const merged: typeof raw = [];
  for (const z of raw) {
    const last = merged[merged.length - 1];
    if (last && z.srcStartSec <= last.srcEndSec) {
      last.srcEndSec = Math.max(last.srcEndSec, z.srcEndSec);
      if (z.strength === 'strong') last.strength = 'strong';
    } else {
      merged.push({ ...z });
    }
  }

  return merged.map((z) => ({
    segment: 'body' as const,
    srcStartSec: z.srcStartSec,
    srcEndSec: z.srcEndSec,
    from: 1,
    to: ZOOM_SCALE[z.strength],
    focal: { x: 0.5, y: 0.42 },
  }));
};

// Corte de pausa/respiro: acha os intervalos SEM fala entre uma palavra e a
// próxima maiores que o limiar, e devolve os trechos que SOBRAM (mantidos),
// em ordem — o corpo toca só esses trechos, pulando as pausas removidas.
//
// Cada palavra sempre cai dentro de algum trecho mantido (por construção — o
// corte nunca é DENTRO de uma janela de palavra, só no espaço entre elas),
// então legenda, zoom e qualquer coisa derivada de índice de palavra
// continua caindo num ponto válido depois do corte.
export const buildBodySegments = (
  words: EditPlanTranscriptWord[],
  srcDurationSec: number,
): EditPlanBodySegment[] => {
  if (words.length === 0) return [{ srcStartSec: 0, srcEndSec: srcDurationSec }];

  const segments: EditPlanBodySegment[] = [];

  // Silêncio de ABERTURA (antes da primeira palavra) — mesmo corte que
  // qualquer pausa entre palavras. Faltava isto: um vídeo que começa com a
  // pessoa se ajeitando/respirando antes de falar tinha esse trecho, o mais
  // óbvio de todos, nunca cortado (achado testando com vídeo real).
  const leadGap = words[0].start;
  let segStart = leadGap > PAUSE_GAP_THRESHOLD_SEC
    ? clamp(words[0].start - PAUSE_PAD_SEC, 0, words[0].start)
    : 0;

  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap <= PAUSE_GAP_THRESHOLD_SEC) continue;

    const segEnd = clamp(words[i].end + PAUSE_PAD_SEC, segStart, words[i + 1].start);
    if (segEnd > segStart) segments.push({ srcStartSec: segStart, srcEndSec: segEnd });
    segStart = clamp(words[i + 1].start - PAUSE_PAD_SEC, segEnd, words[i + 1].start);
  }

  // Silêncio de FECHAMENTO (depois da última palavra) — mesmo corte, espelhado.
  // Achado testando com vídeo real: um vídeo onde a pessoa para de falar mas a
  // câmera continua gravando tinha 4.5s de silêncio puro no final, mantidos
  // inteiros — quase tanto quanto todas as pausas do meio somadas.
  const lastWord = words[words.length - 1];
  const trailGap = srcDurationSec - lastWord.end;
  const finalEnd = trailGap > PAUSE_GAP_THRESHOLD_SEC
    ? clamp(lastWord.end + PAUSE_PAD_SEC, segStart, srcDurationSec)
    : srcDurationSec;

  segments.push({ srcStartSec: segStart, srcEndSec: finalEnd });
  return segments;
};

// Extraído pra ser reusado no reajuste manual do gancho (Etapa 6, PATCH
// /:id/plan) sem precisar chamar a IA de novo — um retrim é puramente
// mecânico (novo intervalo de palavra → novos segundos + novo layout), então
// não tem por que gastar um round-trip de IA nisso.
export const buildHookSegment = (
  draft: Pick<EditPlanDraft, 'hookStartWordIdx' | 'hookEndWordIdx' | 'hookDisplayWordIdx' | 'hookLineBreaksAfterIdx' | 'hookReason'>,
  words: EditPlanTranscriptWord[],
  srcDurationSec: number,
): EditPlanHook => {
  const hookStartIdx = clamp(draft.hookStartWordIdx, 0, words.length - 1);
  const hookEndIdx = clamp(Math.max(draft.hookEndWordIdx, hookStartIdx), hookStartIdx, words.length - 1);

  const prevEnd = hookStartIdx > 0 ? words[hookStartIdx - 1].end : 0;
  const hookStartSec = clamp(words[hookStartIdx].start - HEAD_PAD_SEC, prevEnd, words[hookStartIdx].start);

  const nextStart = hookEndIdx < words.length - 1 ? words[hookEndIdx + 1].start : srcDurationSec;
  const hookEndSec = clamp(words[hookEndIdx].end + TAIL_PAD_SEC, words[hookEndIdx].end, nextStart);

  const { lines } = buildHookCaption(words, draft as EditPlanDraft, hookStartIdx, hookEndIdx);

  return {
    srcStartSec: hookStartSec,
    srcEndSec: hookEndSec,
    reason: draft.hookReason,
    caption: {
      anchorY: 0.62,
      colorHex: '#FFFFFF',
      shadow: { blurPx: 18, dyPx: 2, opacity: 0.45 },
      lines,
    },
  };
};

// Dado um novo intervalo de palavra escolhido manualmente (sem IA), escolhe
// a palavra de destaque automaticamente: a mais longa do trecho, ignorando
// palavras muito curtas (artigos/preposições) quando possível — heurística
// simples, sem chamada nenhuma ao modelo.
export const pickDisplayWordIdx = (words: EditPlanTranscriptWord[], startIdx: number, endIdx: number): number => {
  let best = startIdx;
  let bestLen = -1;
  for (let i = startIdx; i <= endIdx; i++) {
    const len = words[i].word.length;
    if (len > bestLen) { bestLen = len; best = i; }
  }
  return best;
};

export interface BuildEditPlanInput {
  draft: EditPlanDraft;
  transcript: EditPlanTranscript;
  normUrl: string;
  srcDurationSec: number;
  srcWidth: number;
  srcHeight: number;
  srcHasAudio: boolean;
}

export const buildEditPlan = ({
  draft,
  transcript,
  normUrl,
  srcDurationSec,
  srcWidth,
  srcHeight,
  srcHasAudio,
}: BuildEditPlanInput): EditPlan => {
  const words = transcript.words ?? [];
  const warnings = [...(draft.warnings ?? [])];

  // Vídeo sem áudio detectável (mudo, ou fala não reconhecida) — não dá pra
  // derivar gancho nenhum da transcrição. Em vez de falhar o job inteiro,
  // devolve um plano mínimo (gancho = primeiros segundos, sem legenda) pra
  // sempre haver algo previsualizável; o usuário ajusta manualmente na Etapa 6.
  if (words.length === 0) {
    const hookDur = clamp(Math.min(5, srcDurationSec / 3), Math.min(1.8, srcDurationSec), srcDurationSec);
    warnings.push('Vídeo sem áudio reconhecível — gancho e legendas não puderam ser gerados automaticamente, edite manualmente');
    return {
      version: 1,
      fps: 30,
      width: 1080,
      height: 1920,
      source: { normUrl, srcDurationSec, width: srcWidth, height: srcHeight, hasAudio: srcHasAudio },
      hook: {
        srcStartSec: 0,
        srcEndSec: hookDur,
        reason: 'Sem áudio reconhecível — janela padrão do início do vídeo',
        caption: { anchorY: 0.62, colorHex: '#FFFFFF', shadow: { blurPx: 18, dyPx: 2, opacity: 0.45 }, lines: [] },
      },
      transition: { kind: 'hard_cut', tDurationSec: 0.3, sfxAssetId: null, sfxLeadInSec: 0.18, sfxVolume: 0.8 },
      body: {
        srcStartSec: 0,
        srcEndSec: srcDurationSec,
        captions: { enabled: false, style: 'discreet_bottom', anchorY: 0.86, sizePx: 56, groups: [] },
      },
      zooms: [],
      titleOverlay: {
        text: draft.titleOverlayText ?? '',
        tStartSec: 0.25,
        tEndSec: 3.1,
        style: 'display_serif',
        sizePx: 78,
        anchorY: 0.16,
      },
      music: { assetId: null, volume: 0.14, fadeInSec: 0.5, fadeOutSec: 1.5, assetStartSec: 0 },
      audio: { sourceVolume: 1, captionOffsetSec: 0 },
      assets: {},
      warnings,
    };
  }

  const hook = buildHookSegment(draft, words, srcDurationSec);

  const bodyCaptionsEnabled = draft.bodyCaptionsEnabled !== false;

  return {
    version: 1,
    fps: 30,
    width: 1080,
    height: 1920,
    source: {
      normUrl,
      srcDurationSec,
      width: srcWidth,
      height: srcHeight,
      hasAudio: srcHasAudio,
    },
    hook,
    transition: {
      kind: 'hard_cut',
      tDurationSec: 0.3,
      sfxAssetId: null,
      sfxLeadInSec: 0.18,
      sfxVolume: 0.8,
    },
    body: {
      srcStartSec: 0,
      srcEndSec: srcDurationSec,
      segments: draft.removePauses ? buildBodySegments(words, srcDurationSec) : undefined,
      captions: {
        enabled: bodyCaptionsEnabled,
        style: 'discreet_bottom',
        anchorY: 0.86,
        sizePx: 56,
        groups: bodyCaptionsEnabled ? buildBodyCaptionGroups(words) : [],
      },
    },
    zooms: buildZooms(words, draft),
    titleOverlay: {
      text: draft.titleOverlayText ?? '',
      tStartSec: 0.25,
      tEndSec: 3.1,
      style: 'display_serif',
      sizePx: 78,
      anchorY: 0.16,
    },
    music: { assetId: null, volume: 0.14, fadeInSec: 0.5, fadeOutSec: 1.5, assetStartSec: 0 },
    audio: { sourceVolume: 1, captionOffsetSec: 0 },
    assets: {},
    warnings,
  };
};

// Usado quando a IA falha (parse inválido, índices sem sentido, 2 tentativas
// esgotadas) — escolhe uma janela de ~5s perto de 40% do vídeo (evita abrir
// bem no início/fim, onde a fala costuma ser intro/despedida) e passa pelo
// MESMO buildEditPlan() acima. Garante que o plano de emergência é
// estruturalmente idêntico a um plano normal — o usuário sempre recebe algo
// previsualizável, nunca uma tela de erro.
export const buildFallbackDraft = (
  transcript: EditPlanTranscript,
  srcDurationSec: number,
): EditPlanDraft => {
  const words = transcript.words ?? [];
  if (words.length === 0) {
    return {
      hookStartWordIdx: 0,
      hookEndWordIdx: 0,
      hookDisplayWordIdx: 0,
      hookLineBreaksAfterIdx: [],
      hookReason: 'Plano automático — a IA falhou e a transcrição veio vazia, revise o corte',
      titleOverlayText: '',
      impactRanges: [],
      bodyCaptionsEnabled: false,
      removePauses: false,
      musicMood: '',
      warnings: ['Plano automático — a IA falhou, revise o corte'],
    };
  }

  const targetSec = srcDurationSec * 0.4;
  let startIdx = 0;
  let bestDiff = Infinity;
  words.forEach((w, i) => {
    const diff = Math.abs(w.start - targetSec);
    if (diff < bestDiff) {
      bestDiff = diff;
      startIdx = i;
    }
  });

  let endIdx = startIdx;
  while (endIdx < words.length - 1 && words[endIdx].end - words[startIdx].start < 5) endIdx++;
  // Garante duração mínima de 1.8s mesmo em transcrição muito esparsa.
  while (endIdx < words.length - 1 && words[endIdx].end - words[startIdx].start < 1.8) endIdx++;

  const displayIdx = startIdx + Math.floor((endIdx - startIdx) / 2);

  return {
    hookStartWordIdx: startIdx,
    hookEndWordIdx: endIdx,
    hookDisplayWordIdx: displayIdx,
    hookLineBreaksAfterIdx: [],
    hookReason: 'Plano automático — a IA falhou, revise o corte',
    titleOverlayText: '',
    impactRanges: [],
    bodyCaptionsEnabled: true,
    removePauses: false,
    musicMood: '',
    warnings: ['Plano automático — a IA falhou, revise o corte'],
  };
};
