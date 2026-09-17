import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UploadedFile, UseInterceptors, HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AudioAssetService } from './audio-asset.service';
import type { UploadedAudioFile } from './audio-asset.service';
import { AudioAssetKind } from './audio-asset.entity';

@Controller('video-edit')
export class VideoEditController {
  constructor(private readonly audio: AudioAssetService) {}

  // ─────────────────────────────────────────────────────────────────────
  // Biblioteca de áudio (trilhas e efeitos usados nas edições)
  // ─────────────────────────────────────────────────────────────────────

  @Get('audio')
  listAudio() {
    return this.audio.list();
  }

  @Post('audio')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadAudio(
    @UploadedFile() file: UploadedAudioFile,
    @Body() body: { name?: string; kind?: AudioAssetKind; durationSec?: string },
  ) {
    // multipart entrega tudo como string — durationSec vem medido no navegador.
    const duration = body.durationSec ? Number(body.durationSec) : null;
    return this.audio.upload(file, body.name ?? '', body.kind ?? 'music', duration);
  }

  @Patch('audio/:id')
  updateAudio(@Param('id') id: string, @Body() body: { name?: string; kind?: AudioAssetKind }) {
    return this.audio.update(id, body);
  }

  @Delete('audio/:id')
  @HttpCode(204)
  async removeAudio(@Param('id') id: string) {
    await this.audio.remove(id);
  }
}
