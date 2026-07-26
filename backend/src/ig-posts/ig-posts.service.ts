import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { IgPost, IgPostMediaType } from './ig-post.entity';

const IG_API = 'https://graph.instagram.com/v21.0';
const MAX_IMAGE_SIZE_MB = 20;
// R2 não tem o teto de 50MB do plano Free do Supabase — sem essa restrição,
// pode subir até o valor que o usuário pediu.
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

/**
 * Sem isso, uma chamada do Supabase Storage que trava (sem responder e sem dar
 * erro — ex.: API lenta/instável) deixa a requisição HTTP inteira pendurada
 * pra sempre, sem nunca devolver resposta pro frontend. Não cancela a chamada
 * de verdade, mas garante que o handler sempre segue em frente com um erro claro.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout (${ms / 1000}s) em: ${label}`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

@Injectable()
export class IgPostsService {
  private readonly logger = new Logger(IgPostsService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string;

  constructor(
    @InjectRepository(IgPost) private readonly repo: Repository<IgPost>,
    private readonly config: ConfigService,
  ) {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: config.get('R2_ENDPOINT'),
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID') ?? '',
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY') ?? '',
      },
    });
    this.bucket = config.get('R2_BUCKET') ?? 'converthair-ig';
    // Sem barra no final — montamos a URL como `${base}/${storagePath}`.
    this.publicUrlBase = (config.get<string>('R2_PUBLIC_URL') ?? '').replace(/\/$/, '');
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
    this.logger.log(`create: recebido ${mediaType} de ${(file.size / 1024 / 1024).toFixed(1)}MB, iniciando upload...`);

    const ext = mediaType === 'VIDEO' ? 'mp4' : file.mimetype === 'image/png' ? 'png' : 'jpg';
    const storagePath = `${randomUUID()}.${ext}`;
    this.logger.log(`create: enviando pro R2 (${storagePath})...`);
    // Vídeo grande pode levar mais tempo — timeout generoso (2min) só pra
    // garantir que a requisição HTTP nunca fica pendurada pra sempre.
    try {
      await withTimeout(
        this.s3.send(new PutObjectCommand({
          Bucket: this.bucket,
          Key: storagePath,
          Body: file.buffer,
          ContentType: file.mimetype,
        })),
        120_000,
        's3.putObject',
      );
    } catch (err: any) {
      this.logger.error(`Erro ao subir mídia pro R2: ${err.message}`);
      throw new BadRequestException(`Falha no upload: ${err.message}`);
    }
    this.logger.log(`create: upload concluído`);

    const publicUrl = `${this.publicUrlBase}/${storagePath}`;
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

    const post = await this.repo.save(
      this.repo.create({
        mediaType,
        caption: dto.caption?.trim() || null,
        storagePath,
        publicUrl,
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
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: post.storagePath }));
    } catch (err: any) {
      this.logger.warn(`Erro ao remover mídia do R2 (segue com delete no banco): ${err.message}`);
    }
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
