import { Controller, Post, Body, Logger, Param } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SdrService, deriveKanbanStage, SdrStage } from './sdr.service';
import { LeadsService } from '../leads/leads.service';
import { FacebookService } from '../facebook/facebook.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Lead, WaStage } from '../common/entities/lead.entity';

/**
 * Webhook do agente SDR — instância/número uazapi SEPARADO do Efraim.
 * Recebe mensagens de leads novos, qualifica via IA e move os cards do Kanban.
 */
@Controller('webhooks')
export class SdrController {
  private readonly logger = new Logger(SdrController.name);
  private readonly processedIds = new Set<string>();
  private readonly pendingBuffer = new Map<string, { timer: NodeJS.Timeout; texts: string[] }>();
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

    // Debounce 10s: acumula mensagens antes de processar
    const pending = this.pendingBuffer.get(phone) ?? { timer: null as any, texts: [] as string[] };
    pending.texts.push(text);
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      const combinedText = pending.texts.join('\n');
      this.pendingBuffer.delete(phone);
      this.processMessage(phone, combinedText, pushName).catch((err) =>
        this.logger.error(`[SDR] Erro ao processar ${phone}: ${err.message}`),
      );
    }, 10_000);
    this.pendingBuffer.set(phone, pending);

    return { ok: true };
  }

  private async processMessage(phone: string, text: string, pushName: string) {
    // Normaliza variantes com/sem DDI 55 e com/sem o 9 extra (Brasil)
    const addNine = (n: string) => (n.length === 10 ? `${n.slice(0, 2)}9${n.slice(2)}` : n);
    const removeNine = (n: string) => (n.length === 11 && n[2] === '9' ? `${n.slice(0, 2)}${n.slice(3)}` : n);
    const base = phone.startsWith('55') ? phone.slice(2) : phone;
    const phoneVariants = [`55${base}`, base, `55${addNine(base)}`, addNine(base), `55${removeNine(base)}`, removeNine(base)];

    let lead: Lead | null = null;
    for (const p of phoneVariants) {
      lead = await this.leadsService.findByPhone(p);
      if (lead) break;
    }

    // Lead novo entrando pelo número do SDR → cria card "novo" no Kanban
    let isNew = false;
    if (!lead) {
      lead = await this.leadsService.create({
        name: pushName || `Lead ${phone.slice(-4)}`,
        phone: phone.startsWith('55') ? phone : `55${phone}`,
        agentMode: 'sdr',
        kanbanStage: 'novo',
        waStage: 'abertura' as WaStage,
        utmSource: 'whatsapp',
        utmMedium: 'sdr',
      });
      isNew = true;
      this.realtime.emitLeadCreated(lead);
    } else if (lead.agentMode !== 'sdr') {
      // Lead já existia (ex.: veio de outro fluxo) — passa a ser do SDR
      lead = await this.leadsService.update(lead.id, { agentMode: 'sdr' });
    }

    // Encerrado por handoff: bloqueia a IA, a menos que o operador tenha reativado via switch
    if (lead.waStage === 'encerrado' && lead.aiPaused !== false) {
      this.logger.log(`[SDR] Lead ${phone} encerrado — closer assumiu, sem resposta automática`);
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

    const updatedContext = this.sdrService.buildUpdatedContext(lead, text, ai.reply);

    // Estágio terminal quando faz handoff
    const newStage: SdrStage = ai.handoff ? 'encerrado' : ai.stage;

    // Raia calculada (a "verdade" da qualificação): lead na raia quente = qualificado
    const derivedStage = deriveKanbanStage(ai.stage, ai.temperature, lead.isMql, lead.status, lead.kanbanStage);

    const updateData: any = {
      aiContext: updatedContext,
      waStage: newStage as any,
      temperature: ai.temperature,
      waLastMessageAt: new Date(),
      followupSentAt: null, // lead respondeu → reseta o ciclo de follow-up
    };

    // Handoff → operador assume, IA desliga
    if (ai.handoff) {
      updateData.aiPaused = true;
    }

    // Não qualificado (frio) → IA desliga automaticamente
    if (ai.stage === 'frio') {
      updateData.aiPaused = true;
    }

    // Só atualiza a raia se o operador NÃO travou o card manualmente
    if (!lead.kanbanStageManual) {
      updateData.kanbanStage = derivedStage;
    }

    // Qualificou (caiu na raia quente) → MQL: marca e dispara evento pro Meta (uma única vez)
    const qualified = derivedStage === 'qualificado';
    if (qualified && !lead.isMql) {
      updateData.isMql = true;
      this.facebookService
        .sendMqlEvent({ ...lead, isMql: true }, { fbp: lead.fbp, fbc: lead.fbc })
        .catch((err) => this.logger.error(`[SDR] Erro ao enviar MQL ao Meta: ${err.message}`));
      this.logger.log(`[SDR] Lead ${phone} qualificado (MQL) — evento enviado ao Meta`);
    }

    lead = await this.leadsService.update(lead.id, updateData);

    if (ai.reply) await this.sendMessage(phone, ai.reply);

    // Handoff: avisa o closer e destaca o card
    if (ai.handoff) {
      await this.notifyOperator(lead);
      this.realtime.emitLeadHandoff(lead);
    } else {
      this.realtime.emitLeadUpdated(lead);
    }
  }

  private async notifyOperator(lead: Lead) {
    if (!this.operatorPhone) return;
    const msg = `🔥 Lead qualificado pelo SDR!\n\nNome: ${lead.name}\nWhatsApp: ${lead.phone}${lead.instagram ? `\nInstagram: @${lead.instagram.replace('@', '')}` : ''}${lead.revenueRange ? `\nFaturamento: ${lead.revenueRange}` : ''}\n\nAssuma a conversa.`;
    try {
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/send/text`,
          { number: this.operatorPhone, text: msg },
          { headers: { token: this.uazapiToken } },
        ),
      );
    } catch (err: any) {
      this.logger.error(`[SDR] Erro ao avisar operador: ${err.message}`);
    }
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
