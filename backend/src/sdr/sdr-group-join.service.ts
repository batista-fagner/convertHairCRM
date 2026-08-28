import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { LeadsService } from '../leads/leads.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

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

    const lead = await this.findLeadByPhoneVariants(phone);
    if (!lead) {
      this.logger.log(`[GROUP-JOIN-CRM] ${phone} entrou no grupo mas não é um lead conhecido — ignorado`);
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
