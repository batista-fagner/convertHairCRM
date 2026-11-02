import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { AgendaAvailability } from '../common/entities/agenda-availability.entity';
import { AgendaBlock } from '../common/entities/agenda-block.entity';
import { Lead } from '../common/entities/lead.entity';
import { SettingsService } from '../settings/settings.service';
import { addDays, brt, brtAt, formatDayHuman, hourHuman } from '../common/brt.util';

export const AGENDA_NOTICE_HOURS_KEY = 'agenda_min_notice_hours';
export const AGENDA_MAX_DAYS_KEY = 'agenda_max_days_ahead';

/** Antecedência mínima: nada é oferecido pra daqui menos que isso. */
const DEFAULT_NOTICE_HOURS = 3;
/** Até quantos dias à frente a agenda olha. */
const DEFAULT_MAX_DAYS = 14;

export interface AgendaSlot {
  /** Início do horário (UTC no banco, -03:00 na conversa). */
  at: Date;
  ymd: string;
  hour: number;
}

export interface AgendaDay {
  ymd: string;
  weekday: number;
  /** Como falar o dia na conversa: "amanhã (terça, 03/11)". */
  human: string;
  slots: AgendaSlot[];
}

@Injectable()
export class AgendaService {
  private readonly logger = new Logger(AgendaService.name);

  constructor(
    @InjectRepository(AgendaAvailability) private readonly availabilityRepo: Repository<AgendaAvailability>,
    @InjectRepository(AgendaBlock) private readonly blocksRepo: Repository<AgendaBlock>,
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    private readonly settings: SettingsService,
  ) {}

  // ─── Configuração (tela /agenda) ─────────────────────────────────────────

  async getConfig(): Promise<{ noticeHours: number; maxDaysAhead: number }> {
    const [notice, maxDays] = await Promise.all([
      this.settings.get(AGENDA_NOTICE_HOURS_KEY),
      this.settings.get(AGENDA_MAX_DAYS_KEY),
    ]);
    // `Number(null)` é 0, então a chave ausente precisa cair no padrão à mão.
    const num = (raw: string | null, fallback: number) => {
      const n = Number(raw);
      return raw != null && raw !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    return { noticeHours: num(notice, DEFAULT_NOTICE_HOURS), maxDaysAhead: num(maxDays, DEFAULT_MAX_DAYS) || DEFAULT_MAX_DAYS };
  }

  async setConfig(body: { noticeHours?: number; maxDaysAhead?: number }) {
    if (body.noticeHours != null) {
      const n = Number(body.noticeHours);
      if (!Number.isFinite(n) || n < 0 || n > 72) throw new BadRequestException('Antecedência precisa ser entre 0 e 72 horas');
      await this.settings.set(AGENDA_NOTICE_HOURS_KEY, String(Math.round(n)));
    }
    if (body.maxDaysAhead != null) {
      const n = Number(body.maxDaysAhead);
      if (!Number.isFinite(n) || n < 1 || n > 60) throw new BadRequestException('Janela precisa ser entre 1 e 60 dias');
      await this.settings.set(AGENDA_MAX_DAYS_KEY, String(Math.round(n)));
    }
    return this.getConfig();
  }

  /** Sempre os 7 dias da semana, mesmo os que nunca foram salvos (hours: []). */
  async getAvailability(): Promise<{ weekday: number; hours: number[] }[]> {
    const rows = await this.availabilityRepo.find();
    const byWeekday = new Map(rows.map((r) => [r.weekday, this.cleanHours(r.hours)]));
    return Array.from({ length: 7 }, (_, weekday) => ({ weekday, hours: byWeekday.get(weekday) ?? [] }));
  }

  async setAvailability(list: { weekday: number; hours: number[] }[]) {
    if (!Array.isArray(list)) throw new BadRequestException('Disponibilidade inválida');
    for (const item of list) {
      const weekday = Number(item?.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new BadRequestException(`Dia da semana inválido: ${item?.weekday}`);
      const hours = this.cleanHours(item?.hours);
      const existing = await this.availabilityRepo.findOne({ where: { weekday } });
      if (existing) await this.availabilityRepo.update(existing.id, { hours });
      else await this.availabilityRepo.save(this.availabilityRepo.create({ weekday, hours }));
    }
    return this.getAvailability();
  }

  private cleanHours(hours: unknown): number[] {
    if (!Array.isArray(hours)) return [];
    const nums = hours.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
    return Array.from(new Set(nums)).sort((a, b) => a - b);
  }

  // ─── Bloqueios ───────────────────────────────────────────────────────────

  async getBlocks(): Promise<AgendaBlock[]> {
    // Bloqueio que já passou não interessa mais na tela.
    const todayYmd = brt(new Date()).ymd;
    const all = await this.blocksRepo.find({ order: { date: 'ASC' } });
    return all.filter((b) => b.date >= todayYmd);
  }

  async addBlock(body: { date?: string; hours?: number[] | null; note?: string }) {
    const date = String(body?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Data inválida (use YYYY-MM-DD)');
    const hours = body.hours == null ? null : this.cleanHours(body.hours);
    return this.blocksRepo.save(
      this.blocksRepo.create({ date, hours: hours && hours.length ? hours : null, note: (body.note || '').trim() || null }),
    );
  }

  async removeBlock(id: string) {
    const res = await this.blocksRepo.delete(id);
    if (!res.affected) throw new NotFoundException('Bloqueio não encontrado');
    return { ok: true };
  }

  // ─── Horários livres ─────────────────────────────────────────────────────

  /**
   * Agenda expandida: dias com horário livre, do mais próximo pro mais
   * distante. Desconta antecedência mínima, bloqueios e reuniões já marcadas
   * (leads.meeting_at) — inclusive as que a SDR marcou à mão no Kanban.
   */
  async availableDays(now = new Date(), maxDays?: number): Promise<AgendaDay[]> {
    const [availability, blocks, config] = await Promise.all([this.getAvailability(), this.blocksRepo.find(), this.getConfig()]);
    const hoursByWeekday = new Map(availability.map((a) => [a.weekday, a.hours]));
    if (!availability.some((a) => a.hours.length)) return [];

    const horizon = maxDays ?? config.maxDaysAhead;
    const blockedWholeDay = new Set(blocks.filter((b) => !b.hours?.length).map((b) => b.date));
    const blockedHours = new Map<string, Set<number>>();
    for (const b of blocks) {
      if (b.hours?.length) blockedHours.set(b.date, new Set(b.hours));
    }

    const taken = await this.takenSlots(now, horizon);
    const earliest = now.getTime() + config.noticeHours * 3_600_000;

    const days: AgendaDay[] = [];
    for (let i = 0; i <= horizon; i++) {
      const dayDate = addDays(now, i);
      const { ymd, weekday } = brt(dayDate);
      if (blockedWholeDay.has(ymd)) continue;
      const hours = hoursByWeekday.get(weekday) ?? [];
      if (!hours.length) continue;
      const blocked = blockedHours.get(ymd);
      const slots: AgendaSlot[] = [];
      for (const hour of hours) {
        if (blocked?.has(hour)) continue;
        const at = brtAt(ymd, hour);
        if (at.getTime() < earliest) continue;
        if (taken.has(at.getTime())) continue;
        slots.push({ at, ymd, hour });
      }
      if (slots.length) days.push({ ymd, weekday, human: formatDayHuman(slots[0].at, now), slots });
    }
    return days;
  }

  /** Reuniões já marcadas no CRM na janela — o mesmo horário não é oferecido de novo. */
  private async takenSlots(now: Date, horizon: number): Promise<Set<number>> {
    const rows = await this.leadsRepo
      .createQueryBuilder('lead')
      .select(['lead.id', 'lead.meetingAt'])
      .where('lead.meeting_at IS NOT NULL')
      .andWhere('lead.meeting_at >= :from', { from: new Date(now.getTime() - 3_600_000) })
      .andWhere('lead.meeting_at <= :to', { to: addDays(now, horizon + 1) })
      .getMany();
    return new Set(rows.filter((r) => r.meetingAt).map((r) => new Date(r.meetingAt as any).getTime()));
  }

  /** Os próximos `count` horários livres, do dia mais próximo pro mais distante. */
  async nextSlots(count = 2, now = new Date()): Promise<Date[]> {
    const days = await this.availableDays(now);
    const out: Date[] = [];
    for (const day of days) {
      for (const slot of day.slots) {
        out.push(slot.at);
        if (out.length >= count) return out;
      }
    }
    return out;
  }

  /**
   * O que o Efraim afirma na abertura: TODAS as horas livres dos `dayCount`
   * dias mais próximos. A mensagem só fala dia + turno ("terça de manhã ou à
   * tarde"), então os turnos precisam vir completos — a pessoa escolhe a hora
   * depois, dentro do turno que ela pedir.
   */
  async openingSlots(now = new Date(), dayCount = 2): Promise<Date[]> {
    const days = await this.availableDays(now);
    return days.slice(0, dayCount).flatMap((day) => day.slots.map((s) => s.at));
  }

  /** Alternativas pra quando a pessoa recusa os primeiros: os próximos dias com horário. */
  async alternativeDays(skipYmd: string[], maxDays = 3, now = new Date()): Promise<AgendaDay[]> {
    const days = await this.availableDays(now);
    return days.filter((d) => !skipYmd.includes(d.ymd)).slice(0, maxDays);
  }

  /** O horário pedido existe na agenda e está livre? (0 = sim; senão o motivo) */
  async checkSlot(at: Date, now = new Date()): Promise<string | null> {
    const days = await this.availableDays(now, 60);
    const target = at.getTime();
    for (const day of days) {
      if (day.slots.some((s) => s.at.getTime() === target)) return null;
    }
    return 'horário fora da agenda ou já ocupado';
  }

  /** Resumo pra IA: "amanhã (terça, 03/11): 10h, 11h · quarta (04/11): 14h". */
  async agendaSummary(now = new Date(), maxDays = 4): Promise<string> {
    const days = (await this.availableDays(now)).slice(0, maxDays);
    if (!days.length) return '';
    return days.map((d) => `${d.human}: ${d.slots.map((s) => hourHuman(s.at)).join(', ')}`).join(' · ');
  }
}
