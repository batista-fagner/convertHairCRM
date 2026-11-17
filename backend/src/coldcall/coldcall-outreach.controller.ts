import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ColdCallOutreachService, TEMPLATE_VARIABLES } from './coldcall-outreach.service';

@Controller('coldcall/outreach')
export class ColdCallOutreachController {
  constructor(private readonly outreach: ColdCallOutreachService) {}

  @Get()
  async overview(@Query('list') list?: string) {
    return { ...(await this.outreach.overview(list || null)), variables: TEMPLATE_VARIABLES };
  }

  // O token nunca volta pro front, só o status da conexão.
  @Put('token')
  async setToken(@Body() body: { token?: string }) {
    return this.outreach.setToken(body?.token || '');
  }

  @Put('settings')
  async saveSettings(@Body() body: { template?: string; delaySec?: number; dailyLimit?: number; startHour?: number; endHour?: number }) {
    return this.outreach.saveSettings(body || {});
  }

  @Post('preview')
  async preview(@Body() body: { template?: string; listName?: string | null }) {
    return this.outreach.preview(body?.template || '', body?.listName || null);
  }

  @Post('start')
  async start(@Body() body: { listName?: string | null; size: number; template?: string; delaySec?: number }) {
    return this.outreach.start(body);
  }

  @Post('pause')
  async pause() {
    return this.outreach.pause();
  }

  @Post('resume')
  async resume() {
    return this.outreach.resume();
  }

  @Post('cancel')
  async cancel() {
    return this.outreach.cancel();
  }

  @Post('retry-failed')
  async retryFailed(@Body() body: { listName?: string | null }) {
    return this.outreach.retryFailed(body?.listName || null);
  }
}
