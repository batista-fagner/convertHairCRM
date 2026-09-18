import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UploadedFile, UseInterceptors, HttpCode, Redirect, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AudioAssetService } from './audio-asset.service';
import type { UploadedAudioFile } from './audio-asset.service';
import { AudioAssetKind } from './audio-asset.entity';
import { VideoEditService } from './video-edit.service';

@Controller('video-edit')
export class VideoEditController {
  constructor(
    private readonly audio: AudioAssetService,
    private readonly videoEdit: VideoEditService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Jobs de edição
  // ─────────────────────────────────────────────────────────────────────

  @Post('upload-url')
  createUploadUrl(@Body() body: { filename?: string; contentType?: string }) {
    return this.videoEdit.createUploadUrl(body.filename ?? '', body.contentType);
  }

  @Post()
  create(@Body() body: { name?: string; instruction?: string; storagePath?: string }) {
    return this.videoEdit.create(body);
  }

  @Get()
  findAll() {
    return this.videoEdit.findAll();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Biblioteca de áudio (trilhas e efeitos usados nas edições)
  //
  // Precisa vir ANTES de ':id' abaixo — o Nest casa rotas na ordem de
  // declaração, e ':id' (1 segmento) bateria com GET /video-edit/audio antes
  // de chegar na rota certa.
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

  // ─────────────────────────────────────────────────────────────────────
  // Jobs de edição — rotas de :id, depois de 'audio' de propósito (ver acima)
  // ─────────────────────────────────────────────────────────────────────

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.videoEdit.findOne(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.videoEdit.remove(id);
  }

  @Post(':id/render')
  render(@Param('id') id: string) {
    return this.videoEdit.render(id);
  }

  // Redireciona pro objeto no R2 — já sobe com Content-Disposition:attachment
  // (ver render-service/src/render.js), então o navegador baixa direto do R2
  // sem o vídeo inteiro passar pelo backend.
  @Get(':id/download')
  @Redirect()
  async download(@Param('id') id: string) {
    const job = await this.videoEdit.findOne(id);
    if (!job.outputUrl) {
      throw new BadRequestException('Essa edição ainda não tem um vídeo renderizado');
    }
    return { url: job.outputUrl, statusCode: 302 };
  }
}
