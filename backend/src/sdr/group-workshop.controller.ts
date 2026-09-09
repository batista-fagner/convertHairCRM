import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { GroupWorkshopService } from './group-workshop.service';

@Controller('group-workshop')
export class GroupWorkshopController {
  constructor(private readonly service: GroupWorkshopService) {}

  @Get('leads')
  async listLeads(@Query('groupJid') groupJid?: string) {
    return this.service.listLeads(groupJid);
  }

  @Get('groups')
  async listGroups() {
    return this.service.listGroups();
  }

  @Get('broadcast-status')
  async broadcastStatus() {
    return { running: this.service.isBroadcasting() };
  }

  @Post('broadcast')
  async broadcast(@Body() body: { text: string; minDelaySec?: number; maxDelaySec?: number; groupJid?: string; videoId?: string }) {
    return this.service.broadcast(body.text, body.minDelaySec ?? 10, body.maxDelaySec ?? 30, body.groupJid, body.videoId);
  }

  @Post('broadcast/cancel')
  async cancelBroadcast() {
    return this.service.cancelBroadcast();
  }

  @Get('quiz-stats')
  async getQuizStats() {
    return this.service.getQuizStats();
  }

  @Post('leads/:id/analyze')
  async analyzeLead(@Param('id') id: string) {
    return this.service.analyzeLead(id);
  }

  @Post('analyze-all')
  async analyzeAll(@Query('force') force?: string) {
    return this.service.analyzeAll(force === 'true');
  }
}
