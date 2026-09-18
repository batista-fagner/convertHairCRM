import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { EditPlan, EditPlanTranscript } from './edit-plan.types';
import { EditPlanDraft } from './edit-plan-draft.types';
import { buildEditPlan, buildFallbackDraft } from './edit-plan-builder';
import { validateEditPlan } from './edit-plan.validate';

const DRAFT_SCHEMA = {
  name: 'edit_plan_draft',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      hookStartWordIdx: { type: 'integer' },
      hookEndWordIdx: { type: 'integer' },
      hookDisplayWordIdx: { type: 'integer' },
      hookLineBreaksAfterIdx: { type: 'array', items: { type: 'integer' } },
      hookReason: { type: 'string' },
      titleOverlayText: { type: 'string' },
      impactRanges: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            startWordIdx: { type: 'integer' },
            endWordIdx: { type: 'integer' },
            strength: { type: 'string', enum: ['medium', 'strong'] },
          },
          required: ['startWordIdx', 'endWordIdx', 'strength'],
        },
      },
      bodyCaptionsEnabled: { type: 'boolean' },
      musicMood: { type: 'string' },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'hookStartWordIdx',
      'hookEndWordIdx',
      'hookDisplayWordIdx',
      'hookLineBreaksAfterIdx',
      'hookReason',
      'titleOverlayText',
      'impactRanges',
      'bodyCaptionsEnabled',
      'musicMood',
      'warnings',
    ],
  },
} as const;

const SYSTEM_PROMPT = `Você monta o roteiro de edição de um vídeo curto de venda (Reels/anúncio Meta).

Formato fixo do vídeo (você não escolhe isso, já está decidido):
1. GANCHO: um trecho de 2-8 segundos, tirado do MEIO do vídeo, com a frase mais forte/impactante — é o que decide se a pessoa continua assistindo.
2. TRANSIÇÃO com efeito de corte.
3. VÍDEO COMPLETO do início ao fim (o gancho vai reaparecer no meio dele, e tudo bem).

Sua tarefa: ler a transcrição (palavras numeradas) e a instrução do usuário, e devolver:
- hookStartWordIdx/hookEndWordIdx: o intervalo de palavras da frase de gancho. Prefira uma frase que funcione sozinha, fora de contexto — uma pergunta, uma afirmação forte, uma revelação. NUNCA o primeiro ou o último segundo do vídeo.
- hookDisplayWordIdx: dentro desse intervalo, a UMA palavra mais forte (substantivo ou verbo, nunca artigo/preposição) — ela vai aparecer gigante na tela.
- hookLineBreaksAfterIdx: índices globais de palavra onde quebrar linha na legenda do gancho (a palavra de destaque já fica sozinha, não inclua quebra em volta dela).
- hookReason: uma frase curta explicando por que esse trecho foi escolhido.
- titleOverlayText: um gancho textual curto (até 6 palavras) pros primeiros segundos do vídeo, minúsculo, sem pontuação forte.
- impactRanges: 0 a 4 trechos (início/fim em índice de palavra) de frases de impacto no vídeo INTEIRO, pra dar um leve avanço de zoom. strength "strong" só para o ápice absoluto, "medium" pro resto.
- bodyCaptionsEnabled: normalmente true.
- musicMood: uma ou duas palavras descrevendo o clima ideal de trilha (ex: "tenso minimal", "motivacional leve").
- warnings: avisos curtos se a transcrição parecer cortada, incompleta ou com trecho inaudível — [] se não houver nada a avisar.

Responda em português. Índices sempre se referem à lista numerada de palavras fornecida — nunca invente um índice fora do intervalo [0, N-1].`;

@Injectable()
export class VideoEditPlanService {
  private readonly logger = new Logger(VideoEditPlanService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    // Tarefa de raciocínio estrutural (não copy criativa) — vale um modelo mais
    // forte que o gpt-5.4-mini usado no carrossel. Não cai no OPENAI_MODEL do
    // .env de propósito (mesmo motivo do carousel.service.ts: essa variável
    // ainda aponta pro gpt-4o-mini antigo) — só VIDEO_EDIT_MODEL sobrescreve.
    this.model = config.get('VIDEO_EDIT_MODEL') ?? 'gpt-5.4';
  }

  async generatePlan(
    transcript: EditPlanTranscript,
    instruction: string,
    normUrl: string,
    srcDurationSec: number,
    srcWidth: number,
    srcHeight: number,
    srcHasAudio: boolean,
  ): Promise<{ plan: EditPlan; planModel: string }> {
    const words = transcript.words ?? [];
    const wordList = words.map((w, i) => `${i}:${w.word}`).join(' ');

    let draft: EditPlanDraft | null = null;
    let planModel = this.model;
    let lastErrors: string[] = [];

    for (let attempt = 0; attempt < 2 && !draft; attempt++) {
      try {
        const candidate = await this.callModel(wordList, instruction, srcDurationSec, lastErrors);
        const plan = buildEditPlan({ draft: candidate, transcript, normUrl, srcDurationSec, srcWidth, srcHeight, srcHasAudio });
        const validation = validateEditPlan(plan);
        if (validation.ok) {
          draft = candidate;
        } else {
          lastErrors = validation.errors;
          this.logger.warn(`Plano da IA inválido (tentativa ${attempt + 1}): ${validation.errors.join('; ')}`);
        }
      } catch (err: any) {
        lastErrors = [err.message];
        this.logger.error(`Erro ao gerar plano (tentativa ${attempt + 1}): ${err.message}`);
      }
    }

    if (!draft) {
      this.logger.warn('Caindo pro plano determinístico padrão — IA não produziu um plano válido em 2 tentativas');
      draft = buildFallbackDraft(transcript, srcDurationSec);
      planModel = 'fallback-determinístico';
    }

    const plan = buildEditPlan({ draft, transcript, normUrl, srcDurationSec, srcWidth, srcHeight, srcHasAudio });
    return { plan, planModel };
  }

  private async callModel(
    wordList: string,
    instruction: string,
    srcDurationSec: number,
    previousErrors: string[],
  ): Promise<EditPlanDraft> {
    const errorNote = previousErrors.length
      ? `\n\nA tentativa anterior falhou por: ${previousErrors.join('; ')}. Corrija isso.`
      : '';

    const userPrompt = `Duração do vídeo: ${srcDurationSec.toFixed(1)}s.

Instrução do usuário: "${instruction || '(nenhuma instrução específica — use seu critério editorial)'}"

Transcrição (palavras numeradas, formato índice:palavra):
${wordList}${errorNote}`;

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_schema', json_schema: DRAFT_SCHEMA },
    });

    const raw = response.choices[0].message.content?.trim();
    if (!raw) throw new Error('A IA não respondeu');

    return JSON.parse(raw) as EditPlanDraft;
  }
}
