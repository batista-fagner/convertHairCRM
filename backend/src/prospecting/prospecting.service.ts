import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import OpenAI from 'openai';
import { Prospect } from './prospect.entity';
import { SettingsService } from '../settings/settings.service';
import { extractCandidateFirstName, lookupGender } from '../sdr/name-gender.util';

const CURRENT_SEED_KEY = 'prospecting_current_seed';
const MODEL_SETTING_KEY = 'prospecting_model';
const MESSAGE_MODE_KEY = 'prospecting_message_mode'; // 'ai' | 'fixed'
const FIXED_MESSAGE_KEY = 'prospecting_fixed_message';
const AI_PROMPT_KEY = 'prospecting_ai_prompt';

export type ProspectMessageMode = 'ai' | 'fixed';

const DEFAULT_FIXED_MESSAGE =
  'Olá {saudacao} tudo bem?\n\n' +
  'Vi seu perfil e achei muito bom o trabalho de vocês 👏\n\n' +
  'Trabalho ajudando clínicas a não perderem paciente por demora no WhatsApp — um agente de IA que responde e agenda na hora, 24h integrado a um CRM, pra vc acompanhar todos os leads. Além de eu trabalhar entregando leads qualificados para clínicas\n\n' +
  'Faz sentido pra vocês eu te mostrar rapidinho como funciona?';

// Prompt base editável em Settings (mesmo espírito do DEFAULT_SDR_PROMPT da
// Sofia) — placeholders {nome}/{bio}/{categoria} substituídos antes de
// mandar pra IA. Bio/categoria vêm de busca real no perfil (ScrapeCreators,
// ver fetchInstagramProfile) — se a busca falhar ou vier vazia, os
// placeholders caem num aviso explícito ("sem informação disponível") pra IA
// nunca inventar conteúdo que não existe.
const DEFAULT_AI_PROMPT = `Você vai escrever uma mensagem curta (1 a 2 frases), em português informal (use "você"), pra responder ao story do Instagram de "{nome}".

Informações reais do perfil dela, pra você usar como contexto (nunca invente nada além disso):
- Bio: {bio}
- Categoria/atividade: {categoria}

O objetivo é só quebrar o gelo e conseguir uma resposta amigável — NÃO mencione produto, serviço, venda, negócio ou qualquer proposta comercial nessa mensagem. Se a bio ou categoria derem uma pista real sobre o que ela faz, use isso pra fazer um comentário específico e genuíno (não um elogio genérico e vazio). Se não houver informação suficiente, seja calorosa e casual mesmo assim, sem inventar detalhes que você não tem.

Cite o primeiro nome dela se fizer sentido. Responda só com o texto da mensagem, sem aspas, sem explicações.`;

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
  private readonly scrapeCreatorsApiKey: string;

  constructor(
    @InjectRepository(Prospect) private readonly prospectRepo: Repository<Prospect>,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    this.model = config.get('PROSPECTING_OPENAI_MODEL') || 'gpt-5.4-mini';
    this.scrapeCreatorsApiKey = config.get('SCRAPECREATORS_API_KEY') || '';
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

  async getMessageConfig(): Promise<{ mode: ProspectMessageMode; fixedMessage: string; aiPrompt: string }> {
    const mode = (await this.settings.get(MESSAGE_MODE_KEY)) === 'fixed' ? 'fixed' : 'ai';
    const fixedMessage = (await this.settings.get(FIXED_MESSAGE_KEY)) || DEFAULT_FIXED_MESSAGE;
    const aiPrompt = (await this.settings.get(AI_PROMPT_KEY)) || DEFAULT_AI_PROMPT;
    return { mode, fixedMessage, aiPrompt };
  }

  async setMessageConfig(patch: { mode?: ProspectMessageMode; fixedMessage?: string; aiPrompt?: string }): Promise<{ mode: ProspectMessageMode; fixedMessage: string; aiPrompt: string }> {
    if (patch.mode) await this.settings.set(MESSAGE_MODE_KEY, patch.mode === 'fixed' ? 'fixed' : 'ai');
    if (typeof patch.fixedMessage === 'string') await this.settings.set(FIXED_MESSAGE_KEY, patch.fixedMessage);
    if (typeof patch.aiPrompt === 'string') await this.settings.set(AI_PROMPT_KEY, patch.aiPrompt);
    return this.getMessageConfig();
  }

  /**
   * Busca dados reais do perfil (bio, categoria) via ScrapeCreators —
   * best-effort: qualquer falha (sem chave configurada, rede, perfil
   * privado/inexistente) retorna null e o chamador tenta o fallback ou segue
   * sem personalização de bio, nunca quebra a geração da mensagem.
   */
  private async fetchInstagramProfile(username: string): Promise<{ bio: string; categoria: string; userId: string } | null> {
    if (!this.scrapeCreatorsApiKey || !username) return null;
    try {
      const res = await firstValueFrom(
        this.http.get('https://api.scrapecreators.com/v1/instagram/profile', {
          params: { handle: username },
          headers: { 'x-api-key': this.scrapeCreatorsApiKey },
          timeout: 8000,
        }),
      );
      const user = res.data?.data?.user;
      if (!user?.id) return null;
      return {
        bio: (user.biography || '').trim(),
        categoria: (user.category_name || user.business_category_name || '').trim(),
        userId: String(user.id),
      };
    } catch (err: any) {
      this.logger.warn(`Não foi possível buscar perfil "${username}" no ScrapeCreators (/profile): ${err.message}`);
      return null;
    }
  }

  /**
   * Fallback do /profile — usado quando ele falha, mas só funciona se já
   * tivermos o userId em cache de uma busca anterior bem-sucedida (esse
   * endpoint não aceita username/handle, só userId).
   */
  private async fetchInstagramBasicProfile(userId: string): Promise<{ bio: string; categoria: string } | null> {
    if (!this.scrapeCreatorsApiKey || !userId) return null;
    try {
      const res = await firstValueFrom(
        this.http.get('https://api.scrapecreators.com/v1/instagram/basic-profile', {
          params: { userId },
          headers: { 'x-api-key': this.scrapeCreatorsApiKey },
          timeout: 8000,
        }),
      );
      if (res.data?.success === false) return null;
      return {
        bio: (res.data?.biography || '').trim(),
        categoria: (res.data?.category || '').trim(),
      };
    } catch (err: any) {
      this.logger.warn(`Não foi possível buscar perfil (userId ${userId}) no ScrapeCreators (/basic-profile): ${err.message}`);
      return null;
    }
  }

  /** Best-effort: guarda o userId no prospect já existente (se houver) pra viabilizar o fallback numa próxima busca. */
  private async cacheInstagramUserId(username: string, userId: string): Promise<void> {
    try {
      const existing = await this.prospectRepo.findOne({ where: { username } });
      if (existing && existing.instagramUserId !== userId) {
        existing.instagramUserId = userId;
        await this.prospectRepo.save(existing);
      }
    } catch {
      // Best-effort — nunca deixa isso quebrar a geração da mensagem.
    }
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
    const { aiPrompt } = await this.getMessageConfig();

    let profile = username ? await this.fetchInstagramProfile(username) : null;
    if (profile) {
      await this.cacheInstagramUserId(username!, profile.userId);
    } else if (username) {
      // /profile falhou — tenta o fallback só se já tivermos o userId em
      // cache de uma busca anterior bem-sucedida pra esse mesmo username.
      const cached = await this.prospectRepo.findOne({ where: { username } });
      if (cached?.instagramUserId) {
        const fallback = await this.fetchInstagramBasicProfile(cached.instagramUserId);
        if (fallback) profile = { ...fallback, userId: cached.instagramUserId };
      }
    }
    const bio = profile?.bio || '(sem informação disponível)';
    const categoria = profile?.categoria || '(sem informação disponível)';

    const prompt = aiPrompt
      .replace(/\{nome\}/gi, displayName)
      .replace(/\{bio\}/gi, bio)
      .replace(/\{categoria\}/gi, categoria);

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
