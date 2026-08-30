import { Controller, Get, Post, Put, Patch, Delete, Body, Param, BadRequestException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SdrFollowupService, VIDEO_LIMIT_KEY, DEFAULT_VIDEO_LIMIT } from './sdr-followup.service';
import { FollowupVideoService } from './followup-video.service';
import type { UploadedVideoFile } from './followup-video.service';
import { SettingsService } from '../settings/settings.service';
import { FollowupRule, CadenceStep } from '../common/entities/followup-rule.entity';
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

  // Valores distintos de tags já gravadas nos leads (jsonb array, precisa
  // desaninhar com jsonb_array_elements_text) — popula o select de "excluir
  // quem já tem a tag" no formulário de regra.
  @Get('tag-options')
  async tagOptions() {
    const rows = await this.leadsRepo.query(
      `SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM leads WHERE tags IS NOT NULL ORDER BY tag`,
    );
    return rows.map((r: { tag: string }) => r.tag).filter(Boolean);
  }

  /**
   * Normaliza a cadência vinda da tela: descarta toques em branco, garante
   * delay mínimo de 1 min. Retorna null quando não sobra nada — aí a regra
   * volta a ser de disparo único.
   */
  private sanitizeCadence(steps: unknown): CadenceStep[] | null {
    if (!Array.isArray(steps)) return null;
    const clean = steps
      .map((s: any) => ({
        delayMinutes: Math.max(1, Math.floor(Number(s?.delayMinutes) || 1440)),
        objective: String(s?.objective ?? '').trim(),
        text: s?.text ? String(s.text).trim() : null,
      }))
      .filter((s) => s.objective || s.text);
    return clean.length ? clean : null;
  }

  /** Modo manual manda o texto literal — sem texto, o toque não teria o que enviar. */
  private assertCadenceTexts(steps: CadenceStep[], mode?: string) {
    if (mode === 'manual' && steps.some((s) => !s.text?.trim())) {
      throw new BadRequestException('No modo manual, todo toque da cadência precisa de um texto');
    }
  }

  @Post('rules')
  async createRule(@Body() body: Partial<FollowupRule>) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome da regra é obrigatório');
    const hasVideo = Boolean(body.videoId);
    const cadenceSteps = this.sanitizeCadence(body.cadenceSteps);
    if (cadenceSteps) this.assertCadenceTexts(cadenceSteps, body.mode);
    // Regra com vídeo manda só o vídeo — modo/texto ficam irrelevantes.
    // Regra com cadência tira o texto único de cena (cada toque tem o seu).
    if (!cadenceSteps && !hasVideo && body.mode === 'manual' && !body.text?.trim()) {
      throw new BadRequestException('Texto é obrigatório no modo manual');
    }
    const rule = this.rulesRepo.create({
      name: body.name.trim(),
      enabled: body.enabled ?? true,
      kanbanStage: body.kanbanStage || null,
      utmCampaign: body.utmCampaign || null,
      adTitle: body.adTitle || null,
      createdAfter: body.createdAfter ? new Date(body.createdAfter) : null,
      excludeTag: body.excludeTag || null,
      includeTag: body.includeTag || null,
      delayMinutes: Math.max(1, body.delayMinutes || 60),
      cadenceSteps,
      sendAtHour: body.sendAtHour != null ? Math.min(23, Math.max(0, body.sendAtHour)) : null,
      sendAtMinute: body.sendAtMinute != null ? Math.min(59, Math.max(0, body.sendAtMinute)) : 0,
      mode: body.mode === 'ai' ? 'ai' : 'manual',
      text: body.text || null,
      promptOverride: body.promptOverride || null,
      ignoreAiPaused: body.ignoreAiPaused ?? false,
      videoId: body.videoId || null,
      videoCaptionOverride: body.videoCaptionOverride || null,
      buttonLabel: body.buttonLabel?.trim() || null,
      buttonUrl: body.buttonUrl?.trim() || null,
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
    if (body.excludeTag !== undefined) rule.excludeTag = body.excludeTag || null;
    if (body.includeTag !== undefined) rule.includeTag = body.includeTag || null;
    if (body.delayMinutes !== undefined) rule.delayMinutes = Math.max(1, body.delayMinutes);
    if (body.cadenceSteps !== undefined) rule.cadenceSteps = this.sanitizeCadence(body.cadenceSteps);
    if (body.sendAtHour !== undefined) rule.sendAtHour = body.sendAtHour != null ? Math.min(23, Math.max(0, body.sendAtHour)) : null;
    if (body.sendAtMinute !== undefined) rule.sendAtMinute = body.sendAtMinute != null ? Math.min(59, Math.max(0, body.sendAtMinute)) : 0;
    if (body.mode !== undefined) rule.mode = body.mode === 'ai' ? 'ai' : 'manual';
    if (body.text !== undefined) rule.text = body.text || null;
    if (body.promptOverride !== undefined) rule.promptOverride = body.promptOverride || null;
    if (body.ignoreAiPaused !== undefined) rule.ignoreAiPaused = body.ignoreAiPaused;
    if (body.videoId !== undefined) rule.videoId = body.videoId || null;
    if (body.videoCaptionOverride !== undefined) rule.videoCaptionOverride = body.videoCaptionOverride || null;
    if (body.buttonLabel !== undefined) rule.buttonLabel = body.buttonLabel?.trim() || null;
    if (body.buttonUrl !== undefined) rule.buttonUrl = body.buttonUrl?.trim() || null;
    if (body.priority !== undefined) rule.priority = body.priority;

    if (rule.cadenceSteps?.length) this.assertCadenceTexts(rule.cadenceSteps, rule.mode);

    // Só exige texto quando não tem vídeo nem cadência (nesses casos o conteúdo
    // vem do vídeo ou de cada toque, não do campo único).
    if (!rule.videoId && !rule.cadenceSteps?.length && rule.mode === 'manual' && !rule.text?.trim() && rule.enabled) {
      throw new BadRequestException('Texto é obrigatório no modo manual');
    }

    await this.rulesRepo.save(rule);

    // Libera pra um novo ciclo só os leads que casam com a raia/campanha desta regra.
    let resetCount = 0;
    if (body.resetCycle) {
      const qb = this.leadsRepo
        .createQueryBuilder()
        .update(Lead)
        .set({ followupSentAt: null, followupStep: 0, followupNextAt: null })
        .where('agent_mode = :mode', { mode: 'sdr' })
        .andWhere('followup_sent_at IS NOT NULL');
      // Raias com IA pausada (ex.: "qualificado", pausada no handoff) só entram
      // no reset se a própria regra ignora esse portão — senão manteria o mesmo
      // bug do cron: regra pra reativar quem está pausado nunca liberava ninguém.
      // wa_stage='encerrado' é o MESMO momento (fim do handoff) que pausa a IA —
      // por isso segue a mesma exceção: sem ela, o próprio filtro do reset
      // excluía sempre o público-alvo de uma campanha de reativação pós-handoff
      // (nenhum cron real filtra por wa_stage, então essa trava não tinha origem
      // funcional, só sobrou de um filtro antigo mais restritivo).
      if (!rule.ignoreAiPaused) {
        qb.andWhere('ai_paused = false').andWhere("wa_stage != 'encerrado'");
      }
      if (rule.kanbanStage) qb.andWhere('kanban_stage = :stage', { stage: rule.kanbanStage });
      if (rule.utmCampaign) qb.andWhere('utm_campaign = :campaign', { campaign: rule.utmCampaign });
      if (rule.adTitle) qb.andWhere('ctwa_ad_title = :adTitle', { adTitle: rule.adTitle });
      if (rule.createdAfter) qb.andWhere('created_at >= :createdAfter', { createdAfter: rule.createdAfter });
      if (rule.excludeTag) qb.andWhere('(tags IS NULL OR NOT (tags @> :excludeTag::jsonb))', { excludeTag: JSON.stringify([rule.excludeTag]) });
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

  // Disparo manual único: manda a mensagem da regra pra todos os leads que
  // casam com o filtro dela agora, ignorando os portões do cron automático
  // (respondeu ou não, IA pausada, já recebeu follow-up antes). Usado pra
  // campanhas de reativação pontuais (ex.: raia "qualificado" inteira).
  @Post('rules/:id/broadcast-now')
  async broadcastNow(@Param('id') id: string) {
    return this.followupService.broadcastNow(id);
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
