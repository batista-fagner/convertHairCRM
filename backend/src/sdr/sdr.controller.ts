import { Controller, Post, Body, Logger, Param } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SdrService, deriveKanbanStage, SdrStage } from './sdr.service';
import { LeadsService } from '../leads/leads.service';
import { FacebookService } from '../facebook/facebook.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService } from '../settings/settings.service';
import { EnrichmentService } from '../enrichment/enrichment.service';
import { Lead, WaStage } from '../common/entities/lead.entity';

export const SDR_NOTIFY_PHONES_KEY = 'sdr_notify_phones';

export interface CtwaReferral {
  clid?: string;
  sourceUrl?: string;
  sourceId?: string;
  adTitle?: string;
}

/**
 * Extrai os dados de anúncio Click-to-WhatsApp de um webhook uazapi. Esses
 * campos vêm no protocolo do WhatsApp (proto ExternalAdReplyInfo: ctwaClid,
 * sourceUrl, sourceId, title), como irmãos no mesmo objeto. O caminho exato
 * no payload uazapi não é documentado, então localizamos o NÓ que contém o
 * ctwaClid (chave bem específica, ~0 falso-positivo) e lemos os irmãos dali —
 * mais preciso que busca global, já que "title" é uma chave genérica que
 * poderia aparecer noutro ponto do payload. Só chega na 1ª mensagem (o clique).
 */
export function extractCtwaReferral(body: any): CtwaReferral {
  const findNodeWithCtwa = (obj: any, depth = 0): any => {
    if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
    for (const k of Object.keys(obj)) {
      const kl = k.toLowerCase();
      if ((kl === 'ctwaclid' || kl === 'ctwa_clid') && typeof obj[k] === 'string' && obj[k].trim()) {
        return obj;
      }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const found = findNodeWithCtwa(v, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };

  const node = findNodeWithCtwa(body);
  if (!node) return {};

  const pick = (keys: string[]): string | undefined => {
    for (const k of Object.keys(node)) {
      if (keys.includes(k.toLowerCase()) && typeof node[k] === 'string' && node[k].trim()) {
        return node[k].trim();
      }
    }
    return undefined;
  };

  return {
    clid: pick(['ctwaclid', 'ctwa_clid']),
    sourceUrl: pick(['sourceurl', 'source_url']),
    sourceId: pick(['sourceid', 'source_id']),
    adTitle: pick(['title', 'headline']),
  };
}

/**
 * Webhook do agente SDR — instância/número uazapi SEPARADO do Efraim.
 * Recebe mensagens de leads novos, qualifica via IA e move os cards do Kanban.
 */
@Controller('webhooks')
export class SdrController {
  private readonly logger = new Logger(SdrController.name);
  private readonly processedIds = new Set<string>();
  private readonly pendingBuffer = new Map<string, { timer: NodeJS.Timeout; texts: string[]; ctwa?: CtwaReferral }>();
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;
  private readonly operatorPhone: string;

  constructor(
    private readonly sdrService: SdrService,
    private readonly leadsService: LeadsService,
    private readonly facebookService: FacebookService,
    private readonly realtime: RealtimeGateway,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly enrichmentService: EnrichmentService,
  ) {
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || 'https://free.uazapi.com';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
    this.operatorPhone = config.get('SDR_OPERATOR_PHONE') || '';
  }

  @Post('sdr/:eventType')
  async handleEvent(@Param('eventType') eventType: string, @Body() body: any) {
    if (eventType === 'messages') {
      return this.handleWebhook(body);
    }
    return { ok: true };
  }

  @Post('sdr')
  async handleWebhook(@Body() body: any) {
    if (body.EventType !== 'messages') return { ok: true };

    const message = body.message;
    if (!message) return { ok: true };

    // Descoberta do formato CTWA: com SDR_LOG_RAW_WEBHOOK=true, loga o payload
    // cru pra confirmar onde o uazapi coloca o ctwa_clid num clique real de
    // anúncio. Manter desligado em operação normal (evita ruído/PII no log).
    if (this.config.get('SDR_LOG_RAW_WEBHOOK') === 'true') {
      this.logger.log(`[SDR][RAW] ${JSON.stringify(body).slice(0, 4000)}`);
    }

    // Mensagem enviada pelo próprio número do bot, digitada manualmente pelo
    // operador/closer (não veio da nossa API — wasSentByApi=false). Permite
    // controlar a IA por palavra-chave direto na conversa do WhatsApp: "opa"
    // pausa, "ok" reativa. Qualquer outro texto é o closer conversando de
    // verdade com o lead (ex.: pós-handoff) — antes isso era descartado sem
    // ser salvo, o que apagava a conversa do closer do histórico do lead.
    if (message.fromMe && !message.wasSentByApi && !message.isGroup) {
      const leadPhone: string = (body.chat?.phone ?? '').replace(/\D/g, '');
      const keyword = (message.text ?? '').trim().toLowerCase();
      if (keyword === 'opa' || keyword === 'ok') {
        if (leadPhone) await this.toggleAiByKeyword(leadPhone, keyword === 'opa');
      } else if (leadPhone && message.text) {
        await this.recordHumanReply(leadPhone, message.text);
      }
      return { ok: true };
    }

    if (message.fromMe || message.isGroup || message.wasSentByApi) return { ok: true };

    const phone: string = (body.chat?.phone ?? '').replace(/\D/g, '');
    let text: string = message.text ?? '';
    const messageId: string = message.messageid ?? '';
    const pushName: string = body.chat?.name ?? message.senderName ?? '';
    const isAudio = message.type === 'media' && ['audio', 'ptt', 'myaudio'].includes(message.mediaType);

    if (!phone) return { ok: true };

    // Áudio/PTT: transcreve via uazapi + Whisper antes de seguir o fluxo normal
    if (isAudio && messageId) {
      try {
        this.logger.log(`[SDR] Áudio recebido de ${phone} — transcrevendo...`);
        const res = await firstValueFrom(
          this.http.post(
            `${this.uazapiBaseUrl}/message/download`,
            { id: messageId, transcribe: true, generate_mp3: false, return_link: false, openai_apikey: this.config.get('OPENAI_API_KEY') },
            { headers: { token: this.uazapiToken } },
          ),
        );
        text = (res.data as any).transcription ?? '';
        if (!text) {
          this.logger.warn(`[SDR] Transcrição vazia de ${phone} — ignorando`);
          return { ok: true };
        }
        this.logger.log(`[SDR] Áudio de ${phone} transcrito: "${text}"`);
      } catch (err: any) {
        this.logger.error(`[SDR] Erro ao transcrever áudio de ${phone}: ${err.message}`);
        return { ok: true };
      }
    }

    if (!text) return { ok: true };

    // Ignora mensagens antigas (> 5 min)
    if (message.messageTimestamp) {
      const ageSeconds = Date.now() / 1000 - message.messageTimestamp;
      if (ageSeconds > 300) return { ok: true };
    }

    // Deduplicação
    if (this.processedIds.has(messageId)) return { ok: true };
    this.processedIds.add(messageId);
    setTimeout(() => this.processedIds.delete(messageId), 5 * 60 * 1000);

    this.logger.log(`[SDR] Mensagem de ${phone}: "${text}"`);

    // Referral de anúncio CTWA (só vem na 1ª mensagem do clique) — captura já
    // aqui e preserva no buffer, mesmo que cheguem mais mensagens no debounce.
    const ctwa = extractCtwaReferral(body);

    // Debounce 10s: acumula mensagens antes de processar
    const pending: { timer: NodeJS.Timeout; texts: string[]; ctwa?: CtwaReferral } =
      this.pendingBuffer.get(phone) ?? { timer: null as any, texts: [] };
    pending.texts.push(text);
    if (ctwa.clid && !pending.ctwa?.clid) pending.ctwa = ctwa;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      const combinedText = pending.texts.join('\n');
      const capturedCtwa = pending.ctwa;
      this.pendingBuffer.delete(phone);
      this.processMessage(phone, combinedText, pushName, capturedCtwa).catch((err) =>
        this.logger.error(`[SDR] Erro ao processar ${phone}: ${err.message}`),
      );
    }, 8_000);
    this.pendingBuffer.set(phone, pending);

    return { ok: true };
  }

  /** Encontra o lead testando as variantes com/sem DDI 55 e com/sem o 9 extra (Brasil). */
  private async findLeadByPhoneVariants(phone: string): Promise<Lead | null> {
    const addNine = (n: string) => (n.length === 10 ? `${n.slice(0, 2)}9${n.slice(2)}` : n);
    const removeNine = (n: string) => (n.length === 11 && n[2] === '9' ? `${n.slice(0, 2)}${n.slice(3)}` : n);
    const base = phone.startsWith('55') ? phone.slice(2) : phone;
    const phoneVariants = [`55${base}`, base, `55${addNine(base)}`, addNine(base), `55${removeNine(base)}`, removeNine(base)];

    for (const p of phoneVariants) {
      const lead = await this.leadsService.findByPhone(p);
      if (lead) return lead;
    }
    return null;
  }

  /**
   * Busca nome real de campanha/conjunto/anúncio na Marketing API e atualiza o
   * lead — roda em segundo plano (fire-and-forget), sem bloquear a resposta ao
   * lead nem depender disso pra nada crítico. Só afeta leads de WhatsApp CTWA;
   * o fluxo de LP/site continua resolvendo isso via UTM da própria URL.
   */
  private async enrichAdAttribution(leadId: string, adId: string) {
    try {
      const details = await this.facebookService.getAdDetails(adId);
      if (!details) return;
      const updated = await this.leadsService.update(leadId, {
        utmCampaign: details.campaignName || undefined,
        utmMedium: details.adsetName || undefined,
        utmTerm: details.adsetId || undefined,
        utmContent: adId,
        // Sobrescreve o título genérico do referral (ex: nome da Página) pelo
        // nome real do anúncio no Ads Manager — mais útil pra identificar e agir.
        ctwaAdTitle: details.adName || undefined,
      });
      this.realtime.emitLeadUpdated(updated);
      this.logger.log(`[SDR] Lead ${updated.phone} enriquecido com dados do anúncio: campanha="${details.campaignName}", conjunto="${details.adsetName}"`);
    } catch (err: any) {
      this.logger.warn(`[SDR] Erro ao enriquecer attribution do lead ${leadId}: ${err.message}`);
    }
  }

  /** "opa"/"ok" digitados pelo operador direto no WhatsApp pausam/reativam a IA daquele lead. */
  private async toggleAiByKeyword(phone: string, pause: boolean) {
    const lead = await this.findLeadByPhoneVariants(phone);
    if (!lead) return;
    const updated = await this.leadsService.update(lead.id, { aiPaused: pause });
    this.realtime.emitLeadUpdated(updated);
    this.logger.log(`[SDR] IA ${pause ? 'pausada' : 'reativada'} via palavra-chave para o lead ${updated.phone}`);
  }

  /** Registra no histórico a mensagem que o closer digitou direto no WhatsApp (fora do CRM). */
  private async recordHumanReply(phone: string, text: string) {
    const lead = await this.findLeadByPhoneVariants(phone);
    if (!lead) return;
    const ctx = [...(Array.isArray(lead.aiContext) ? lead.aiContext : []), { role: 'assistant', source: 'operator', content: text }];
    const updated = await this.leadsService.update(lead.id, { aiContext: ctx, waLastMessageAt: new Date() });
    this.realtime.emitLeadUpdated(updated);
    this.logger.log(`[SDR] Resposta manual do closer registrada para o lead ${updated.phone}`);
  }

  private async processMessage(phone: string, text: string, pushName: string, ctwa?: CtwaReferral) {
    let lead: Lead | null = await this.findLeadByPhoneVariants(phone);

    // Lead novo entrando pelo número do SDR → cria card "novo" no Kanban
    let isNew = false;
    if (!lead) {
      const fromAd = Boolean(ctwa?.clid);
      lead = await this.leadsService.create({
        name: pushName || `Lead ${phone.slice(-4)}`,
        phone: phone.startsWith('55') ? phone : `55${phone}`,
        agentMode: 'sdr',
        kanbanStage: 'novo',
        waStage: 'abertura' as WaStage,
        // Origem: anúncio Click-to-WhatsApp quando veio ctwa_clid, senão WhatsApp orgânico
        utmSource: fromAd ? 'ctwa' : 'whatsapp',
        utmMedium: fromAd ? 'whatsapp-ad' : 'sdr',
        // Nome do anúncio vira utm_campaign quando disponível — aparece direto no
        // Kanban/relatórios sem precisar abrir o Ads Manager.
        utmCampaign: fromAd ? (ctwa?.adTitle ?? ctwa?.sourceId ?? undefined) : undefined,
        ctwaClid: ctwa?.clid,
        ctwaSourceUrl: ctwa?.sourceUrl,
        ctwaSourceId: ctwa?.sourceId,
        ctwaAdTitle: ctwa?.adTitle,
      });
      isNew = true;
      if (fromAd) {
        this.logger.log(`[SDR] Lead ${phone} veio de anúncio CTWA (ctwa_clid=${ctwa!.clid}, ad="${ctwa?.adTitle ?? ctwa?.sourceId ?? '?'}")`);
        // Enriquece com nome real de campanha/conjunto/anúncio via Marketing API,
        // em segundo plano — não atrasa a resposta ao lead. Só roda se tiver o
        // Ad ID (sourceId) e o FB_ADS_TOKEN configurado.
        if (ctwa?.sourceId) this.enrichAdAttribution(lead.id, ctwa.sourceId);
      }
      this.realtime.emitLeadCreated(lead);
    } else if (lead.agentMode !== 'sdr') {
      // Lead já existia (ex.: veio de outro fluxo) — passa a ser do SDR
      lead = await this.leadsService.update(lead.id, { agentMode: 'sdr' });
    }

    // Encerrado por handoff: bloqueia a IA, a menos que o operador tenha reativado via switch.
    // Mesmo sem a IA responder, a mensagem do lead precisa ser salva — antes era
    // descartada aqui, apagando a conversa do closer com o lead do histórico.
    if (lead.waStage === 'encerrado' && lead.aiPaused !== false) {
      const ctx = [...(Array.isArray(lead.aiContext) ? lead.aiContext : []), { role: 'user', content: text }];
      lead = await this.leadsService.update(lead.id, { aiContext: ctx, waLastMessageAt: new Date() });
      this.realtime.emitLeadUpdated(lead);
      this.logger.log(`[SDR] Lead ${phone} encerrado — closer assumiu, mensagem registrada sem resposta automática`);
      return;
    }

    // IA pausada: humano assumiu. Registra a mensagem recebida mas não responde.
    if (lead.aiPaused) {
      const ctx = [...(Array.isArray(lead.aiContext) ? lead.aiContext : []), { role: 'user', content: text }];
      lead = await this.leadsService.update(lead.id, { aiContext: ctx, waLastMessageAt: new Date() });
      this.realtime.emitLeadUpdated(lead);
      this.logger.log(`[SDR] Lead ${phone} com IA pausada — mensagem registrada, sem resposta`);
      return;
    }

    await this.sendTyping(phone, 2000);

    // Processa com IA (1 retry se falhar)
    let ai = await this.sdrService.processMessage(lead, text);
    if (!ai.success) {
      await new Promise((r) => setTimeout(r, 2000));
      ai = await this.sdrService.processMessage(lead, text);
    }

    // Loop: a IA respondeu a mesma coisa 3 vezes seguidas (não avança a conversa).
    // Pausa imediatamente em vez de mandar a msg repetida de novo — evita ficar
    // martelando o lead e avisa o operador assumir manualmente.
    if (this.isLoopReply(lead, ai.reply)) {
      this.logger.warn(`[SDR] Loop detectado para ${phone} — IA pausada automaticamente`);
      const ctx = [...(Array.isArray(lead.aiContext) ? lead.aiContext : []), { role: 'user', content: text }];
      lead = await this.leadsService.update(lead.id, { aiContext: ctx, waLastMessageAt: new Date(), aiPaused: true });
      this.realtime.emitLeadUpdated(lead);
      await this.notifyOperatorLoop(lead);
      return;
    }

    // Guarda o histórico com "|||" trocado por quebra de linha: o marcador é só
    // uma instrução de envio (2 bolhas de WhatsApp), não deve aparecer literal
    // nem no modal de conversa do CRM nem no contexto que a própria IA relê.
    const contextReply = (ai.reply ?? '').replace(/\|\|\|/g, '\n');
    const updatedContext = this.sdrService.buildUpdatedContext(lead, text, contextReply);

    // Os 3 sinais da qualificação são persistidos: o sistema guarda o que já foi
    // respondido, então só sobrescreve quando a IA manda algo novo nesta mensagem
    // (senão mantém o valor já salvo — a IA não precisa repetir a cada turno).
    const vendeCabelo = ai.vendeCabelo === true || ai.vendeCabelo === false ? ai.vendeCabelo : lead.vendeCabelo ?? null;
    const mensagensPorDia = typeof ai.mensagensPorDia === 'number' ? ai.mensagensPorDia : lead.mensagensPorDia ?? null;
    const semInstagram = ai.semInstagram === true ? true : lead.semInstagram ?? null;
    const instagramValue = ai.instagram && typeof ai.instagram === 'string' && ai.instagram !== 'null'
      ? ai.instagram.replace('@', '').trim()
      : lead.instagram;
    const nomeValue = ai.nome && typeof ai.nome === 'string' && ai.nome !== 'null' ? ai.nome.trim() : null;

    // Raia calculada (a "verdade" da qualificação): vende cabelo = qualificado.
    const derivedStage = deriveKanbanStage(vendeCabelo, ai.stage, lead.status);

    // Handoff pro especialista só acontece depois das respostas completas
    // (vende cabelo=true + volume de mensagens/dia conhecido + instagram
    // conhecido ou confirmado que não tem) — e só dispara uma vez.
    const instagramKnown = Boolean(instagramValue) || semInstagram === true;
    const mensagensPorDiaKnown = typeof mensagensPorDia === 'number';
    const readyForHandoff = vendeCabelo === true && mensagensPorDiaKnown && instagramKnown;
    const alreadyHandedOff = lead.waStage === 'encerrado';
    const handoff = readyForHandoff && !alreadyHandedOff;

    // Estágio terminal quando faz handoff
    const newStage: SdrStage = handoff ? 'encerrado' : ai.stage;

    const updateData: any = {
      aiContext: updatedContext,
      waStage: newStage as any,
      temperature: ai.temperature,
      waLastMessageAt: new Date(),
      followupSentAt: null,
      vendeCabelo,
      mensagensPorDia,
      semInstagram,
    };

    if (instagramValue) updateData.instagram = instagramValue;
    if (nomeValue) updateData.name = nomeValue;
    const isNewInstagram = Boolean(instagramValue && !lead.instagram);

    // Handoff → operador assume, IA desliga
    if (handoff) {
      updateData.aiPaused = true;
    }

    // Não qualificado (não vende cabelo) → IA desliga automaticamente
    if (vendeCabelo === false) {
      updateData.aiPaused = true;
    }

    // Só atualiza a raia se o operador NÃO travou o card manualmente
    if (!lead.kanbanStageManual) {
      updateData.kanbanStage = derivedStage;
    }

    // Entrou em "atendimento" (lead respondeu, conversa em andamento) → evento
    // "Lead" pro Meta, uma única vez. Também dispara se o lead pular direto pra
    // "qualificado" numa tacada só, garantindo que o Lead sempre preceda o MQL
    // (senão o funil no Meta ficaria com MQL sem Lead correspondente).
    const inService = derivedStage === 'atendimento';
    const qualified = derivedStage === 'qualificado';
    if ((inService || qualified) && !lead.leadEventSent) {
      updateData.leadEventSent = true;
      this.facebookService
        .sendLeadEvent({ ...lead, leadEventSent: true }, { fbp: lead.fbp, fbc: lead.fbc })
        .catch((err) => this.logger.error(`[SDR] Erro ao enviar Lead ao Meta: ${err.message}`));
      this.logger.log(`[SDR] Lead ${phone} entrou em atendimento — evento Lead enviado ao Meta`);
    }

    // Vende cabelo = sim → MQL: marca e dispara evento pro Meta (uma única vez).
    // Independe de investir em anúncio — isso só soma a tag premium abaixo.
    if (vendeCabelo === true && !lead.isMql) {
      updateData.isMql = true;
      updateData.qualifiedAt = new Date();
      this.facebookService
        .sendMqlEvent({ ...lead, isMql: true }, { fbp: lead.fbp, fbc: lead.fbc })
        .catch((err) => this.logger.error(`[SDR] Erro ao enviar MQL ao Meta: ${err.message}`));
      this.logger.log(`[SDR] Lead ${phone} vende cabelo (MQL) — evento enviado ao Meta`);
    }

    // Volume de mensagens/dia define premium (>=30) vs básico (<30) — mesma
    // raia "qualificado", sem evento novo pro Meta, só diferencia visualmente
    // quem tem mais volume. Remove a tag oposta se o lead corrigir a resposta.
    const existingTags = lead.tags || [];
    if (typeof mensagensPorDia === 'number') {
      const tag = mensagensPorDia >= 30 ? 'mql_premium' : 'mql_basico';
      const otherTag = mensagensPorDia >= 30 ? 'mql_basico' : 'mql_premium';
      const withoutOther = existingTags.filter((t) => t !== otherTag);
      if (!withoutOther.includes(tag)) {
        updateData.tags = [...withoutOther, tag];
        this.logger.log(`[SDR] Lead ${phone} tem ${mensagensPorDia} msgs/dia — tag ${tag} adicionada`);
      } else if (withoutOther.length !== existingTags.length) {
        updateData.tags = withoutOther;
      }
    }

    lead = await this.leadsService.update(lead.id, updateData);

    // Instagram informado pela 1ª vez → busca dados reais (Apify) + análise
    // IA em segundo plano, pra alimentar a página "Instagram Leads". skipMessage
    // porque a Sofia já está conversando com o lead — não manda outra mensagem.
    // Roda só depois do update acima pra evitar buscar o lead sem o Instagram salvo ainda.
    if (isNewInstagram) {
      this.enrichmentService.enrichLeadFromInstagram(lead.id, { skipMessage: true }).catch((err) =>
        this.logger.warn(`[SDR] Erro ao enriquecer Instagram do lead ${phone}: ${err.message}`),
      );
    }

    if (ai.reply) await this.sendReplyAsBubbles(phone, ai.reply);

    // Handoff: avisa o closer e destaca o card
    if (handoff) {
      await this.notifyOperator(lead);
      this.realtime.emitLeadHandoff(lead);
    } else {
      this.realtime.emitLeadUpdated(lead);
    }
  }

  /** Normaliza texto pra comparação de loop: minúsculo, sem acento/pontuação, espaços colapsados. */
  private normalizeForLoop(text: string): string {
    return (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Detecta loop quando a nova resposta da IA repete (~igual) as 2 últimas
   * respostas dela mesma nesse lead — sinal de conversa travada, não repetição
   * legítima (ex.: confirmação curta tipo "certo!" só 1-2x não conta).
   */
  private isLoopReply(lead: Lead, newReply?: string): boolean {
    const newNorm = this.normalizeForLoop(newReply || '');
    if (!newNorm || newNorm.length < 8) return false;
    const priorContext = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    const priorAssistant = priorContext
      .filter((m: any) => m?.role === 'assistant' && m?.content)
      .slice(-2)
      .map((m: any) => this.normalizeForLoop(m.content));
    return priorAssistant.length === 2 && priorAssistant.every((t) => t === newNorm);
  }

  /** Avisa o operador que a IA travou num loop e foi pausada automaticamente. */
  private async notifyOperatorLoop(lead: Lead) {
    const stored = await this.settings.get(SDR_NOTIFY_PHONES_KEY);
    const phones: string[] = stored
      ? stored.split(',').map((p) => p.trim()).filter(Boolean)
      : this.operatorPhone ? [this.operatorPhone] : [];

    if (phones.length === 0) return;

    const msg = `⚠️ Loop detectado — IA pausada automaticamente!\n\nNome: ${lead.name}\nWhatsApp: ${lead.phone}\n\nA IA ficou repetindo a mesma resposta. Assuma a conversa manualmente.`;

    await Promise.allSettled(
      phones.map((phone) =>
        firstValueFrom(
          this.http.post(
            `${this.uazapiBaseUrl}/send/text`,
            { number: phone, text: msg },
            { headers: { token: this.uazapiToken } },
          ),
        ).catch((err: any) => this.logger.error(`[SDR] Erro ao notificar loop ${phone}: ${err.message}`)),
      ),
    );
  }

  private async notifyOperator(lead: Lead) {
    // Resolve phones: banco tem prioridade, env var é fallback para o primeiro
    const stored = await this.settings.get(SDR_NOTIFY_PHONES_KEY);
    const phones: string[] = stored
      ? stored.split(',').map((p) => p.trim()).filter(Boolean)
      : this.operatorPhone ? [this.operatorPhone] : [];

    if (phones.length === 0) return;

    const isPremium = (lead.tags || []).includes('mql_premium');
    const msg = `${isPremium ? '🔥🔥 Lead MQL PREMIUM' : '🔥 Lead qualificado'} pelo SDR!\n\nNome: ${lead.name}\nWhatsApp: ${lead.phone}${lead.instagram ? `\nInstagram: @${lead.instagram.replace('@', '')}` : '\nInstagram: não tem'}${isPremium ? '\nJá investe em anúncio: sim' : ''}${lead.revenueRange ? `\nFaturamento: ${lead.revenueRange}` : ''}\n\nAssuma a conversa.`;

    await Promise.allSettled(
      phones.map((phone) =>
        firstValueFrom(
          this.http.post(
            `${this.uazapiBaseUrl}/send/text`,
            { number: phone, text: msg },
            { headers: { token: this.uazapiToken } },
          ),
        ).catch((err: any) => this.logger.error(`[SDR] Erro ao notificar ${phone}: ${err.message}`)),
      ),
    );
  }

  private async sendMessage(phone: string, text: string) {
    try {
      const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`;
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/send/text`,
          { number: normalizedPhone, text },
          { headers: { token: this.uazapiToken } },
        ),
      );
      this.logger.log(`[SDR] respondeu para ${phone}`);
    } catch (err: any) {
      this.logger.error(`[SDR] Erro ao enviar resposta para ${phone}: ${err.message}`);
    }
  }

  /**
   * A IA pode separar a resposta em mais de uma "bolha" do WhatsApp usando "|||"
   * como marcador (ex.: saudação numa bolha, pergunta na próxima) — imita alguém
   * mandando duas mensagens seguidas em vez de um bloco só de texto.
   */
  private splitBubbles(reply: string): string[] {
    return reply
      .split('|||')
      .map((b) => b.trim())
      .filter(Boolean);
  }

  /**
   * Tempo de "digitação" proporcional ao tamanho do texto, simulando o quanto um
   * humano levaria pra escrever aquilo (~45 caracteres/segundo), com piso e teto
   * pra não parecer instantâneo nem travar demais numa resposta longa.
   */
  private typingDelayForText(text: string): number {
    const perCharMs = 1000 / 45;
    return Math.min(8000, Math.max(1200, Math.round(text.length * perCharMs)));
  }

  /** Envia a resposta da IA em uma ou mais bolhas, cada uma com "digitando..." proporcional ao tamanho do texto. */
  private async sendReplyAsBubbles(phone: string, reply: string) {
    const bubbles = this.splitBubbles(reply);
    for (const bubble of bubbles) {
      const delay = this.typingDelayForText(bubble);
      await this.sendTyping(phone, delay);
      await new Promise((r) => setTimeout(r, delay));
      await this.sendMessage(phone, bubble);
    }
  }

  private async sendTyping(phone: string, durationMs: number) {
    try {
      const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`;
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/message/presence`,
          { number: normalizedPhone, presence: 'composing', delay: durationMs },
          { headers: { token: this.uazapiToken } },
        ),
      );
    } catch {
      // typing indicator não é crítico
    }
  }
}
