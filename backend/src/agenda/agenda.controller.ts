import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { AgendaService } from './agenda.service';
import { formatSlotHuman, formatSlotPairHuman } from '../common/brt.util';

/** Agenda interna (tela /agenda): disponibilidade semanal, bloqueios e horários livres. */
@Controller('agenda')
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('availability')
  async getAvailability() {
    const [availability, config] = await Promise.all([this.agenda.getAvailability(), this.agenda.getConfig()]);
    return { availability, config };
  }

  @Put('availability')
  async setAvailability(@Body() body: { availability?: { weekday: number; hours: number[] }[]; noticeHours?: number; maxDaysAhead?: number }) {
    if (Array.isArray(body.availability)) await this.agenda.setAvailability(body.availability);
    if (body.noticeHours != null || body.maxDaysAhead != null) {
      await this.agenda.setConfig({ noticeHours: body.noticeHours, maxDaysAhead: body.maxDaysAhead });
    }
    return this.getAvailability();
  }

  @Get('blocks')
  async getBlocks() {
    return this.agenda.getBlocks();
  }

  @Post('blocks')
  async addBlock(@Body() body: { date?: string; hours?: number[] | null; note?: string }) {
    return this.agenda.addBlock(body || {});
  }

  @Delete('blocks/:id')
  async removeBlock(@Param('id') id: string) {
    return this.agenda.removeBlock(id);
  }

  /** Prévia: o que o Efraim vai oferecer agora. */
  @Get('slots')
  async slots(@Query('days') days?: string) {
    const now = new Date();
    const maxDays = Number(days) > 0 ? Number(days) : undefined;
    const [available, next] = await Promise.all([this.agenda.availableDays(now, maxDays), this.agenda.openingSlots(now)]);
    return {
      days: available.map((d) => ({ ...d, slots: d.slots.map((s) => ({ at: s.at.toISOString(), hour: s.hour })) })),
      next: next.map((at) => ({ at: at.toISOString(), human: formatSlotHuman(at, now) })),
      // Frase exata que o Efraim afirma na abertura.
      nextHuman: formatSlotPairHuman(next, now),
      summary: await this.agenda.agendaSummary(now),
    };
  }
}
