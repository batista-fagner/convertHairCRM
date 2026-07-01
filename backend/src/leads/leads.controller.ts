import { Controller, Get, Param, Query, Delete, Patch, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { FacebookService } from '../facebook/facebook.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { KanbanStage } from '../common/entities/lead.entity';

@Controller('leads')
export class LeadsController {
  constructor(
    private leadsService: LeadsService,
    private facebookService: FacebookService,
    private realtime: RealtimeGateway,
  ) {}

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
  ) {
    return this.leadsService.findAll({
      campaignId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 6,
      source: source || 'all',
    });
  }

  @Get('stats')
  async getStats() {
    return this.leadsService.getStats();
  }

  @Get('kanban')
  async kanban() {
    return this.leadsService.findKanban();
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
    this.facebookService.sendPurchaseEvent(lead, body.value ?? 3000).catch(() => null);
    return lead;
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
