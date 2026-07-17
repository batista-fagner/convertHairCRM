import { Controller, Get, Post, Patch, Delete, Body, Param, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SdrFollowupService } from './sdr-followup.service';
import { FollowupRule } from '../common/entities/followup-rule.entity';
import { Lead } from '../common/entities/lead.entity';

@Controller('followup')
export class FollowupController {
  constructor(
    private readonly followupService: SdrFollowupService,
    @InjectRepository(FollowupRule) private readonly rulesRepo: Repository<FollowupRule>,
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
  ) {}

  @Get('status')
  async status() {
    return this.followupService.getStatus();
  }

  @Get('rules')
  async listRules() {
    await this.followupService.ensureRulesSeeded();
    return this.rulesRepo.find({ order: { createdAt: 'ASC' } });
  }

  // Valores distintos de utm_campaign já gravados nos leads — popula o dropdown
  // de campanha no formulário de regra (a página "Campanhas" ainda não é usada).
  @Get('campaign-options')
  async campaignOptions() {
    const rows = await this.leadsRepo
      .createQueryBuilder('lead')
      .select('DISTINCT lead.utm_campaign', 'utmCampaign')
      .where('lead.utm_campaign IS NOT NULL')
      .getRawMany();
    return rows.map((r) => r.utmCampaign).filter(Boolean).sort();
  }

  @Post('rules')
  async createRule(@Body() body: Partial<FollowupRule>) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome da regra é obrigatório');
    if (body.mode === 'manual' && !body.text?.trim()) throw new BadRequestException('Texto é obrigatório no modo manual');
    const rule = this.rulesRepo.create({
      name: body.name.trim(),
      enabled: body.enabled ?? true,
      kanbanStage: body.kanbanStage || null,
      utmCampaign: body.utmCampaign || null,
      delayMinutes: Math.max(1, body.delayMinutes || 60),
      mode: body.mode === 'ai' ? 'ai' : 'manual',
      text: body.text || null,
      priority: body.priority ?? 0,
    });
    return this.rulesRepo.save(rule);
  }

  @Patch('rules/:id')
  async updateRule(@Param('id') id: string, @Body() body: Partial<FollowupRule> & { resetCycle?: boolean }) {
    const rule = await this.rulesRepo.findOne({ where: { id } });
    if (!rule) throw new BadRequestException('Regra não encontrada');

    if (body.name !== undefined) rule.name = body.name.trim();
    if (body.enabled !== undefined) rule.enabled = body.enabled;
    if (body.kanbanStage !== undefined) rule.kanbanStage = body.kanbanStage || null;
    if (body.utmCampaign !== undefined) rule.utmCampaign = body.utmCampaign || null;
    if (body.delayMinutes !== undefined) rule.delayMinutes = Math.max(1, body.delayMinutes);
    if (body.mode !== undefined) rule.mode = body.mode === 'ai' ? 'ai' : 'manual';
    if (body.text !== undefined) rule.text = body.text || null;
    if (body.priority !== undefined) rule.priority = body.priority;

    if (rule.mode === 'manual' && !rule.text?.trim() && rule.enabled) {
      throw new BadRequestException('Texto é obrigatório no modo manual');
    }

    await this.rulesRepo.save(rule);

    // Libera pra um novo ciclo só os leads que casam com a raia/campanha desta regra.
    let resetCount = 0;
    if (body.resetCycle) {
      const qb = this.leadsRepo
        .createQueryBuilder()
        .update(Lead)
        .set({ followupSentAt: null })
        .where('agent_mode = :mode', { mode: 'sdr' })
        .andWhere('ai_paused = false')
        .andWhere("wa_stage != 'encerrado'")
        .andWhere('followup_sent_at IS NOT NULL');
      if (rule.kanbanStage) qb.andWhere('kanban_stage = :stage', { stage: rule.kanbanStage });
      if (rule.utmCampaign) qb.andWhere('utm_campaign = :campaign', { campaign: rule.utmCampaign });
      const res = await qb.execute();
      resetCount = res.affected ?? 0;
    }

    return { ...rule, resetCount };
  }

  @Delete('rules/:id')
  async deleteRule(@Param('id') id: string) {
    await this.rulesRepo.delete(id);
    return { ok: true };
  }
}
