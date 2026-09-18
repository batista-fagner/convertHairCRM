import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import { EditPlanTranscript } from './edit-plan.types';

// Termos do negócio que o Whisper erra fácil sem contexto (nomes próprios,
// jargão) — o `prompt` da API não muda o que é dito, só influencia a grafia
// de palavras ambíguas.
const GLOSSARY = 'cabelo, mega hair, fornecedor, fio, extensão capilar, tráfego pago, WhatsApp, Instagram, Reels';

@Injectable()
export class VideoEditTranscribeService {
  private readonly logger = new Logger(VideoEditTranscribeService.name);
  private readonly openai: OpenAI;

  constructor(config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
  }

  // whisper-1 é o ÚNICO modelo da OpenAI com timestamp por palavra
  // (timestamp_granularities exige response_format verbose_json, e os
  // gpt-4o-transcribe/gpt-transcribe não suportam granularidade de palavra até
  // a data deste código — worth re-checar se a Etapa evoluir).
  async transcribe(audioBuffer: Buffer): Promise<EditPlanTranscript> {
    let result;
    try {
      result = await this.openai.audio.transcriptions.create({
        file: await toFile(audioBuffer, 'audio.mp3'),
        model: 'whisper-1',
        language: 'pt',
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        prompt: GLOSSARY,
      });
    } catch (err: any) {
      this.logger.error(`Erro ao transcrever áudio: ${err.message}`);
      throw new BadRequestException(`Falha na transcrição: ${err.message}`);
    }

    const words = (result.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end }));
    if (words.length === 0) {
      this.logger.warn('Transcrição voltou sem nenhuma palavra com timestamp — áudio pode estar mudo ou vazio');
    }

    return {
      text: result.text ?? '',
      words,
      segments: (result.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
      language: result.language ?? 'pt',
      duration: result.duration ?? 0,
    };
  }
}
