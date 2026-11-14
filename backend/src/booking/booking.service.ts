import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../common/entities/lead.entity';
import { AgendaService } from '../agenda/agenda.service';
import { SettingsService, MEETING_NOTIFY_PHONES_KEY } from '../settings/settings.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { addDays, brt, formatSlotHuman, WEEKDAYS } from '../common/brt.util';
import { phoneWithoutDdi } from '../common/phone-display.util';
import { formatQuizAnswers } from '../common/quiz-answers.util';

/**
 * Agendamento público (página /q/:slug/agendar do ConvertHairPage) — substitui
 * o Calendly no fim do quiz. Os horários são os da agenda interna (/agenda);
 * marcar grava `leads.meeting_at`, que já tira o horário da agenda pra todo
 * mundo (página, Efraim e SDR).
 */
@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    private readonly agenda: AgendaService,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeGateway,
    private readonly config: ConfigService,
  ) {}

  /** Dias com horário livre. Só o necessário pra página: nada de dado de lead. */
  async slots() {
    const days = await this.agenda.availableDays(new Date());
    return {
      days: days.map((d) => ({
        ymd: d.ymd,
        weekday: d.weekday,
        slots: d.slots.map((s) => ({ at: s.at.toISOString(), hour: s.hour })),
      })),
    };
  }

  /** Reunião que o lead já tem (pra página abrir direto na confirmação). */
  async current(leadId: string) {
    const lead = await this.findLead(leadId);
    const at = lead?.meetingAt ? new Date(lead.meetingAt) : null;
    return { meetingAt: at && at.getTime() > Date.now() ? at.toISOString() : null, name: lead?.name ?? null };
  }

  async book(body: { leadId?: string; name?: string; phone?: string; at?: string }) {
    const at = new Date(String(body?.at || ''));
    if (isNaN(at.getTime())) throw new BadRequestException('Horário inválido');

    let lead = await this.findLead(body.leadId);
    if (!lead) lead = await this.findOrCreateByPhone(body.name, body.phone);

    const previous = lead.meetingAt ? new Date(lead.meetingAt) : null;
    if (previous?.getTime() === at.getTime()) return { ok: true, meetingAt: at.toISOString() };

    const problem = await this.agenda.checkSlot(at);
    if (problem) throw new ConflictException('Esse horário acabou de ser reservado. Escolha outro.');

    await this.leadsRepo.update(lead.id, { meetingAt: at, efraimFollowupAt: null as any });

    // Duas pessoas confirmando o mesmo horário ao mesmo tempo: quem gravou
    // por último devolve o horário e escolhe outro.
    const sameSlot = await this.leadsRepo.find({ where: { meetingAt: at }, select: ['id', 'updatedAt'], order: { updatedAt: 'ASC' } });
    if (sameSlot.length > 1 && sameSlot[0].id !== lead.id) {
      await this.leadsRepo.update(lead.id, { meetingAt: previous as any });
      throw new ConflictException('Esse horário acabou de ser reservado. Escolha outro.');
    }

    const updated = await this.leadsRepo.findOne({ where: { id: lead.id } });
    if (updated) this.realtime.emitLeadUpdated(updated);
    this.logger.log(`[Agendamento] ${lead.phone} marcou ${at.toISOString()} pela página`);
    this.notify(updated ?? lead, at, previous).catch((err) => this.logger.error(`[Agendamento] Falha no aviso: ${err.message}`));
    this.confirmToLead(updated ?? lead, at).catch((err) => this.logger.error(`[Agendamento] Falha na confirmação ao lead: ${err.message}`));
    return { ok: true, meetingAt: at.toISOString() };
  }

  private async findLead(leadId?: string): Promise<Lead | null> {
    if (!leadId || !/^[0-9a-f-]{36}$/i.test(leadId)) return null;
    return this.leadsRepo.findOne({ where: { id: leadId } });
  }

  /** Quem abriu a página sem passar pelo quiz informa nome e WhatsApp. */
  private async findOrCreateByPhone(name?: string, rawPhone?: string): Promise<Lead> {
    let phone = String(rawPhone || '').replace(/\D/g, '');
    if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
    if (phone.length < 12) throw new BadRequestException('Informe seu WhatsApp com DDD');
    const existing = await this.leadsRepo.findOne({ where: { phone } });
    if (existing) return existing;
    const saved = await this.leadsRepo.save(
      this.leadsRepo.create({
        name: (name || '').trim() || `Lead ${phone.slice(-4)}`,
        phone,
        status: 'novo',
        agentMode: 'sdr',
        kanbanStage: 'novo',
        aiPaused: true,
        utmSource: 'agendamento',
      } as Partial<Lead>),
    );
    this.realtime.emitLeadCreated(saved);
    return saved;
  }

  /** "até quinta" / "até amanhã" / "até daqui a pouco" — o dia da reunião, nunca fixo. */
  private untilHuman(at: Date, now: Date): string {
    const s = brt(at);
    if (s.ymd === brt(now).ymd) return 'até daqui a pouco';
    if (s.ymd === brt(addDays(now, 1)).ymd) return 'até amanhã';
    return `até ${WEEKDAYS[s.weekday]}`;
  }

  /**
   * Confirmação no WhatsApp do lead (mesmo número da Sofia/Efraim): a 1ª bolha
   * sai na hora e a 2ª 10s depois. Fica registrada na conversa do card.
   * Remarcação também confirma o novo horário.
   */
  private async confirmToLead(lead: Lead, at: Date) {
    const baseUrl = this.config.get('SDR_UAZAPI_BASE_URL') || this.config.get('UAZAPI_BASE_URL');
    const token = this.config.get('SDR_UAZAPI_TOKEN');
    if (!baseUrl || !token || !lead.phone) return;
    const now = new Date();
    const firstName = (lead.name || '').trim().split(/\s+/)[0];
    const greeting = firstName && !/^Lead \d{4}$/.test(lead.name || '') ? `Oi ${firstName}` : 'Oi';
    const bubbles = [
      `${greeting}, parabéns! Sua reunião está confirmada: ${formatSlotHuman(at, now)}.\nVou te mandar o link 1h antes.`,
      `Lá vamos te explicar como você vai dobrar o seu faturamento com a nossa ajuda, ${this.untilHuman(at, now)}!`,
    ];
    const number = lead.phone.startsWith('55') ? lead.phone : `55${lead.phone}`;
    for (const [i, content] of bubbles.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, 10_000));
      const res = await fetch(`${baseUrl}/send/text`, { method: 'POST', headers: { 'Content-Type': 'application/json', token }, body: JSON.stringify({ number, text: content }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Grava cada bolha assim que sai: com a conversa não vazia, o Efraim não
      // manda a abertura dele por cima da confirmação. Relê o contexto a cada
      // vez porque o lead pode responder no intervalo dos 10s.
      const fresh = await this.leadsRepo.findOne({ where: { id: lead.id } });
      const prior: any[] = Array.isArray(fresh?.aiContext) ? (fresh!.aiContext as any[]) : [];
      await this.leadsRepo.update(lead.id, { aiContext: [...prior, { role: 'assistant', source: 'agendamento', content, timestamp: Date.now() }] as any });
      const updated = await this.leadsRepo.findOne({ where: { id: lead.id } });
      if (updated) this.realtime.emitLeadUpdated(updated);
    }
  }

  private async notify(lead: Lead, at: Date, previous: Date | null) {
    const stored = await this.settings.get(MEETING_NOTIFY_PHONES_KEY);
    const phones = stored ? stored.split(',').map((p) => p.trim()).filter(Boolean) : [];
    const baseUrl = this.config.get('SDR_UAZAPI_BASE_URL') || this.config.get('UAZAPI_BASE_URL');
    const token = this.config.get('SDR_UAZAPI_TOKEN');
    if (!phones.length || !baseUrl || !token) return;
    const now = new Date();
    const answers = formatQuizAnswers(lead);
    const text = [
      previous ? '🔁 Reunião remarcada pela página de agendamento!' : '📅 Reunião agendada pela página de agendamento!',
      '',
      `Lead: ${lead.name}`,
      `WhatsApp: ${phoneWithoutDdi(lead.phone)}`,
      `Quando: ${formatSlotHuman(at, now)}`,
      ...(previous ? [`Antes: ${formatSlotHuman(previous, now)}`] : []),
      ...(answers ? ['', 'Respostas do quiz:', answers] : []),
    ].join('\n');
    await Promise.allSettled(
      phones.map((number) =>
        fetch(`${baseUrl}/send/text`, { method: 'POST', headers: { 'Content-Type': 'application/json', token }, body: JSON.stringify({ number, text }) }),
      ),
    );
  }
}
