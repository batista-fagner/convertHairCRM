import { Controller, Get, Param, Query, Delete, Patch, Post, Body, Headers, UnauthorizedException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadsService } from './leads.service';
import { FacebookService } from '../facebook/facebook.service';
import { QuizService } from '../quiz/quiz.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { KanbanStage } from '../common/entities/lead.entity';

@Controller('leads')
export class LeadsController {
  private readonly logger = new Logger(LeadsController.name);

  constructor(
    private leadsService: LeadsService,
    private facebookService: FacebookService,
    private quizService: QuizService,
    private realtime: RealtimeGateway,
    private config: ConfigService,
  ) {}

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
  async moveKanban(@Param('id') id: string, @Body() body: { kanbanStage: KanbanStage }) {
    const lead = await this.leadsService.moveKanban(id, body.kanbanStage);
    this.realtime.emitLeadUpdated(lead);
    return lead;
  }

  @Patch(':id/ai-pause')
  async setAiPause(@Param('id') id: string, @Body() body: { paused: boolean }) {
    const lead = await this.leadsService.update(id, { aiPaused: !!body.paused });
    this.realtime.emitLeadUpdated(lead);
    return lead;
  }

  @Patch(':id')
  async edit(@Param('id') id: string, @Body() body: { name?: string; assignedTo?: string | null; notes?: string | null }) {
    const data: { name?: string; assignedTo?: string | null; notes?: string | null } = {};
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if ('assignedTo' in body) data.assignedTo = body.assignedTo?.trim() || null;
    if ('notes' in body) data.notes = body.notes ?? null;
    const lead = await this.leadsService.update(id, data);
    this.realtime.emitLeadUpdated(lead);
    return lead;
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
