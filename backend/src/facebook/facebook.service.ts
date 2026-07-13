import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash } from 'crypto';
import { Lead } from '../common/entities/lead.entity';

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);

  constructor(private config: ConfigService) {}

  private sha256(value: string): string {
    return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
  }

  private buildFbc(fbclid: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    return `fb.1.${timestamp}.${fbclid}`;
  }

  private buildUserData(lead: Lead): Record<string, string> {
    const userData: Record<string, string> = {};
    if (lead.email) userData['em'] = this.sha256(lead.email);
    if (lead.phone) userData['ph'] = this.sha256(`55${lead.phone.replace(/\D/g, '')}`);
    if (lead.name) userData['fn'] = this.sha256(lead.name.split(' ')[0]);
    if (lead.fbclid) userData['fbc'] = this.buildFbc(lead.fbclid);
    // ctwa_clid: atribuição de lead vindo de anúncio Click-to-WhatsApp. Vai em
    // texto puro (NÃO hasheado) no user_data, conforme o CAPI espera pra CTWA.
    // O Meta também exige page_id nesse caso (validado via teste direto na API
    // em 2026-07-11 — sem isso o evento de mensagens é rejeitado).
    if (lead.ctwaClid) {
      userData['ctwa_clid'] = lead.ctwaClid;
      const pageId = this.config.get('FB_PAGE_ID');
      if (pageId) userData['page_id'] = pageId;
    }
    if (lead.id) userData['external_id'] = lead.id;
    return userData;
  }

  private async sendEvent(
    eventName: string,
    userData: Record<string, string>,
    customData?: Record<string, any>,
    eventSourceUrl?: string,
    opts?: { ctwa?: boolean },
  ): Promise<void> {
    const pixelId = this.config.get('FB_PIXEL_ID');
    const accessToken = this.config.get('FB_ACCESS_TOKEN');

    if (!pixelId || !accessToken) {
      this.logger.warn('FB_PIXEL_ID ou FB_ACCESS_TOKEN não configurados — evento não enviado');
      return;
    }

    // Leads de anúncio Click-to-WhatsApp exigem action_source=business_messaging
    // + messaging_channel=whatsapp pro Meta atribuir o evento ao clique no anúncio
    // (o ctwa_clid no user_data casa com o clique). Demais fluxos (LP/form) seguem
    // action_source=website.
    const isCtwa = Boolean(opts?.ctwa && userData['ctwa_clid']);

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: isCtwa ? 'business_messaging' : 'website',
          ...(isCtwa ? { messaging_channel: 'whatsapp' } : {}),
          user_data: userData,
          // event_source_url é rejeitado pelo Meta em eventos business_messaging
          // (validado via teste direto na API em 2026-07-11 — erro 400 "Please
          // remove all invalid arguments... event_source_url"). Só envia no fluxo
          // de site (LP/form).
          ...(!isCtwa && eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
          ...(customData ? { custom_data: customData } : {}),
        },
      ],
    };

    try {
      await axios.post(
        `https://graph.facebook.com/v21.0/${pixelId}/events`,
        payload,
        { params: { access_token: accessToken } },
      );
      this.logger.log(`Evento "${eventName}" enviado ao Facebook`);
    } catch (err: any) {
      const metaError = err?.response?.data?.error?.error_user_msg || err?.response?.data?.error?.message;
      this.logger.error(`Erro ao enviar evento "${eventName}" ao Facebook: ${err.message}${metaError ? ` — ${metaError}` : ''}`);
    }
  }

  async getAdCreative(adId: string): Promise<any> {
    const accessToken = this.config.get('FB_ADS_TOKEN');
    const adAccountId = this.config.get('FB_AD_ACCOUNT_ID');
    if (!accessToken) throw new Error('FB_ADS_TOKEN não configurado');

    // Busca o anúncio com creative e asset_feed_spec para pegar hashes de imagem.
    // thumbnail_width/height(1080) pede o thumbnail em alta resolução — sem isso
    // o Meta devolve um recorte de 64x64 (fica borrado/pixelado ao exibir grande,
    // principalmente em anúncios de vídeo, onde é o único preview disponível
    // sem permissão de Página).
    const adResponse = await axios.get(`https://graph.facebook.com/v21.0/${adId}`, {
      params: {
        fields: 'name,creative.thumbnail_width(1080).thumbnail_height(1080){thumbnail_url,title,body,asset_feed_spec,video_id,object_type}',
        access_token: accessToken,
      },
    });

    const data = adResponse.data;
    const imageHash = data.creative?.asset_feed_spec?.images?.[0]?.hash;

    // Se tem hash e account ID, busca a imagem em alta resolução
    if (imageHash && adAccountId) {
      try {
        const imgResponse = await axios.get(`https://graph.facebook.com/v21.0/${adAccountId}/adimages`, {
          params: {
            hashes: JSON.stringify([imageHash]),
            fields: 'url,width,height',
            access_token: accessToken,
          },
        });
        const fullImage = imgResponse.data?.data?.[0];
        if (fullImage?.url) {
          data.creative.image_url = fullImage.url;
          data.creative.image_width = fullImage.width;
          data.creative.image_height = fullImage.height;
        }
      } catch {
        // fallback para thumbnail se falhar
      }
    }

    // Anúncio de vídeo: busca o arquivo completo (com áudio) via token de Página
    // — o vídeo pertence à Página, não à conta de anúncio, e precisa de
    // pages_read_engagement (FB_ADS_TOKEN sozinho não acessa o "source" do vídeo).
    // A URL retornada expira (assinada pelo Meta), por isso não é cacheada —
    // buscada sob demanda toda vez que o modal "Ver criativo" abre.
    if (data.creative?.object_type === 'VIDEO' && data.creative?.video_id) {
      try {
        const pageToken = await this.getPageAccessToken(accessToken);
        if (pageToken) {
          const videoResponse = await axios.get(`https://graph.facebook.com/v21.0/${data.creative.video_id}`, {
            params: { fields: 'source,length', access_token: pageToken },
          });
          data.creative.video_url = videoResponse.data.source;
          data.creative.video_length = videoResponse.data.length;
        }
      } catch (err: any) {
        this.logger.warn(`Erro ao buscar vídeo completo do anúncio ${adId}: ${err.message}`);
      }
    }

    return data;
  }

  /** Gasto (spend) de um anúncio na Marketing API, usado pra calcular custo por lead qualificado. */
  async getAdSpend(adId: string, range?: { since: string; until: string }): Promise<number> {
    const accessToken = this.config.get('FB_ADS_TOKEN');
    if (!accessToken) return 0;
    try {
      const params: Record<string, string> = { fields: 'spend', access_token: accessToken };
      if (range) {
        params.time_range = JSON.stringify(range);
      } else {
        params.date_preset = 'maximum';
      }
      const response = await axios.get(`https://graph.facebook.com/v21.0/${adId}/insights`, { params });
      const spend = response.data?.data?.[0]?.spend;
      return spend ? parseFloat(spend) : 0;
    } catch (err: any) {
      this.logger.warn(`Erro ao buscar gasto do anúncio ${adId}: ${err.message}`);
      return 0;
    }
  }

  /** Resolve o access token da Página (FB_PAGE_ID) a partir de um token de usuário/sistema. */
  private async getPageAccessToken(userToken: string): Promise<string | null> {
    const pageId = this.config.get('FB_PAGE_ID');
    if (!pageId) return null;
    const response = await axios.get('https://graph.facebook.com/v21.0/me/accounts', {
      params: { access_token: userToken },
    });
    const page = (response.data?.data || []).find((p: any) => p.id === pageId);
    return page?.access_token ?? null;
  }

  /**
   * Busca nome real de anúncio/conjunto/campanha via Marketing API, a partir do
   * Ad ID (source_id do referral CTWA). Usado só pra atribuição de leads vindos
   * de WhatsApp — não mexe no fluxo de LP/site, que já resolve isso via UTM da URL.
   */
  async getAdDetails(adId: string): Promise<{ adName: string; adsetName: string; adsetId: string; campaignName: string } | null> {
    const accessToken = this.config.get('FB_ADS_TOKEN');
    if (!accessToken) return null;

    try {
      const response = await axios.get(`https://graph.facebook.com/v21.0/${adId}`, {
        params: {
          fields: 'name,adset{name,id},campaign{name}',
          access_token: accessToken,
        },
      });
      const data = response.data;
      return {
        adName: data.name,
        adsetName: data.adset?.name,
        adsetId: data.adset?.id,
        campaignName: data.campaign?.name,
      };
    } catch (err: any) {
      this.logger.warn(`Erro ao buscar detalhes do anúncio ${adId}: ${err.message}`);
      return null;
    }
  }

  async sendLeadEvent(lead: Lead, extra?: { fbp?: string; fbc?: string; userAgent?: string; clientIp?: string }): Promise<void> {
    const userData = this.buildUserData(lead);
    if (extra?.fbp) userData['fbp'] = extra.fbp;
    // Prefere o _fbc cookie do browser (timestamp correto do clique) sobre o construído no backend
    if (extra?.fbc) userData['fbc'] = extra.fbc;
    if (extra?.clientIp) userData['client_ip_address'] = extra.clientIp;
    if (extra?.userAgent) userData['client_user_agent'] = extra.userAgent;
    const ctwa = Boolean(lead.ctwaClid);
    // WhatsApp CTWA (business_messaging) só aceita "LeadSubmitted"/"Purchase" como
    // nome de evento — "Lead" customizado só é aceito no fluxo de site (LP/form).
    const eventName = ctwa ? 'LeadSubmitted' : 'Lead';
    await this.sendEvent(eventName, userData, undefined, lead.ctwaSourceUrl, { ctwa });
  }

  async sendPurchaseEvent(lead: Lead, value: number): Promise<void> {
    const userData = this.buildUserData(lead);
    await this.sendEvent('Purchase', userData, { value, currency: 'BRL' }, lead.ctwaSourceUrl, { ctwa: Boolean(lead.ctwaClid) });
  }

  async sendMqlEvent(lead: Lead, extra?: { fbp?: string; fbc?: string; userAgent?: string; clientIp?: string }): Promise<void> {
    const userData = this.buildUserData(lead);
    if (extra?.fbp) userData['fbp'] = extra.fbp;
    if (extra?.fbc) userData['fbc'] = extra.fbc;
    if (extra?.clientIp) userData['client_ip_address'] = extra.clientIp;
    if (extra?.userAgent) userData['client_user_agent'] = extra.userAgent;
    // CTWA (anúncio direto pro WhatsApp) usa business_messaging + source_url do
    // anúncio; leads de LP/form seguem website + a URL da landing.
    const ctwa = Boolean(lead.ctwaClid);
    // WhatsApp CTWA não aceita evento customizado "MQL" (só LeadSubmitted/Purchase
    // são válidos pra business_messaging) — usa "Purchase" com valor simbólico
    // como sinal de lead qualificado nesse canal. Fluxo de site continua com "MQL".
    const eventName = ctwa ? 'Purchase' : 'MQL';
    const customData = ctwa ? { value: 1, currency: 'BRL' } : undefined;
    await this.sendEvent(eventName, userData, customData, lead.ctwaSourceUrl ?? 'https://leadscomia.vercel.app/', { ctwa });
  }
}
