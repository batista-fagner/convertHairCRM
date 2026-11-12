import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { IgAuditService } from './ig-audit.service';

@Controller('ig-audits')
export class IgAuditController {
  constructor(private readonly service: IgAuditService) {}

  @Get()
  list() {
    return this.service.list();
  }

  // Prompt editável (antes de ':id' pra não casar com ele)
  @Get('config/prompt')
  getPrompt() {
    return this.service.getPrompt();
  }

  @Put('config/prompt')
  setPrompt(@Body() body: { value: string }) {
    return this.service.setPrompt(body?.value ?? '');
  }

  @Post()
  start(@Body() body: { username: string }) {
    return this.service.start(body?.username || '');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post(':id/rerun')
  rerun(@Param('id') id: string) {
    return this.service.rerun(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { stage?: string; notes?: string | null }) {
    return this.service.update(id, body || {});
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { success: true };
  }
}
