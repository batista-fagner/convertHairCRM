import { Controller, Get, Post, Patch, Delete, Body, Param, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IgPostsService } from './ig-posts.service';
import type { UploadedPostFile } from './ig-posts.service';

@Controller('ig-posts')
export class IgPostsController {
  constructor(private readonly service: IgPostsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async create(
    @UploadedFile() file: UploadedPostFile,
    @Body('mediaType') mediaType: string,
    @Body('caption') caption?: string,
    @Body('scheduledAt') scheduledAt?: string,
  ) {
    return this.service.create(file, {
      mediaType: mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
      caption,
      scheduledAt: scheduledAt || null,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { caption?: string; scheduledAt?: string | null }) {
    return this.service.update(id, body);
  }

  @Post(':id/publish-now')
  publishNow(@Param('id') id: string) {
    return this.service.publishNow(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { ok: true };
  }
}
