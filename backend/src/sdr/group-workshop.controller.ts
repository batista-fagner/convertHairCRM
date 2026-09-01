import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { GroupWorkshopService } from './group-workshop.service';

@Controller('group-workshop')
export class GroupWorkshopController {
  constructor(private readonly service: GroupWorkshopService) {}

  @Get('leads')
  async listLeads() {
    return this.service.listLeads();
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
