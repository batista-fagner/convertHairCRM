import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Lead } from '../common/entities/lead.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

interface LeadgenFieldData {
  name: string;
  values: string[];
}

// Lead do formulário aparece como card "Novo" no Kanban, com a Sofia pausada: o contato é pessoal
// (SDR/closer liga), o lead nem iniciou conversa no WhatsApp e já respondeu as perguntas no
// formulário. Quando a IA entrar nesse funil, basta tirar o aiPaused daqui.
const KANBAN_ENTRY = { agentMode: 'sdr' as const, kanbanStage: 'novo' as const, aiPaused: true };

// Origem do lead no Meta (campanha/conjunto/anúncio) — vem junto com as respostas.
interface LeadgenAdInfo {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  platform?: string;
  is_organic?: boolean;
}

@Injectable()
export class InstantFormsService {
  private readonly logger = new Logger(InstantFormsService.name);

  constructor(
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Processa 1 evento de leadgen recebido no webhook: busca os dados completos, salva o lead no CRM. */
  async processLeadgenEvent(leadgenId: string): Promise<void> {
    const token = this.config.get('FB_LEADS_TOKEN');
    if (!token) {
      this.logger.warn('FB_LEADS_TOKEN não configurado — não é possível buscar os dados do lead');
      return;
    }

    let fieldData: LeadgenFieldData[];
    let ad: LeadgenAdInfo = {};
    const url = `https://graph.facebook.com/v21.0/${leadgenId}`;
    const baseFields = 'id,form_id,field_data,created_time';
    const adFields = 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform,is_organic';
    try {
      let res;
      try {
        res = await axios.get(url, { params: { access_token: token, fields: `${baseFields},${adFields}` } });
      } catch (err: any) {
        // Os campos de anúncio são um extra: se o Meta recusar, o lead não pode se perder.
        this.logger.warn(`[InstantForms] Campos de anúncio indisponíveis (${err.response?.data?.error?.message || err.message}) — salvando sem campanha/anúncio`);
        res = await axios.get(url, { params: { access_token: token, fields: baseFields } });
      }
      fieldData = res.data.field_data || [];
      ad = res.data;
    } catch (err: any) {
      this.logger.error(`Erro ao buscar dados do lead ${leadgenId}: ${err.response?.data?.error?.message || err.message}`);
      return;
    }

    const getAnswer = (matcher: (name: string) => boolean): string | undefined => {
      const field = fieldData.find((f) => matcher(f.name.toLowerCase()));
      return field?.values?.[0];
    };

    // Nomes de campo custom do Meta variam (texto da pergunta, slug, etc.) —
    // por isso o match é por substring, não chave exata, já que não temos como
    // testar o formato real antes do 1º lead de verdade chegar.
    const fullName = getAnswer((n) => n.includes('full_name') || n === 'name' || n.includes('nome')) || 'Lead sem nome';
    const email = getAnswer((n) => n.includes('email'));
    const phoneRaw = getAnswer((n) => n.includes('número') || n.includes('numero') || n.includes('phone') || n.includes('telefone'));
    const phone = (phoneRaw || '').replace(/\D/g, '');

    if (!phone) {
      this.logger.warn(`Lead ${leadgenId} sem telefone reconhecível nos campos: ${JSON.stringify(fieldData.map((f) => f.name))}`);
    }

    const answersSummary = fieldData.map((f) => `${f.name}: ${f.values?.[0] ?? ''}`).join('\n');

    // Campanha → utm_campaign, conjunto → utm_term, anúncio → utm_content (mesmos campos do funil
    // WhatsApp, pra comparar criativos no CRM). Os IDs ficam no notes pra cruzar com o Gerenciador.
    const platform = ad.platform === 'ig' ? 'instagram' : ad.platform === 'fb' ? 'facebook' : ad.platform;
    const tracking = {
      utmMedium: ad.is_organic ? 'organico' : platform || undefined,
      utmCampaign: ad.campaign_name || undefined,
      utmTerm: ad.adset_name || undefined,
      utmContent: ad.ad_name || undefined,
    };
    const adIds = ad.ad_id ? `\nanuncio_id: ${ad.ad_id} | conjunto_id: ${ad.adset_id} | campanha_id: ${ad.campaign_id}` : '';

    const existing = phone ? await this.leadsRepo.findOne({ where: { phone } }) : null;
    const lead = existing
      ? await this.leadsRepo.save({
          ...existing,
          name: fullName,
          email: email || existing.email,
          formAnswers: fieldData,
          // lead que já veio por outro canal mantém a origem original; só preenche o que está vazio.
          // Se ainda não estava no Kanban (ex.: lead antigo só do formulário), entra na raia Novo.
          ...(existing.agentMode === 'sdr' ? {} : KANBAN_ENTRY),
          utmMedium: existing.utmMedium || tracking.utmMedium,
          utmCampaign: existing.utmCampaign || tracking.utmCampaign,
          utmTerm: existing.utmTerm || tracking.utmTerm,
          utmContent: existing.utmContent || tracking.utmContent,
          notes: `[Formulário Instantâneo — ${leadgenId}]${adIds}\n${answersSummary}`,
        })
      : await this.leadsRepo.save(
          this.leadsRepo.create({
            name: fullName,
            phone: phone || `sem-telefone-${leadgenId}`,
            email: email || undefined,
            status: 'novo',
            utmSource: 'formulario-instantaneo',
            ...KANBAN_ENTRY,
            ...tracking,
            formAnswers: fieldData,
            notes: `[Formulário Instantâneo — ${leadgenId}]${adIds}\n${answersSummary}`,
          }),
        );

    if (existing) this.realtime.emitLeadUpdated(lead as Lead);
    else this.realtime.emitLeadCreated(lead as Lead);

    this.logger.log(`[InstantForms] Lead ${lead.id} (${phone || 'sem telefone'}) capturado do formulário${tracking.utmContent ? ` — anúncio: ${tracking.utmContent}` : ''}`);
  }
}
