import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { LeadsService } from '../leads/leads.service';
import { AiAnalysisService } from '../ai-analysis/ai-analysis.service';
import { MessagingService } from '../messaging/messaging.service';
import { Lead, EnrichmentData } from '../common/entities/lead.entity';

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly apifyToken: string;
  // Stories (fetchInstagramStories) ainda não migrado pra Apify — segue no
  // RapidAPI por decisão explícita (migração feita em etapas: perfil+posts
  // primeiro, stories depois).
  private readonly rapidapiKey: string;
  private readonly rapidapiHost: string;
  private readonly sdrUazapiBaseUrl: string;
  private readonly sdrUazapiToken: string;
  private readonly disableProfileAiAnalysis: boolean;

  constructor(
    private config: ConfigService,
    private leadsService: LeadsService,
    private aiAnalysisService: AiAnalysisService,
    private messagingService: MessagingService,
  ) {
    this.disableProfileAiAnalysis = config.get('DISABLE_PROFILE_AI_ANALYSIS') === 'true';
    this.apifyToken = config.get('APIFY_TOKEN') || '';
    this.rapidapiKey = config.get('RAPIDAPI_KEY') || '';
    this.rapidapiHost = config.get('RAPIDAPI_HOST') || 'instagram120.p.rapidapi.com';
    // Follow-up de stories precisa sair pelo número que o lead já conhece. Hoje
    // todo lead é do fluxo SDR (agentMode='sdr') — a instância do Efraim
    // (MessagingService/UAZAPI_TOKEN) está desconectada e, mesmo se estivesse
    // ativa, seria um número diferente do que o lead já está conversando.
    this.sdrUazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || '';
    this.sdrUazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
  }

  async enrichLeadFromInstagram(leadId: string, opts?: { skipMessage?: boolean }): Promise<Lead> {
    const lead = await this.leadsService.findById(leadId);

    if (!lead.instagram) {
      this.logger.warn(`Lead ${leadId} não tem Instagram`);
      return lead;
    }

    try {
      const handle = lead.instagram.replace(/^@/, '');
      const { enrichmentData, posts } = await this.fetchInstagramProfileApify(handle);
      enrichmentData.posts = posts;

      const bonusScore = enrichmentData.enrichment_bonus || 0;
      const newScore = lead.score + bonusScore;

      const aiInsight = this.disableProfileAiAnalysis
        ? null
        : await this.aiAnalysisService.analyzeLeadInstagram(
            lead.name,
            lead.instagram,
            enrichmentData.followers || 0,
            enrichmentData.engagement_rate || 0,
            enrichmentData.content_type || '',
            posts,
          );

      if (this.disableProfileAiAnalysis) {
        this.logger.warn(`DISABLE_PROFILE_AI_ANALYSIS=true — pulando análise de IA do perfil (lead ${leadId})`);
      }

      const updated = await this.leadsService.update(leadId, {
        enrichmentData,
        aiInsight,
        score: newScore,
      });

      this.logger.log(`Lead ${leadId} enriquecido: +${bonusScore}pts (total: ${newScore})`);

      // Enviar mensagem enriquecida via WhatsApp — só no fluxo original (form/Efraim).
      // Leads do SDR já têm a Sofia conversando; skipMessage evita duplicar/colidir
      // com o fluxo dela e também evita depender do MessagingService (Efraim),
      // que usa uma instância separada e hoje está desconectada.
      if (!opts?.skipMessage) {
        this.sendEnrichedMessage(updated, aiInsight).catch(err =>
          this.logger.error(`Erro ao enviar mensagem enriquecida: ${err.message}`),
        );
      }

      return updated;
    } catch (err) {
      this.logger.error(`Erro ao enriquecer lead ${leadId}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Busca perfil + posts recentes num único request ao actor `apify/instagram-scraper`
   * (resultsType=details já retorna latestPosts junto, sem precisar de 2 chamadas
   * como no RapidAPI). Não requer login e roda em infra própria da Apify — resolve
   * o bloqueio de IP de datacenter que o RapidAPI tinha no Railway.
   */
  private async fetchInstagramProfileApify(handle: string): Promise<{ enrichmentData: EnrichmentData; posts: any[] }> {
    if (!this.apifyToken) {
      throw new Error('APIFY_TOKEN não configurado');
    }

    try {
      const response = await axios.post(
        `https://api.apify.com/v2/actors/apify~instagram-scraper/run-sync-get-dataset-items`,
        {
          directUrls: [`https://www.instagram.com/${handle}/`],
          resultsType: 'details',
          resultsLimit: 1,
        },
        {
          params: { token: this.apifyToken, timeout: 60 },
          timeout: 65000,
        },
      );

      const data = response.data?.[0];
      if (!data || data.error) {
        throw new Error(data?.error || 'perfil não encontrado');
      }

      const followers = data.followersCount || 0;
      const latestPosts = Array.isArray(data.latestPosts) ? data.latestPosts : [];

      const posts = latestPosts.slice(0, 3).map((p: any) => ({
        code: p.shortCode,
        caption: p.caption || '',
        takenAt: p.timestamp ? Math.floor(new Date(p.timestamp).getTime() / 1000) : 0,
        imageUrl: p.displayUrl || '',
        commentCount: p.commentsCount || 0,
        likeCount: p.likesCount || 0,
      }));

      // Engajamento real: média de (curtidas + comentários) dos posts recentes / seguidores.
      const avgEngagement =
        latestPosts.length > 0
          ? latestPosts.reduce((sum: number, p: any) => sum + (p.likesCount || 0) + (p.commentsCount || 0), 0) / latestPosts.length
          : 0;

      return {
        enrichmentData: {
          followers,
          engagement_rate: followers > 0 ? avgEngagement / followers : 0,
          content_type: data.biography || '',
          recent_stories: [],
          enrichment_bonus: 0,
        },
        posts,
      };
    } catch (err: any) {
      this.logger.error(`Apify error (${handle}): ${err.message}`);
      throw new Error('Falha ao buscar dados do Instagram');
    }
  }

  private async sendEnrichedMessage(lead: Lead, aiInsight: any): Promise<void> {
    if (!lead.phone || !aiInsight?.outreach_message) {
      return;
    }

    try {
      await this.messagingService.sendMessage({
        leadId: lead.id,
        text: aiInsight.outreach_message,
      });
    } catch (err: any) {
      this.logger.warn(`Não foi possível enviar mensagem enriquecida: ${err.message}`);
    }
  }

  async generateFollowupForLead(leadId: string): Promise<{ message: string; hasStories: boolean; storiesCount: number }> {
    const lead = await this.leadsService.findById(leadId);

    let stories: any[] = [];
    if (lead.instagram) {
      const handle = lead.instagram.replace(/^@/, '');
      stories = await this.fetchInstagramStories(handle);
    }

    const analyzedStories = stories.length > 0
      ? await this.aiAnalysisService.analyzeStoryImages(stories)
      : [];

    const message = await this.aiAnalysisService.generateFollowupMessage(lead, analyzedStories);
    return { message, hasStories: stories.length > 0, storiesCount: stories.length };
  }

  async sendFollowupMessage(leadId: string, message: string): Promise<{ sent: boolean }> {
    const lead = await this.leadsService.findById(leadId);

    if (!this.sdrUazapiToken) {
      throw new Error('SDR_UAZAPI_TOKEN não configurado — não é possível enviar o follow-up');
    }

    const phone = lead.phone.startsWith('55') ? lead.phone : `55${lead.phone}`;
    await axios.post(
      `${this.sdrUazapiBaseUrl}/send/text`,
      { number: phone, text: message },
      { headers: { token: this.sdrUazapiToken } },
    );

    const history = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    await this.leadsService.update(leadId, {
      aiContext: [...history, { role: 'assistant', content: message }],
      waLastMessageAt: new Date(),
    });

    this.logger.log(`Follow-up de stories enviado para ${phone} (lead: ${lead.name})`);
    return { sent: true };
  }

  private async fetchInstagramStories(handle: string): Promise<any[]> {
    try {
      const response = await axios.post(
        `https://${this.rapidapiHost}/api/instagram/stories`,
        { username: handle },
        {
          headers: {
            'x-rapidapi-key': this.rapidapiKey,
            'x-rapidapi-host': this.rapidapiHost,
            'Content-Type': 'application/json',
          },
        },
      );

      const items: any[] = response.data?.result || [];
      return items.slice(0, 5).map((story: any) => ({
        takenAt: story.taken_at,
        mediaType: story.media_type === 2 ? 'video' : 'foto',
        caption: story.caption?.text || '',
        imageUrl: story.image_versions2?.candidates?.[0]?.url || '',
      }));
    } catch (err: any) {
      this.logger.warn(`Stories indisponíveis para ${handle} (provavelmente conta privada): ${err.message}`);
      return [];
    }
  }

}
