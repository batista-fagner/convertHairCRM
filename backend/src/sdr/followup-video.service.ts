import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { FollowupVideo } from '../common/entities/followup-video.entity';
import { FollowupRule } from '../common/entities/followup-rule.entity';

// Vídeos pesados demoram/falham no envio pelo WhatsApp e pesam no storage.
const MAX_VIDEO_SIZE_MB = 50;

// @types/multer não está instalado no projeto — tipo mínimo do arquivo que o
// FileInterceptor entrega (buffer em memória por padrão).
export interface UploadedVideoFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@Injectable()
export class FollowupVideoService {
  private readonly logger = new Logger(FollowupVideoService.name);
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;

  constructor(
    @InjectRepository(FollowupVideo) private readonly videoRepo: Repository<FollowupVideo>,
    @InjectRepository(FollowupRule) private readonly ruleRepo: Repository<FollowupRule>,
    private readonly config: ConfigService,
  ) {
    this.supabase = createClient(
      config.get('SUPABASE_URL') ?? '',
      config.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    this.bucket = config.get('SDR_VIDEO_BUCKET') ?? 'sdr-followup-videos';
  }

  list(): Promise<FollowupVideo[]> {
    return this.videoRepo.find({ order: { createdAt: 'DESC' } });
  }

  // Cria o bucket (público) na 1ª vez, se ainda não existir — evita passo manual
  // no painel do Supabase. Idempotente: ignora o erro "já existe".
  private async ensureBucket(): Promise<void> {
    const { data } = await this.supabase.storage.getBucket(this.bucket);
    if (data) return;
    const { error } = await this.supabase.storage.createBucket(this.bucket, {
      public: true,
      fileSizeLimit: MAX_VIDEO_SIZE_MB * 1024 * 1024,
      allowedMimeTypes: ['video/mp4'],
    });
    // Corrida entre requisições simultâneas pode dar "already exists" — ok.
    if (error && !/already exists/i.test(error.message)) {
      this.logger.error(`Erro ao criar bucket ${this.bucket}: ${error.message}`);
      throw new BadRequestException(`Falha ao preparar o storage: ${error.message}`);
    }
  }

  async upload(file: UploadedVideoFile, name: string, caption?: string): Promise<FollowupVideo> {
    if (!file) throw new BadRequestException('Arquivo não enviado');
    if (!name?.trim()) throw new BadRequestException('Nome é obrigatório');
    // WhatsApp só envia vídeo em MP4 (H.264) de forma confiável — outros formatos falham silenciosamente.
    if (file.mimetype !== 'video/mp4') {
      throw new BadRequestException('O vídeo precisa estar em MP4. Converta antes de subir.');
    }
    if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      throw new BadRequestException(`Vídeo muito grande (${mb}MB). Limite é ${MAX_VIDEO_SIZE_MB}MB.`);
    }

    await this.ensureBucket();
    const storagePath = `${randomUUID()}.mp4`;
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(storagePath, file.buffer, { contentType: 'video/mp4', upsert: false });
    if (error) {
      this.logger.error(`Erro ao subir vídeo pro storage: ${error.message}`);
      throw new BadRequestException(`Falha no upload: ${error.message}`);
    }

    const { data: urlData } = this.supabase.storage.from(this.bucket).getPublicUrl(storagePath);
    return this.videoRepo.save(this.videoRepo.create({
      name: name.trim(),
      caption: caption?.trim() || null,
      storagePath,
      publicUrl: urlData.publicUrl,
    }));
  }

  async update(id: string, patch: { name?: string; caption?: string }): Promise<FollowupVideo> {
    const video = await this.videoRepo.findOne({ where: { id } });
    if (!video) throw new NotFoundException('Vídeo não encontrado');
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new BadRequestException('Nome não pode ficar vazio');
      video.name = patch.name.trim();
    }
    if (patch.caption !== undefined) video.caption = patch.caption?.trim() || null;
    return this.videoRepo.save(video);
  }

  async delete(id: string): Promise<void> {
    const video = await this.videoRepo.findOne({ where: { id } });
    if (!video) throw new NotFoundException('Vídeo não encontrado');

    // Recusa se alguma regra ainda usa esse vídeo — evita regra apontando pra vídeo fantasma.
    const inUse = await this.ruleRepo.count({ where: { videoId: id } });
    if (inUse > 0) {
      throw new BadRequestException(`Esse vídeo está em uso por ${inUse} regra(s) de follow-up. Remova o vídeo dessas regras antes de excluir.`);
    }

    const { error } = await this.supabase.storage.from(this.bucket).remove([video.storagePath]);
    if (error) this.logger.warn(`Erro ao remover vídeo do storage (segue com delete no banco): ${error.message}`);
    await this.videoRepo.delete(id);
  }
}
