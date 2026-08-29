import { Controller, Get, Post, Put, Delete, Param, Body, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { QuizService } from './quiz.service';
import type { UploadedImageFile } from './quiz.service';
import { Quiz } from '../common/entities/quiz.entity';

@Controller('quiz')
export class QuizController {
  constructor(private quizService: QuizService) {}

  // --- CRM (builder) ---
  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadImage(@UploadedFile() file: UploadedImageFile) {
    return this.quizService.uploadImage(file);
  }

  @Get()
  findAll() {
    return this.quizService.findAll();
  }

  @Get('id/:id')
  findById(@Param('id') id: string) {
    return this.quizService.findById(id);
  }

  @Post()
  create(@Body() dto: Partial<Quiz>) {
    return this.quizService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Partial<Quiz>) {
    return this.quizService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.quizService.remove(id);
  }

  // --- Público (ConvertHairPage) ---
  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.quizService.findBySlug(slug);
  }

  @Post(':slug/submit')
  submit(@Param('slug') slug: string, @Body() dto: any, @Req() req: Request) {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const userAgent = req.headers['user-agent'] as string | undefined;
    return this.quizService.submit(slug, { ...dto, clientIp, userAgent });
  }
}
