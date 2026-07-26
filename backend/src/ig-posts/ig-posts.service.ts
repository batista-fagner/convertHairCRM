import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { IgPost, IgPostMediaType } from './ig-post.entity';

const IG_API = 'https://graph.instagram.com/v21.0';
const MAX_IMAGE_SIZE_MB = 20;
const MAX_VIDEO_SIZE_MB = 100;
// Cada tentativa do cron de processamento acontece a cada 30s — 40 tentativas
// ≈ 20min de espera antes de desistir de um vídeo travado no Instagram.
const MAX_PROCESSING_ATTEMPTS = 40;

// @types/multer não está instalado no projeto — tipo mínimo do arquivo que o
// FileInterceptor entrega (buffer em memória por padrão).
export interface UploadedPostFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

export interface CreateIgPostDto {
  mediaType: IgPostMediaType;
  caption?: string;
  scheduledAt?: string | null;
}

@Injectable()
export class IgPostsService {
  private readonly logger = new Logger(IgPostsService.name);
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;

  constructor(
    @InjectRepository(IgPost) private readonly repo: Repository<IgPost>,
    private readonly config: ConfigService,
  ) {
    this.supabase = createClient(
      config.get('SUPABASE_URL') ?? '',
      config.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    this.bucket = config.get('IG_POSTS_BUCKET') ?? 'ig-posts';
  }

  private get igToken() {
    return this.config.get<string>('IG_TOKEN');
  }

  private async getIgUserId(): Promise<string> {
    const stored = this.config.get<string>('IG_USER_ID');
    if (stored) return stored;
    const res = await axios.get(`${IG_API}/me`, {
      params: { fields: 'id,username', access_token: this.igToken },
    });
    const igId = res.data.id;
    if (igId) return igId;
    throw new Error('Conta Instagram não encontrada. Configure IG_USER_ID no .env');
  }

  list(): Promise<IgPost[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  // Cria o bucket (público) na 1ª vez, se ainda não existir — evita passo manual no painel do Supabase.
  private async ensureBucket(): Promise<void> {
    const { data } = await this.supabase.storage.getBucket(this.bucket);
    if (data) return;
    const { error } = await this.supabase.storage.createBucket(this.bucket, {
      public: true,
      fileSizeLimit: MAX_VIDEO_SIZE_MB * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'video/mp4'],
    });
    if (error && !/already exists/i.test(error.message)) {
      this.logger.error(`Erro ao criar bucket ${this.bucket}: ${error.message}`);
      throw new BadRequestException(`Falha ao preparar o storage: ${error.message}`);
    }
  }

  private validateFile(file: UploadedPostFile, mediaType: IgPostMediaType) {
    if (!file) throw new BadRequestException('Arquivo não enviado');
    if (mediaType === 'IMAGE') {
      if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
        throw new BadRequestException('Imagem precisa ser JPEG ou PNG.');
      }
      if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        throw new BadRequestException(`Imagem muito grande. Limite é ${MAX_IMAGE_SIZE_MB}MB.`);
      }
    } else {
      if (file.mimetype !== 'video/mp4') {
        throw new BadRequestException('O vídeo precisa estar em MP4. Converta antes de subir.');
      }
      if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
        const mb = (file.size / (1024 * 1024)).toFixed(1);
        throw new BadRequestException(`Vídeo muito grande (${mb}MB). Limite é ${MAX_VIDEO_SIZE_MB}MB.`);
      }
    }
  }

  async create(file: UploadedPostFile, dto: CreateIgPostDto): Promise<IgPost> {
    const mediaType: IgPostMediaType = dto.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE';
    this.validateFile(file, mediaType);

    await this.ensureBucket();
    const ext = mediaType === 'VIDEO' ? 'mp4' : file.mimetype === 'image/png' ? 'png' : 'jpg';
    const storagePath = `${randomUUID()}.${ext}`;
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) {
      this.logger.error(`Erro ao subir mídia pro storage: ${error.message}`);
      throw new BadRequestException(`Falha no upload: ${error.message}`);
    }

    const { data: urlData } = this.supabase.storage.from(this.bucket).getPublicUrl(storagePath);
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

    const post = await this.repo.save(
      this.repo.create({
        mediaType,
        caption: dto.caption?.trim() || null,
        storagePath,
        publicUrl: urlData.publicUrl,
        status: 'scheduled',
        scheduledAt,
      }),
    );

    // Sem agendamento (scheduledAt vazio) = publica assim que o usuário confirma
    // o upload, sem esperar o próximo tick do cron. Roda em segundo plano —
    // não bloqueia a resposta HTTP do upload.
    if (!scheduledAt) {
      this.startPublish(post.id).catch((err) =>
        this.logger.error(`Erro ao iniciar publicação do post ${post.id}: ${err.message}`),
      );
    }

    return post;
  }

  async update(id: string, patch: { caption?: string; scheduledAt?: string | null }): Promise<IgPost> {
    const post = await this.repo.findOne({ where: { id } });
    if (!post) throw new NotFoundException('Post não encontrado');
    if (post.status === 'published') {
      throw new BadRequestException('Post já publicado — não é possível editar.');
    }
    if (patch.caption !== undefined) post.caption = patch.caption?.trim() || null;
    if (patch.scheduledAt !== undefined) post.scheduledAt = patch.scheduledAt ? new Date(patch.scheduledAt) : null;
    return this.repo.save(post);
  }

  async remove(id: string): Promise<void> {
    const post = await this.repo.findOne({ where: { id } });
    if (!post) throw new NotFoundException('Post não encontrado');
    const { error } = await this.supabase.storage.from(this.bucket).remove([post.storagePath]);
    if (error) this.logger.warn(`Erro ao remover mídia do storage (segue com delete no banco): ${error.message}`);
    await this.repo.delete(id);
  }

  /** Botão "Publicar agora" — força o início da publicação, inclusive pra retry depois de falha. */
  async publishNow(id: string): Promise<IgPost | null> {
    const post = await this.repo.findOne({ where: { id } });
    if (!post) throw new NotFoundException('Post não encontrado');
    if (post.status === 'published') throw new BadRequestException('Post já publicado.');
    if (post.status === 'processing') throw new BadRequestException('Post já está processando no Instagram.');
    await this.repo.update(id, { attempts: 0, errorMessage: null });
    await this.startPublish(id);
    return this.repo.findOne({ where: { id } });
  }

  /** Cria o container de mídia no Instagram (1ª etapa do Content Publishing). */
  private async startPublish(id: string): Promise<void> {
    const post = await this.repo.findOne({ where: { id } });
    if (!post) return;
    try {
      const igUserId = await this.getIgUserId();
      const params: Record<string, string> = {
        caption: post.caption || '',
        access_token: this.igToken || '',
      };
      if (post.mediaType === 'IMAGE') {
        params.image_url = post.publicUrl;
      } else {
        // Todo vídeo publicado via Content Publishing API vira Reels — não
        // existe mais "vídeo de feed" separado desde a mudança do Meta em 2022.
        params.media_type = 'REELS';
        params.video_url = post.publicUrl;
      }
      const res = await axios.post(`${IG_API}/${igUserId}/media`, null, { params });
      const containerId = res.data.id;
      await this.repo.update(id, { status: 'processing', containerId, attempts: 0, errorMessage: null });
      this.logger.log(`Container criado pro post ${id} (containerId=${containerId})`);
    } catch (err: any) {
      const message = err.response?.data?.error?.message || err.message;
      this.logger.error(`Erro ao criar container do post ${id}: ${message}`);
      await this.repo.update(id, { status: 'failed', errorMessage: message });
    }
  }

  /** Cron: dispara posts agendados cuja hora já chegou. */
  @Cron('*/1 * * * *')
  async checkScheduled(): Promise<void> {
    const due = await this.repo
      .createQueryBuilder('p')
      .where('p.status = :status', { status: 'scheduled' })
      .andWhere('p.scheduled_at IS NOT NULL')
      .andWhere('p.scheduled_at <= :now', { now: new Date() })
      .getMany();

    for (const post of due) {
      this.logger.log(`Publicando post agendado ${post.id} (agendado pra ${post.scheduledAt})`);
      await this.startPublish(post.id);
    }
  }

  /** Cron: faz o polling do processamento do container até o Instagram terminar (essencial pra vídeo, que é assíncrono). */
  @Cron('*/30 * * * * *')
  async checkProcessing(): Promise<void> {
    const processing = await this.repo.find({ where: { status: 'processing' } });
    if (processing.length === 0) return;

    for (const post of processing) {
      try {
        const res = await axios.get(`${IG_API}/${post.containerId}`, {
          params: { fields: 'status_code', access_token: this.igToken },
        });
        const statusCode = res.data.status_code as string;

        if (statusCode === 'FINISHED') {
          const igUserId = await this.getIgUserId();
          const pub = await axios.post(`${IG_API}/${igUserId}/media_publish`, null, {
            params: { creation_id: post.containerId, access_token: this.igToken },
          });
          await this.repo.update(post.id, {
            status: 'published',
            igMediaId: pub.data.id,
            publishedAt: new Date(),
          });
          this.logger.log(`Post ${post.id} publicado no Instagram (mediaId=${pub.data.id})`);
        } else if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
          await this.repo.update(post.id, {
            status: 'failed',
            errorMessage: `Processamento falhou no Instagram (status: ${statusCode})`,
          });
          this.logger.warn(`Post ${post.id} falhou no processamento do Instagram (${statusCode})`);
        } else {
          const attempts = post.attempts + 1;
          if (attempts > MAX_PROCESSING_ATTEMPTS) {
            await this.repo.update(post.id, {
              status: 'failed',
              errorMessage: 'Timeout aguardando o Instagram processar o vídeo.',
            });
            this.logger.warn(`Post ${post.id} desistiu após ${attempts} tentativas de polling`);
          } else {
            await this.repo.update(post.id, { attempts });
          }
        }
      } catch (err: any) {
        this.logger.error(`Erro ao checar status do post ${post.id}: ${err.response?.data?.error?.message || err.message}`);
      }
    }
  }
}
