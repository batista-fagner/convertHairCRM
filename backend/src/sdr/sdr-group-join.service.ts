import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { LeadsService } from '../leads/leads.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { FacebookService } from '../facebook/facebook.service';
import { TrackingService } from '../tracking/tracking.service';
import { QuizService } from '../quiz/quiz.service';
import { Lead } from '../common/entities/lead.entity';

const JOIN_TAG = 'entrou_no_grupo';

// Escuta o SSE do uazapi (events=groups) na instância do CRM (SDR_UAZAPI_TOKEN,
// "Lucas - CRM - CONVERT HAIR" — o número que atende os leads de mega hair, não
// confundir com o UAZAPI_TOKEN do Efraim, que é outro produto/funil). Ao detectar
// alguém entrando em QUALQUER grupo dessa instância, marca a tag "entrou_no_grupo"
// se o telefone já for um lead conhecido — não cria lead novo, não manda mensagem.
// Objetivo: saber quem das raias "novo lead"/"em atendimento" já entrou no grupo
// do Workshop antes de disparar follow-up pra quem ainda não entrou.
//
// ⚠️ Não filtra por qual grupo — se essa instância estiver em mais de um grupo
// (grupo de admin, outro grupo de cliente etc.), entradas nesses outros grupos
// também marcariam a tag. Se isso virar problema, o payload do evento (logado
// abaixo) tem os campos pra filtrar por group JID — ver handleEvent().
@Injectable()
export class SdrGroupJoinService implements OnModuleInit {
  private readonly logger = new Logger(SdrGroupJoinService.name);
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;
  private reconnecting = false;
  private readonly recentJoins = new Set<string>();
  private readonly recentLeaves = new Set<string>();
  private reconnectDelayMs = 5000;
  private readonly MAX_RECONNECT_DELAY_MS = 60_000;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly leadsService: LeadsService,
    private readonly realtime: RealtimeGateway,
    private readonly facebookService: FacebookService,
    private readonly trackingService: TrackingService,
    private readonly quizService: QuizService,
  ) {
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || 'https://free.uazapi.com';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
  }

  onModuleInit() {
    if (!this.uazapiToken) {
      this.logger.warn('SDR_UAZAPI_TOKEN não configurado — SSE de grupo (CRM) não iniciado');
      return;
    }
    if (this.config.get('DISABLE_SDR_GROUP_JOIN_SSE') === 'true') {
      this.logger.warn('DISABLE_SDR_GROUP_JOIN_SSE=true — SSE de grupo (CRM) desativado neste ambiente');
      return;
    }
    this.connect();
  }

  private async connect() {
    const url = `${this.uazapiBaseUrl}/sse?token=${this.uazapiToken}&events=groups`;
    try {
      const response = await firstValueFrom(
        this.http.get(url, { responseType: 'stream', timeout: 0 }),
      );
      this.logger.log('SSE de grupos (CRM) conectado ao uazapi');

      const stream = response.data as NodeJS.ReadableStream;
      let buffer = '';

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line.startsWith('data:')) {
            const json = line.slice(5).trim();
            if (json) this.handleEvent(json);
          }
        }
      });

      stream.on('end', () => {
        this.logger.warn('SSE de grupos (CRM) encerrado — reconectando...');
        this.scheduleReconnect();
      });
      stream.on('error', (err: Error) => {
        this.logger.error(`SSE de grupos (CRM) erro: ${err.message}`);
        this.scheduleReconnect();
      });
    } catch (err: any) {
      this.logger.error(`Falha ao conectar SSE de grupos (CRM): ${err.message}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    const delay = this.reconnectDelayMs;
    this.logger.warn(`[SSE-CRM] Reconectando em ${delay / 1000}s...`);
    setTimeout(() => {
      this.reconnecting = false;
      this.connect();
    }, delay);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.MAX_RECONNECT_DELAY_MS);
  }

  private handleEvent(json: string) {
    this.reconnectDelayMs = 5000;

    let evt: any;
    try {
      evt = JSON.parse(json);
    } catch {
      return;
    }
    if (evt.EventType !== 'groups') return;

    const joins = evt.event?.Join;
    const leaves = evt.event?.Leave;
    if ((!Array.isArray(joins) || joins.length === 0) && (!Array.isArray(leaves) || leaves.length === 0)) return;

    // Log do payload cru na primeira vez de cada lote — insumo pra decidir se
    // precisa filtrar por grupo específico (ver aviso no topo do arquivo).
    this.logger.debug(`[GROUP-JOIN-CRM] Evento bruto: ${JSON.stringify(evt.event).slice(0, 500)}`);

    for (const jid of Array.isArray(joins) ? joins : []) {
      const phone = String(jid).split('@')[0].replace(/\D/g, '');
      if (!phone) continue;
      this.handleJoin(phone).catch((err) =>
        this.logger.error(`Erro ao processar entrada no grupo (CRM, ${phone}): ${err.message}`),
      );
    }

    for (const jid of Array.isArray(leaves) ? leaves : []) {
      const phone = String(jid).split('@')[0].replace(/\D/g, '');
      if (!phone) continue;
      this.handleLeave(phone).catch((err) =>
        this.logger.error(`Erro ao processar saída do grupo (CRM, ${phone}): ${err.message}`),
      );
    }
  }

  private async handleJoin(phone: string) {
    const dedupKey = phone;
    if (this.recentJoins.has(dedupKey)) return;
    this.recentJoins.add(dedupKey);
    setTimeout(() => this.recentJoins.delete(dedupKey), 30_000);

    let lead = await this.findLeadByPhoneVariants(phone);
    if (!lead) {
      // Consome o clique mais antigo da fila (TrackingService) — só cria lead
      // novo se existir um clique de verdade esperando (quiz ou LP), pra não
      // criar lead pra qualquer pessoa aleatória que entra no grupo sem ter
      // passado pelo funil. Ver aviso no topo do arquivo sobre a fila ser
      // FIFO por ordem, não por identidade.
      const utm = await this.trackingService.consumeNextUtm();
      if (!utm) {
        this.logger.log(`[GROUP-JOIN-CRM] ${phone} entrou no grupo mas não é um lead conhecido e não há clique pendente — ignorado`);
        return;
      }
      const cameFromQuiz = Boolean(utm.quizSlug);
      const waName = await this.fetchContactName(phone);
      const leadName = waName || 'Novo Lead';

      lead = await this.leadsService.create({
        name: leadName,
        phone,
        agentMode: 'sdr',
        kanbanStage: 'novo',
        waStage: cameFromQuiz ? undefined : ('abertura' as any),
        status: 'novo',
        score: 0,
        utmSource: utm.utmSource,
        utmMedium: utm.utmMedium,
        utmCampaign: utm.utmCampaign,
        utmContent: utm.utmContent,
        utmTerm: utm.utmTerm,
        fbclid: utm.fbclid,
        fbc: utm.fbc,
        fbp: utm.fbp,
        clickId: utm.clickId,
        quizSlug: utm.quizSlug,
        quizResponses: utm.quizResponses,
        quizMqlEvents: utm.quizMqlEvents,
        isMql: Boolean(utm.quizMqlEvents?.length),
        tags: [JOIN_TAG],
        groupJoinedAt: new Date(),
        aiPaused: cameFromQuiz,
      });
      this.realtime.emitLeadCreated(lead);

      this.facebookService.sendLeadEvent(lead, { fbp: lead.fbp, fbc: lead.fbc }).catch((err) =>
        this.logger.error(`Erro ao enviar Lead event ao Facebook: ${err.message}`),
      );

      if (cameFromQuiz) {
        await this.sendQuizWelcomeMessage(lead, phone, leadName, utm.quizSlug);
      }

      this.logger.log(`[GROUP-JOIN-CRM] Novo lead ${lead.id} (${phone}) criado ao entrar no grupo${cameFromQuiz ? ` via quiz "${utm.quizSlug}"` : ''}`);
      return;
    }

    const tags = lead.tags || [];
    if (tags.includes(JOIN_TAG)) {
      // Reentrada depois de ter saído — limpa o "saiu do grupo" (senão a tela
      // continua sinalizando em vermelho alguém que já voltou).
      if (lead.groupLeftAt) {
        const updated = await this.leadsService.update(lead.id, { groupLeftAt: null });
        this.realtime.emitLeadUpdated(updated);
        this.logger.log(`[GROUP-JOIN-CRM] Lead ${lead.id} (${phone}) reentrou no grupo — "saiu do grupo" limpo`);
      } else {
        this.logger.debug(`[GROUP-JOIN-CRM] Lead ${lead.id} (${phone}) já tinha a tag ${JOIN_TAG}`);
      }
      return;
    }

    const updated = await this.leadsService.update(lead.id, { tags: [...tags, JOIN_TAG], groupJoinedAt: new Date() });
    this.realtime.emitLeadUpdated(updated);
    this.logger.log(`[GROUP-JOIN-CRM] Lead ${lead.id} (${phone}, isMql=${lead.isMql}) marcado como "${JOIN_TAG}"`);
  }

  private async handleLeave(phone: string) {
    const dedupKey = `leave:${phone}`;
    if (this.recentLeaves.has(dedupKey)) return;
    this.recentLeaves.add(dedupKey);
    setTimeout(() => this.recentLeaves.delete(dedupKey), 30_000);

    const lead = await this.findLeadByPhoneVariants(phone);
    if (!lead) {
      this.logger.log(`[GROUP-JOIN-CRM] ${phone} saiu do grupo mas não é um lead conhecido — ignorado`);
      return;
    }

    const updated = await this.leadsService.update(lead.id, { groupLeftAt: new Date() });
    this.realtime.emitLeadUpdated(updated);
    this.logger.log(`[GROUP-JOIN-CRM] Lead ${lead.id} (${phone}) marcado como "saiu do grupo"`);
  }

  /** Busca o nome do contato no WhatsApp via uazapi /contacts/info (instância SDR/CRM). */
  private async fetchContactName(phone: string): Promise<string | null> {
    try {
      const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`;
      const res = await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/contacts/info`,
          { number: normalizedPhone },
          { headers: { token: this.uazapiToken } },
        ),
      );
      const data = res.data as any;
      const name: string = data?.name || data?.pushName || data?.notify || '';
      if (!name || name === normalizedPhone || name === phone) return null;
      return name.trim();
    } catch (err: any) {
      this.logger.warn(`[GROUP-JOIN-CRM] Não foi possível buscar nome do contato ${phone}: ${err.message}`);
      return null;
    }
  }

  private async sendMessage(phone: string, text: string): Promise<void> {
    try {
      const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`;
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/send/text`,
          { number: normalizedPhone, text },
          { headers: { token: this.uazapiToken } },
        ),
      );
    } catch (err: any) {
      this.logger.error(`[GROUP-JOIN-CRM] Erro ao enviar mensagem para ${phone}: ${err.message}`);
    }
  }

  /**
   * Mensagem individual pro lead que veio de um quiz — configurada por quiz
   * (Quiz.welcomeMessageVariants / welcomeMessageTemplate), com placeholders
   * {nome} e {resposta_1}..{resposta_6} substituídos pelas respostas reais.
   * Sem template configurado (padrão nem variante), não envia nada.
   */
  private async sendQuizWelcomeMessage(lead: Lead, phone: string, leadName: string, quizSlug?: string | null) {
    if (!quizSlug) return;
    const responses = lead.quizResponses || [];
    let template: string | null | undefined;
    try {
      const quiz = await this.quizService.findBySlug(quizSlug);
      const variant = (quiz.welcomeMessageVariants || []).find(
        (v) => responses[v.questionIndex - 1]?.answer === v.optionLabel,
      );
      template = variant?.template ?? quiz.welcomeMessageTemplate;
    } catch (err: any) {
      this.logger.warn(`[GROUP-JOIN-CRM] Não foi possível carregar quiz "${quizSlug}" pra montar mensagem de boas-vindas: ${err.message}`);
      return;
    }
    if (!template?.trim()) return;

    const firstName = leadName.split(' ')[0];
    const message = template
      .replace(/\{nome\}/gi, firstName)
      .replace(/\{resposta_(\d+)\}/gi, (_match, idx) => responses[parseInt(idx, 10) - 1]?.answer ?? '');

    await this.sendMessage(phone, message);
    const updated = await this.leadsService.update(lead.id, {
      aiContext: [{ role: 'assistant', content: message }],
      waLastMessageAt: new Date(),
    });
    this.realtime.emitLeadUpdated(updated);
  }

  private async findLeadByPhoneVariants(phone: string) {
    const addNine = (n: string) => (n.length === 10 ? `${n.slice(0, 2)}9${n.slice(2)}` : n);
    const removeNine = (n: string) =>
      n.length === 11 && n[2] === '9' ? `${n.slice(0, 2)}${n.slice(3)}` : n;
    const base = phone.startsWith('55') ? phone.slice(2) : phone;
    const variants = [
      `55${base}`,
      base,
      `55${addNine(base)}`,
      addNine(base),
      `55${removeNine(base)}`,
      removeNine(base),
    ];
    for (const p of variants) {
      const lead = await this.leadsService.findByPhone(p);
      if (lead) return lead;
    }
    return null;
  }
}
