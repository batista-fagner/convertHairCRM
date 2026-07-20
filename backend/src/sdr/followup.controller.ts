import { Controller, Get, Post, Put, Patch, Delete, Body, Param, BadRequestException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SdrFollowupService, VIDEO_LIMIT_KEY, DEFAULT_VIDEO_LIMIT } from './sdr-followup.service';
import { FollowupVideoService } from './followup-video.service';
import type { UploadedVideoFile } from './followup-video.service';
import { SettingsService } from '../settings/settings.service';
import { FollowupRule } from '../common/entities/followup-rule.entity';
import { Lead } from '../common/entities/lead.entity';

@Controller('followup')
export class FollowupController {
  constructor(
    private readonly followupService: SdrFollowupService,
    private readonly videoService: FollowupVideoService,
    private readonly settings: SettingsService,
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

  // Valores distintos de ctwa_ad_title já gravados nos leads — popula o dropdown de criativo.
  @Get('ad-title-options')
  async adTitleOptions() {
    const rows = await this.leadsRepo
      .createQueryBuilder('lead')
      .select('DISTINCT lead.ctwa_ad_title', 'adTitle')
      .where('lead.ctwa_ad_title IS NOT NULL')
      .getRawMany();
    return rows.map((r) => r.adTitle).filter(Boolean).sort();
  }

  @Post('rules')
  async createRule(@Body() body: Partial<FollowupRule>) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome da regra é obrigatório');
    const hasVideo = Boolean(body.videoId);
    // Regra com vídeo manda só o vídeo — modo/texto ficam irrelevantes.
    if (!hasVideo && body.mode === 'manual' && !body.text?.trim()) {
      throw new BadRequestException('Texto é obrigatório no modo manual');
    }
    const rule = this.rulesRepo.create({
      name: body.name.trim(),
      enabled: body.enabled ?? true,
      kanbanStage: body.kanbanStage || null,
      utmCampaign: body.utmCampaign || null,
      adTitle: body.adTitle || null,
      createdAfter: body.createdAfter ? new Date(body.createdAfter) : null,
      delayMinutes: Math.max(1, body.delayMinutes || 60),
      sendAtHour: body.sendAtHour != null ? Math.min(23, Math.max(0, body.sendAtHour)) : null,
      sendAtMinute: body.sendAtMinute != null ? Math.min(59, Math.max(0, body.sendAtMinute)) : 0,
      mode: body.mode === 'ai' ? 'ai' : 'manual',
      text: body.text || null,
      videoId: body.videoId || null,
      videoCaptionOverride: body.videoCaptionOverride || null,
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
    if (body.adTitle !== undefined) rule.adTitle = body.adTitle || null;
    if (body.createdAfter !== undefined) rule.createdAfter = body.createdAfter ? new Date(body.createdAfter) : null;
    if (body.delayMinutes !== undefined) rule.delayMinutes = Math.max(1, body.delayMinutes);
    if (body.sendAtHour !== undefined) rule.sendAtHour = body.sendAtHour != null ? Math.min(23, Math.max(0, body.sendAtHour)) : null;
    if (body.sendAtMinute !== undefined) rule.sendAtMinute = body.sendAtMinute != null ? Math.min(59, Math.max(0, body.sendAtMinute)) : 0;
    if (body.mode !== undefined) rule.mode = body.mode === 'ai' ? 'ai' : 'manual';
    if (body.text !== undefined) rule.text = body.text || null;
    if (body.videoId !== undefined) rule.videoId = body.videoId || null;
    if (body.videoCaptionOverride !== undefined) rule.videoCaptionOverride = body.videoCaptionOverride || null;
    if (body.priority !== undefined) rule.priority = body.priority;

    // Só exige texto quando não tem vídeo (com vídeo, manda só o vídeo).
    if (!rule.videoId && rule.mode === 'manual' && !rule.text?.trim() && rule.enabled) {
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
      if (rule.adTitle) qb.andWhere('ctwa_ad_title = :adTitle', { adTitle: rule.adTitle });
      if (rule.createdAfter) qb.andWhere('created_at >= :createdAfter', { createdAfter: rule.createdAfter });
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

  // ─── Biblioteca de vídeos ───────────────────────────────────────────

  @Get('videos')
  async listVideos() {
    return this.videoService.list();
  }

  @Post('videos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async uploadVideo(
    @UploadedFile() file: UploadedVideoFile,
    @Body('name') name: string,
    @Body('caption') caption?: string,
  ) {
    return this.videoService.upload(file, name, caption);
  }

  @Patch('videos/:id')
  async updateVideo(@Param('id') id: string, @Body() body: { name?: string; caption?: string }) {
    return this.videoService.update(id, body);
  }

  @Delete('videos/:id')
  async deleteVideo(@Param('id') id: string) {
    await this.videoService.delete(id);
    return { ok: true };
  }

  // ─── Teto diário de envio de vídeo ──────────────────────────────────

  @Get('video-limit')
  async getVideoLimit() {
    const value = await this.settings.get(VIDEO_LIMIT_KEY);
    return { limit: parseInt(value || String(DEFAULT_VIDEO_LIMIT), 10) };
  }

  @Put('video-limit')
  async setVideoLimit(@Body() body: { limit: number }) {
    const limit = Math.max(1, Math.floor(Number(body.limit) || DEFAULT_VIDEO_LIMIT));
    await this.settings.set(VIDEO_LIMIT_KEY, String(limit));
    return { limit };
  }
}
