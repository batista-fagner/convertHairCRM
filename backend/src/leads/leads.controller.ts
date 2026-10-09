import { Controller, Get, Param, Query, Delete, Patch, Post, Body, Headers, UnauthorizedException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadsService } from './leads.service';
import { FacebookService } from '../facebook/facebook.service';
import { QuizService } from '../quiz/quiz.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SettingsService, MEETING_NOTIFY_PHONES_KEY } from '../settings/settings.service';
import { Lead } from '../common/entities/lead.entity';
import { randomUUID } from 'crypto';

type MeetingChange = 'agendada' | 'remarcada' | 'desmarcada';

function formatMeetingDate(d: Date): string {
  const tz = 'America/Sao_Paulo';
  const day = d.toLocaleDateString('pt-BR', { timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  return `${day} às ${time}`;
}

@Controller('leads')
export class LeadsController {
  private readonly logger = new Logger(LeadsController.name);

  constructor(
    private leadsService: LeadsService,
    private facebookService: FacebookService,
    private quizService: QuizService,
    private realtime: RealtimeGateway,
    private config: ConfigService,
    private settingsService: SettingsService,
  ) {}

  // Sai pela instância do CRM (mesma da Sofia), não pela do Efraim/Greenn.
  private async notifyMeeting(lead: Lead, change: MeetingChange, previous: Date | null): Promise<number> {
    const stored = await this.settingsService.get(MEETING_NOTIFY_PHONES_KEY);
    const phones = stored ? stored.split(',').map((p) => p.trim()).filter(Boolean) : [];
    const baseUrl = this.config.get('SDR_UAZAPI_BASE_URL') || this.config.get('UAZAPI_BASE_URL');
    const token = this.config.get('SDR_UAZAPI_TOKEN');
    if (phones.length === 0 || !baseUrl || !token) return 0;

    const header = {
      agendada: '📅 Reunião agendada!',
      remarcada: '🔁 Reunião remarcada!',
      desmarcada: '❌ Reunião desmarcada',
    }[change];
    const notes = (lead.notes || '').trim();
    const lines = [
      header,
      '',
      `Lead: ${lead.name}`,
      `WhatsApp: ${lead.phone}`,
      lead.meetingAt ? `Quando: ${formatMeetingDate(new Date(lead.meetingAt))}` : null,
      previous && change !== 'agendada' ? `${change === 'remarcada' ? 'Antes' : 'Era'}: ${formatMeetingDate(previous)}` : null,
      lead.assignedTo ? `Responsável: ${lead.assignedTo}` : null,
      notes ? `\nNotas: ${notes.length > 400 ? `${notes.slice(0, 400)}…` : notes}` : null,
    ].filter((l) => l !== null);
    const text = lines.join('\n');

    const results = await Promise.allSettled(
      phones.map(async (number) => {
        const res = await fetch(`${baseUrl}/send/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token },
          body: JSON.stringify({ number, text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }),
    );
    results.forEach((r, i) => {
      if (r.status === 'rejected') this.logger.error(`[Reunião] Falha ao avisar ${phones[i]}: ${r.reason?.message}`);
    });
    return results.filter((r) => r.status === 'fulfilled').length;
  }

  // Se o lead veio de um quiz com pixel/CAPI próprio, o Purchase precisa ir pra esse
  // pixel — não pro global — senão a campanha do quiz nunca vê a conversão de verdade.
  // findBySlug lança se o quiz foi desativado/removido depois; não pode derrubar a
  // conversão do lead por isso, então falha em silêncio (loga e segue sem override).
  private async _resolveQuizPixelOverride(quizSlug?: string | null): Promise<{ pixelId?: string; accessToken?: string } | undefined> {
    if (!quizSlug) return undefined;
    try {
      const quiz = await this.quizService.findBySlug(quizSlug);
      if (!quiz.fbPixelId && !quiz.fbAccessToken) return undefined;
      return { pixelId: quiz.fbPixelId ?? undefined, accessToken: quiz.fbAccessToken ?? undefined };
    } catch (err) {
      this.logger.warn(`Não foi possível resolver pixel do quiz "${quizSlug}" pra atribuir o Purchase: ${err.message}`);
      return undefined;
    }
  }

  @Post()
  async createManual(@Body() body: { name: string; phone: string; instagram?: string; revenueRange?: string }) {
    const name = (body.name || '').trim();
    const phone = (body.phone || '').replace(/\D/g, '');
    if (!name || !phone) {
      throw new HttpException('Nome e telefone são obrigatórios', HttpStatus.BAD_REQUEST);
    }

    const existing = await this.leadsService.findByPhone(phone);
    if (existing) {
      throw new HttpException('Já existe um lead com esse telefone', HttpStatus.CONFLICT);
    }

    const lead = await this.leadsService.create({
      name,
      phone,
      instagram: body.instagram?.trim() || undefined,
      revenueRange: body.revenueRange?.trim() || undefined,
      agentMode: 'sdr',
      kanbanStage: 'novo',
      kanbanStageManual: true,
    });
    this.realtime.emitLeadCreated(lead);
    return lead;
  }

  @Get()
  async findAll(
    @Query('campaignId') campaignId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('source') source?: 'all' | 'ig_dm' | 'paid',
    @Query('search') search?: string,
  ) {
    return this.leadsService.findAll({
      campaignId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 6,
      source: source || 'all',
      search,
    });
  }

  @Get('stats')
  async getStats() {
    return this.leadsService.getStats();
  }

  @Get('analytics/ads')
  async getAdPerformance(@Query('from') from?: string, @Query('to') to?: string) {
    const rows = await this.leadsService.getAdPerformance(from, to);
    const range = from && to ? { since: from, until: to } : undefined;
    const withSpend = await Promise.all(
      rows.map(async (row) => {
        const spend = await this.facebookService.getAdSpend(row.adId, range).catch(() => 0);
        const cpql = row.qualifiedCount > 0 ? spend / row.qualifiedCount : null;
        return { ...row, spend, cpql };
      }),
    );
    return withSpend;
  }

  @Get('analytics/campaigns')
  async getCampaignSpend(@Query('from') from?: string, @Query('to') to?: string) {
    const range = from && to ? { since: from, until: to } : undefined;
    const rows = await this.facebookService.getCampaignSpend(range);
    return rows.sort((a, b) => b.spend - a.spend);
  }

  @Get('analytics/hourly')
  async getHourlyDistribution(@Query('from') from?: string, @Query('to') to?: string) {
    return this.leadsService.getLeadsByHour(from, to);
  }

  @Get('analytics/ads/:adId/leads')
  async getLeadsByAd(@Param('adId') adId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.leadsService.getLeadsByAd(adId, from, to);
  }

  @Get('kanban/campaigns')
  async kanbanCampaigns() {
    return this.leadsService.listCampaigns();
  }

  @Get('kanban')
  async kanban(@Query('campaign') campaign?: string) {
    return this.leadsService.findKanban(campaign);
  }

  @Patch(':id/kanban')
  async moveKanban(@Param('id') id: string, @Body() body: { kanbanStage: string }) {
    const lead = await this.leadsService.moveKanban(id, body.kanbanStage);
    this.realtime.emitLeadUpdated(lead);
    return lead;
  }

  // Raias do Kanban criadas pelo usuário (ex.: "Atendimento pelo SDR",
  // "Agendamentos") — complementam as fixas de KANBAN_STAGES. A IA nunca
  // move um lead pra elas sozinha, só drag-and-drop manual no Kanban.
  // Calendário de reuniões — ?from=&to= (ISO). Antes de ':id' pra não colidir.
  @Get('meetings')
  async meetings(@Query('from') from?: string, @Query('to') to?: string) {
    const f = from ? new Date(from) : undefined;
    const t = to ? new Date(to) : undefined;
    if ((f && isNaN(f.getTime())) || (t && isNaN(t.getTime()))) {
      throw new HttpException('Intervalo de datas inválido', HttpStatus.BAD_REQUEST);
    }
    return this.leadsService.findMeetings(f, t);
  }

  @Get('kanban-stages')
  async getKanbanStages() {
    return this.leadsService.getCustomStages();
  }

  @Post('kanban-stages')
  async createKanbanStage(@Body() body: { title: string }) {
    return this.leadsService.createCustomStage(body.title || '');
  }

  @Patch('kanban-stages/:id')
  async renameKanbanStage(@Param('id') id: string, @Body() body: { title: string }) {
    return this.leadsService.renameCustomStage(id, body.title || '');
  }

  @Delete('kanban-stages/:id')
  async deleteKanbanStage(@Param('id') id: string) {
    await this.leadsService.deleteCustomStage(id);
    return { success: true };
  }

  @Patch(':id/ai-pause')
  async setAiPause(@Param('id') id: string, @Body() body: { paused: boolean }) {
    const lead = await this.leadsService.update(id, { aiPaused: !!body.paused });
    this.realtime.emitLeadUpdated(lead);
    return lead;
  }

  @Patch(':id')
  async edit(@Param('id') id: string, @Body() body: { name?: string; assignedTo?: string | null; notes?: string | null; groupJid?: string | null }) {
    const data: { name?: string; assignedTo?: string | null; notes?: string | null; notesUpdatedAt?: Date; groupJid?: string | null } = {};
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if ('assignedTo' in body) data.assignedTo = body.assignedTo?.trim() || null;
    if ('notes' in body) {
      const newNotes = body.notes ?? null;
      // Só carimba a data quando o texto muda de verdade — não em todo PATCH
      // que passa por aqui (ex: salvar o mesmo texto de novo no onBlur).
      const current = await this.leadsService.findById(id);
      if (newNotes !== (current?.notes ?? null)) data.notesUpdatedAt = new Date();
      data.notes = newNotes;
    }
    // Backfill manual — leads que entraram no grupo antes do groupJid existir
    // (ver SdrGroupJoinService) não têm como ser corrigidos automaticamente.
    if ('groupJid' in body) data.groupJid = body.groupJid ?? null;
    const lead = await this.leadsService.update(id, data);
    this.realtime.emitLeadUpdated(lead);
    return lead;
  }

  // ── Notas (painel lateral) ────────────────────────────────────────────────
  // Nota legada (texto único de antes do painel) vira a primeira entrada do
  // histórico na primeira escrita, pra não sumir.
  private noteEntriesOf(lead: Lead) {
    const entries = Array.isArray(lead.noteEntries) ? [...lead.noteEntries] : [];
    if (entries.length === 0 && lead.notes?.trim()) {
      const at = (lead.notesUpdatedAt ?? lead.updatedAt ?? new Date()).toISOString();
      entries.push({ id: 'legacy', author: 'ConvertHair', content: lead.notes.trim(), createdAt: at });
    }
    return entries;
  }

  private async saveNoteEntries(id: string, entries: Lead['noteEntries']) {
    const lead = await this.leadsService.update(id, {
      noteEntries: entries,
      notes: entries[0]?.content ?? null,
      notesUpdatedAt: new Date(),
    } as any);
    this.realtime.emitLeadUpdated(lead);
    return lead;
  }

  @Post(':id/notes')
  async addNote(@Param('id') id: string, @Body() body: { content?: string; author?: string }) {
    const content = (body.content || '').trim().slice(0, 1000);
    if (!content) throw new HttpException('Nota vazia', HttpStatus.BAD_REQUEST);
    const lead = await this.leadsService.findById(id);
    if (!lead) throw new HttpException('Lead não encontrado', HttpStatus.NOT_FOUND);
    const entry = { id: randomUUID(), author: body.author?.trim() || 'ConvertHair', content, createdAt: new Date().toISOString() };
    return this.saveNoteEntries(id, [entry, ...this.noteEntriesOf(lead)]);
  }

  @Patch(':id/notes/:noteId')
  async editNote(@Param('id') id: string, @Param('noteId') noteId: string, @Body() body: { content?: string }) {
    const content = (body.content || '').trim().slice(0, 1000);
    if (!content) throw new HttpException('Nota vazia', HttpStatus.BAD_REQUEST);
    const lead = await this.leadsService.findById(id);
    if (!lead) throw new HttpException('Lead não encontrado', HttpStatus.NOT_FOUND);
    const entries = this.noteEntriesOf(lead).map((n) => (n.id === noteId ? { ...n, content, updatedAt: new Date().toISOString() } : n));
    return this.saveNoteEntries(id, entries);
  }

  @Delete(':id/notes/:noteId')
  async deleteNote(@Param('id') id: string, @Param('noteId') noteId: string) {
    const lead = await this.leadsService.findById(id);
    if (!lead) throw new HttpException('Lead não encontrado', HttpStatus.NOT_FOUND);
    return this.saveNoteEntries(id, this.noteEntriesOf(lead).filter((n) => n.id !== noteId));
  }

  @Patch(':id/meeting')
  async setMeeting(@Param('id') id: string, @Body() body: { meetingAt?: string | null }) {
    let meetingAt: Date | null = null;
    if (body.meetingAt) {
      meetingAt = new Date(body.meetingAt);
      if (isNaN(meetingAt.getTime())) throw new HttpException('Data da reunião inválida', HttpStatus.BAD_REQUEST);
    }
    const current = await this.leadsService.findById(id);
    const previous = current.meetingAt ? new Date(current.meetingAt) : null;
    const changed = (previous?.getTime() ?? null) !== (meetingAt?.getTime() ?? null);

    const lead = await this.leadsService.update(id, { meetingAt });
    this.realtime.emitLeadUpdated(lead);

    let notified = 0;
    if (changed) {
      const change: MeetingChange = !meetingAt ? 'desmarcada' : previous ? 'remarcada' : 'agendada';
      notified = await this.notifyMeeting(lead, change, previous);
    }
    return { lead, notified };
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.leadsService.findById(id);
  }

  @Patch(':id/convert')
  async convert(@Param('id') id: string, @Body() body: { value?: number }) {
    const lead = await this.leadsService.markAsConverted(id);
    const pixelOverride = await this._resolveQuizPixelOverride(lead.quizSlug);
    this.facebookService.sendPurchaseEvent(lead, body.value ?? 3000, pixelOverride).catch((err) =>
      this.logger.error(`Erro ao enviar evento Purchase (conversão manual) do lead ${id}: ${err.message}`),
    );
    return lead;
  }

  // Chamado pelo fisio-secretary quando um pagamento (PIX ou cartão) é confirmado pela
  // primeira vez pra um cliente novo — permite atribuir o Purchase automaticamente ao lead
  // de origem, sem precisar clicar em "Converter Lead" manualmente aqui. Autenticado por
  // token compartilhado (não é rota pública). Telefone casado por sufixo (ver
  // findByPhoneSuffix) porque o número digitado no checkout pode vir formatado diferente
  // do que o WhatsApp reportou quando o lead entrou no grupo.
  @Post('auto-convert')
  async autoConvert(@Body() body: { phone: string; value: number }, @Headers('x-internal-token') token?: string) {
    const expected = this.config.get<string>('INTERNAL_API_TOKEN');
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token inválido');
    }
    if (!body?.phone || !Number.isFinite(Number(body.value))) {
      throw new HttpException('phone e value são obrigatórios', HttpStatus.BAD_REQUEST);
    }

    const lead = await this.leadsService.findByPhoneSuffix(body.phone);
    if (!lead) {
      this.logger.warn(`[AUTO-CONVERT] Nenhum lead encontrado pro telefone ${body.phone} — cliente novo sem lead de origem rastreável`);
      return { ok: true, matched: false };
    }
    if (lead.status === 'convertido') {
      return { ok: true, matched: true, alreadyConverted: true, leadId: lead.id };
    }

    const converted = await this.leadsService.markAsConverted(lead.id);
    const pixelOverride = await this._resolveQuizPixelOverride(converted.quizSlug);
    this.facebookService.sendPurchaseEvent(converted, Number(body.value), pixelOverride).catch((err) =>
      this.logger.error(`Erro ao enviar evento Purchase (conversão automática) do lead ${converted.id}: ${err.message}`),
    );
    this.logger.log(`[AUTO-CONVERT] Lead ${converted.id} (${converted.name}) convertido automaticamente via fisio-secretary — valor R$ ${body.value}`);
    return { ok: true, matched: true, leadId: converted.id };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.leadsService.delete(id);
    this.realtime.emitLeadDeleted(id);
    return { success: true };
  }

  @Delete('__clear-all__')
  async clearAll() {
    return this.leadsService.clearAll();
  }
}
