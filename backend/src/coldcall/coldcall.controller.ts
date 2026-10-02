import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ColdCallService } from './coldcall.service';

// @types/multer não está instalado no projeto (mesmo caso do ig-posts) —
// tipo mínimo do arquivo que o FileInterceptor entrega em memória.
interface UploadedCsvFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller('coldcall')
export class ColdCallController {
  constructor(private readonly coldCallService: ColdCallService) {}

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async importCsv(@UploadedFile() file: UploadedCsvFile, @Body() body: { listName?: string }) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    return this.coldCallService.importCsv(file.buffer.toString('utf-8'), body?.listName);
  }

  @Get('lists')
  async getLists() {
    return this.coldCallService.getLists();
  }

  @Get('kanban')
  async getKanban(@Query('list') list?: string) {
    return this.coldCallService.findKanban(list);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { kanbanStage?: string; assignedTo?: string | null; nextContactAt?: string | null; notes?: string | null },
  ) {
    const data: { kanbanStage?: string; assignedTo?: string | null; nextContactAt?: Date | null; notes?: string | null } = {};
    if ('kanbanStage' in body && body.kanbanStage) data.kanbanStage = body.kanbanStage;
    if ('assignedTo' in body) data.assignedTo = body.assignedTo?.trim() || null;
    if ('nextContactAt' in body) data.nextContactAt = body.nextContactAt ? new Date(body.nextContactAt) : null;
    if ('notes' in body) data.notes = body.notes ?? null;
    return this.coldCallService.update(id, data);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.coldCallService.remove(id);
    return { success: true };
  }

  // Raias customizadas — mesmo padrão do Kanban de leads (kanban-stages).
  @Get('stages')
  async getStages() {
    return this.coldCallService.getCustomStages();
  }

  @Post('stages')
  async createStage(@Body() body: { title: string }) {
    return this.coldCallService.createCustomStage(body.title || '');
  }

  @Patch('stages/:id')
  async renameStage(@Param('id') id: string, @Body() body: { title: string }) {
    return this.coldCallService.renameCustomStage(id, body.title || '');
  }

  @Delete('stages/:id')
  async deleteStage(@Param('id') id: string) {
    await this.coldCallService.deleteCustomStage(id);
    return { success: true };
  }

  @Patch('stages/:id/move')
  async moveStage(@Param('id') id: string, @Body() body: { direction?: 'left' | 'right' }) {
    if (body.direction !== 'left' && body.direction !== 'right') {
      throw new BadRequestException('direction deve ser "left" ou "right"');
    }
    return this.coldCallService.moveStage(id, body.direction);
  }
}
