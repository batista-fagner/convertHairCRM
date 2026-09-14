import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Prospect } from './prospect.entity';
import { SettingsService } from '../settings/settings.service';
import { extractCandidateFirstName, lookupGender } from '../sdr/name-gender.util';

const CURRENT_SEED_KEY = 'prospecting_current_seed';
const MODEL_SETTING_KEY = 'prospecting_model';
const MESSAGE_MODE_KEY = 'prospecting_message_mode'; // 'ai' | 'fixed'
const FIXED_MESSAGE_KEY = 'prospecting_fixed_message';

export type ProspectMessageMode = 'ai' | 'fixed';

const DEFAULT_FIXED_MESSAGE =
  'Olá {saudacao} tudo bem?\n\n' +
  'Vi seu perfil e achei muito bom o trabalho de vocês 👏\n\n' +
  'Trabalho ajudando clínicas a não perderem paciente por demora no WhatsApp — um agente de IA que responde e agenda na hora, 24h integrado a um CRM, pra vc acompanhar todos os leads. Além de eu trabalhar entregando leads qualificados para clínicas\n\n' +
  'Faz sentido pra vocês eu te mostrar rapidinho como funciona?';

export interface ProspectListFilters {
  responded?: boolean;
  from?: string;
  to?: string;
}

@Injectable()
export class ProspectingService {
  private readonly logger = new Logger(ProspectingService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    @InjectRepository(Prospect) private readonly prospectRepo: Repository<Prospect>,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    this.model = config.get('PROSPECTING_OPENAI_MODEL') || 'gpt-5.4-mini';
  }

  async create(data: { username: string; fullName?: string; message: string; sentAt: string | Date; seedUsername?: string }): Promise<Prospect> {
    const prospect = this.prospectRepo.create({
      username: data.username,
      fullName: data.fullName,
      message: data.message,
      sentAt: new Date(data.sentAt),
      seedUsername: data.seedUsername,
    });
    return this.prospectRepo.save(prospect);
  }

  async list(filters: ProspectListFilters): Promise<{ items: Prospect[]; stats: { total: number; responded: number; rate: number } }> {
    const qb = this.prospectRepo.createQueryBuilder('p').orderBy('p.sentAt', 'DESC');
    if (filters.responded !== undefined) qb.andWhere('p.responded = :responded', { responded: filters.responded });
    if (filters.from) qb.andWhere('p.sentAt >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('p.sentAt <= :to', { to: filters.to });

    const items = await qb.getMany();

    const total = await this.prospectRepo.count();
    const responded = await this.prospectRepo.count({ where: { responded: true } });
    const rate = total > 0 ? responded / total : 0;

    return { items, stats: { total, responded, rate } };
  }

  async markResponded(id: string, responded: boolean): Promise<Prospect> {
    const prospect = await this.prospectRepo.findOneOrFail({ where: { id } });
    prospect.responded = responded;
    prospect.repliedAt = responded ? new Date() : null;
    return this.prospectRepo.save(prospect);
  }

  async getCurrentSeed(): Promise<string | null> {
    return this.settings.get(CURRENT_SEED_KEY);
  }

  async setCurrentSeed(username: string): Promise<void> {
    await this.settings.set(CURRENT_SEED_KEY, username);
    // Best-effort: marca o prospect correspondente, se existir — não é obrigatório
    // pra semente funcionar (o usuário também pode digitar um username manualmente).
    const match = await this.prospectRepo.findOne({ where: { username }, order: { createdAt: 'DESC' } });
    if (match) {
      match.promotedToSeed = true;
      await this.prospectRepo.save(match);
    }
  }

  async getMessageConfig(): Promise<{ mode: ProspectMessageMode; fixedMessage: string }> {
    const mode = (await this.settings.get(MESSAGE_MODE_KEY)) === 'fixed' ? 'fixed' : 'ai';
    const fixedMessage = (await this.settings.get(FIXED_MESSAGE_KEY)) || DEFAULT_FIXED_MESSAGE;
    return { mode, fixedMessage };
  }

  async setMessageConfig(patch: { mode?: ProspectMessageMode; fixedMessage?: string }): Promise<{ mode: ProspectMessageMode; fixedMessage: string }> {
    if (patch.mode) await this.settings.set(MESSAGE_MODE_KEY, patch.mode === 'fixed' ? 'fixed' : 'ai');
    if (typeof patch.fixedMessage === 'string') await this.settings.set(FIXED_MESSAGE_KEY, patch.fixedMessage);
    return this.getMessageConfig();
  }

  /**
   * Doutor/Doutora decidido pelo mesmo mecanismo de gênero por nome (IBGE) já
   * usado na saudação da Sofia (ver sdr/name-gender.util.ts) — nunca pela IA.
   * Ambíguo/sem dado/sem nome reconhecível → "Doutora" (maioria do nicho
   * de harmonização/odontologia é mulher, por decisão do usuário).
   */
  private async buildFixedMessage(template: string, fullName?: string): Promise<string> {
    const firstName = extractCandidateFirstName(fullName ?? '') ?? '';
    const gender = firstName ? await lookupGender(firstName) : null;
    const saudacao = gender === 'M' ? 'Doutor' : 'Doutora';
    return template.replace(/\{saudacao\}/gi, saudacao).replace(/\{nome\}/gi, firstName);
  }

  /** Ponto único chamado pelo endpoint /generate-message — decide IA vs texto fixo. */
  async resolveMessage(username: string, fullName?: string): Promise<string> {
    const { mode, fixedMessage } = await this.getMessageConfig();
    if (mode === 'fixed') return this.buildFixedMessage(fixedMessage, fullName);
    return this.generateSoftOpenMessage(fullName, username);
  }

  async generateSoftOpenMessage(fullName?: string, username?: string): Promise<string> {
    const model = (await this.settings.get(MODEL_SETTING_KEY)) || this.model;
    const displayName = fullName?.trim() || username || '';

    const prompt = `Gere uma única mensagem curta (1 a 2 frases), em português informal (use "você"), pra responder ao story do Instagram de "${displayName}". ` +
      `O objetivo é só quebrar o gelo e conseguir uma resposta amigável dela — NÃO mencione produto, serviço, venda, negócio ou qualquer proposta comercial. ` +
      `Seja calorosa e genérica, tipo um elogio/comentário casual sobre o story (sem inventar detalhes específicos do conteúdo, já que você não viu a imagem). ` +
      `Cite o primeiro nome dela se fizer sentido. Responda só com o texto da mensagem, sem aspas, sem explicações.`;

    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        max_completion_tokens: 120,
      });
      const message = response.choices[0]?.message?.content?.trim();
      if (!message) throw new Error('Resposta vazia da OpenAI');
      return message;
    } catch (err) {
      this.logger.error(`Falha ao gerar mensagem de prospecção pra "${displayName}": ${err.message}`);
      throw err;
    }
  }
}
