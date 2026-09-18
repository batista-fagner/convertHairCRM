import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { VideoEditJob } from './video-edit-job.entity';
import { EditPlan, EditPlanTranscript } from './edit-plan.types';
import { VideoEditQueueService } from './video-edit-queue.service';

const ALLOWED_EXT = new Set(['mp4', 'mov', 'm4v', 'webm']);
const UPLOAD_URL_EXPIRES_SEC = 900;

@Injectable()
export class VideoEditService {
  private readonly logger = new Logger(VideoEditService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string;

  constructor(
    @InjectRepository(VideoEditJob) private repo: Repository<VideoEditJob>,
    private readonly queue: VideoEditQueueService,
    config: ConfigService,
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
    this.publicUrlBase = (config.get<string>('R2_PUBLIC_URL') ?? '').replace(/\/$/, '');
  }

  // URL de PUT assinada — o navegador sobe o vídeo direto pro R2, sem passar
  // pelo backend. Um vídeo de 300MB pelo backend (que também atende webhook da
  // Meta e SSE do WhatsApp) seria queda de funil esperando acontecer.
  async createUploadUrl(filename: string, contentType?: string): Promise<{ uploadUrl: string; storagePath: string }> {
    const ext = (filename?.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      throw new BadRequestException('Formato inválido — use MP4, MOV, M4V ou WEBM');
    }

    const storagePath = `video-edit/source/${randomUUID()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storagePath,
      ...(contentType ? { ContentType: contentType } : {}),
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: UPLOAD_URL_EXPIRES_SEC });
    return { uploadUrl, storagePath };
  }

  async create(dto: { name?: string; instruction?: string; storagePath?: string }): Promise<VideoEditJob> {
    if (!dto.storagePath) throw new BadRequestException('storagePath é obrigatório — suba o vídeo primeiro via upload-url');

    const sourceUrl = `${this.publicUrlBase}/${dto.storagePath}`;
    const job = this.repo.create({
      name: (dto.name ?? '').trim() || 'Vídeo sem nome',
      instruction: (dto.instruction ?? '').trim(),
      sourceStoragePath: dto.storagePath,
      sourceUrl,
      status: 'uploaded',
      progress: 0,
    });
    const saved = await this.repo.save(job);

    await this.queue.enqueuePrepare(saved.id, sourceUrl);
    this.logger.log(`Job de edição criado: ${saved.id} (${saved.name})`);

    return saved;
  }

  findAll(): Promise<VideoEditJob[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<VideoEditJob> {
    const job = await this.repo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Edição não encontrada');
    return job;
  }

  async remove(id: string): Promise<void> {
    const job = await this.findOne(id);

    const keys = [job.sourceStoragePath, job.normStoragePath, job.audioStoragePath, job.outputStoragePath]
      .filter((k): k is string => Boolean(k));
    await Promise.all(
      keys.map((Key) =>
        this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key })).catch((err) =>
          this.logger.warn(`Não foi possível apagar ${Key} do R2: ${err.message}`),
        ),
      ),
    );

    await this.repo.delete(id);
  }

  // ── Chamados pelo consumidor de video-edit-analyze ──────────────────────

  async markTranscribing(id: string): Promise<void> {
    await this.repo.update(id, { status: 'transcribing', stage: 'transcrevendo áudio' });
  }

  async markPlanning(id: string, transcript: EditPlanTranscript): Promise<void> {
    await this.repo.update(id, { status: 'planning', stage: 'montando o roteiro de edição', transcript });
  }

  async savePlan(id: string, plan: EditPlan, planModel: string): Promise<void> {
    await this.repo.update(id, { status: 'plan_ready', stage: null, plan, planModel, progress: 100 });
  }

  async markFailed(id: string, message: string): Promise<void> {
    this.logger.error(`Job ${id} falhou: ${message}`);
    await this.repo.update(id, { status: 'failed', errorMessage: message });
  }
}
