import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SocialSellingService, SocialSellingConfig } from './social-selling.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { Public } from '../auth/auth.decorators';

/** Rotas chamadas pela extensão ConvertIQ (fora do JWT, protegidas pela x-api-key, igual à prospecção). */
@Public()
@UseGuards(ApiKeyGuard)
@Controller('social-selling/ext')
export class SocialSellingExtController {
  constructor(private readonly social: SocialSellingService) {}

  @Get('config')
  config() {
    return this.social.extensionConfig();
  }

  @Post('followers')
  followers(@Body() body: { usernames?: string[]; fullNames?: Record<string, string> }) {
    return this.social.registerFollowers(body || {});
  }

  @Get('next-dm')
  nextDm() {
    return this.social.nextDm();
  }

  @Post('dm-result')
  dmResult(@Body() body: { username?: string; ok?: boolean; message?: string; fullName?: string; error?: string; kind?: 'dm' | 'followup' }) {
    return this.social.dmResult(body || {});
  }

  @Post('status')
  status(@Body() body: { event?: string; detail?: string }) {
    return this.social.reportExtensionStatus(body || {});
  }
}

/** Tela "Social selling" do CRM. */
@Controller('social-selling')
export class SocialSellingController {
  constructor(private readonly social: SocialSellingService) {}

  @Get()
  overview() {
    return this.social.overview();
  }

  @Get('leads')
  list(
    @Query('temperature') temperature?: string,
    @Query('status') status?: string,
    @Query('signal') signal?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.social.list({ temperature, status, signal, search, page: Number(page) || 1 });
  }

  @Get('leads/:id/signals')
  signals(@Param('id') id: string) {
    return this.social.signalsOf(id);
  }

  @Put('config')
  saveConfig(@Body() body: Partial<SocialSellingConfig>) {
    return this.social.saveConfig(body || {});
  }

  @Post('preview')
  preview(@Body() body: { template?: string; kind?: 'comment' | 'follow'; leadId?: string }) {
    return this.social.preview(body || {});
  }

  @Post('leads/:id/approve')
  approve(@Param('id') id: string) {
    return this.social.approve(id);
  }

  @Post('leads/:id/discard')
  discard(@Param('id') id: string) {
    return this.social.discard(id);
  }

  @Post('leads/:id/restore')
  restore(@Param('id') id: string) {
    return this.social.restore(id);
  }
}
