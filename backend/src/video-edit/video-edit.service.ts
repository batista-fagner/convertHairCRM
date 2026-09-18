import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { LessThan, In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { VideoEditJob, VideoEditJobStatus } from './video-edit-job.entity';
import { EditPlan, EditPlanTranscript } from './edit-plan.types';
import { VideoEditQueueService } from './video-edit-queue.service';
import { AudioAssetService } from './audio-asset.service';
import { buildHookSegment, pickDisplayWordIdx } from './edit-plan-builder';
import { validateEditPlan } from './edit-plan.validate';

const ALLOWED_EXT = new Set(['mp4', 'mov', 'm4v', 'webm']);
const UPLOAD_URL_EXPIRES_SEC = 900;

// Job travado num estado transitório por mais que isso é considerado morto —
// cobre tanto uma normalização/transcrição que nunca terminou quanto um
// render que ficou pendurado a meio caminho (ver checkStuckJobs()).
const STUCK_THRESHOLD_MIN = 45;
const TRANSIENT_STATUSES: VideoEditJobStatus[] = [
  'preparing', 'audio_ready', 'transcribing', 'planning', 'queued', 'rendering',
];

export interface PlanUpdateDto {
  // Reajuste manual do gancho (Etapa 6) — índices na transcrição, mesma
  // convenção da IA (ver edit-plan-draft.types.ts), mas resolvido aqui sem
  // chamar o modelo: um retrim é puramente mecânico.
  hookStartWordIdx?: number;
  hookEndWordIdx?: number;
  removeZoomIndex?: number;
  musicAssetId?: string | null;
  musicVolume?: number;
  sfxAssetId?: string | null;
  sfxVolume?: number;
  captionOffsetSec?: number;
}

@Injectable()
export class VideoEditService {
  private readonly logger = new Logger(VideoEditService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string;

  constructor(
    @InjectRepository(VideoEditJob) private repo: Repository<VideoEditJob>,
    private readonly queue: VideoEditQueueService,
    private readonly audioAssets: AudioAssetService,
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

  // Dispara o render de verdade. Só a partir de plan_ready (ou refazendo um
  // que já terminou/falhou) — nunca a partir de um estado transitório do
  // preparo/análise, que ainda não tem plano pra renderizar.
  async render(id: string): Promise<VideoEditJob> {
    const job = await this.findOne(id);
    const allowed: VideoEditJob['status'][] = ['plan_ready', 'done', 'failed'];
    if (!allowed.includes(job.status)) {
      throw new BadRequestException(`Não é possível renderizar no estado atual (${job.status})`);
    }
    if (!job.plan) {
      throw new BadRequestException('Essa edição ainda não tem um plano pronto');
    }

    await this.repo.update(id, { status: 'queued', stage: 'na fila de render', progress: 0, errorMessage: null });
    await this.queue.enqueueRender(id);
    return this.findOne(id);
  }

  // Ajustes manuais no plano já pronto — sem chamar a IA de novo. Cada campo
  // do dto é independente e opcional; só mexe no que veio preenchido.
  async updatePlan(id: string, dto: PlanUpdateDto): Promise<VideoEditJob> {
    const job = await this.findOne(id);
    if (!job.plan) throw new BadRequestException('Essa edição ainda não tem um plano pra ajustar');

    const plan: EditPlan = structuredClone(job.plan);
    const words = job.transcript?.words ?? [];

    if (dto.hookStartWordIdx !== undefined && dto.hookEndWordIdx !== undefined) {
      if (words.length === 0) {
        throw new BadRequestException('Esse vídeo não tem transcrição — não dá pra reajustar o gancho por palavra');
      }
      const startIdx = Math.max(0, Math.min(dto.hookStartWordIdx, words.length - 1));
      const endIdx = Math.max(startIdx, Math.min(dto.hookEndWordIdx, words.length - 1));
      const displayIdx = pickDisplayWordIdx(words, startIdx, endIdx);
      plan.hook = buildHookSegment(
        {
          hookStartWordIdx: startIdx,
          hookEndWordIdx: endIdx,
          hookDisplayWordIdx: displayIdx,
          hookLineBreaksAfterIdx: [],
          hookReason: 'Ajustado manualmente',
        },
        words,
        job.srcDurationSec ?? plan.source.srcDurationSec,
      );
    }

    if (dto.removeZoomIndex !== undefined) {
      plan.zooms = plan.zooms.filter((_, i) => i !== dto.removeZoomIndex);
    }

    if (dto.musicAssetId !== undefined) {
      if (dto.musicAssetId === null) {
        plan.music.assetId = null;
      } else {
        const asset = await this.audioAssets.findOne(dto.musicAssetId);
        if (!asset) throw new BadRequestException('Música não encontrada na biblioteca');
        plan.music.assetId = asset.id;
        plan.assets[asset.id] = { url: asset.publicUrl, name: asset.name, durationSec: asset.durationSec ?? null };
      }
    }
    if (dto.musicVolume !== undefined) {
      plan.music.volume = Math.max(0, Math.min(1, dto.musicVolume));
    }

    if (dto.sfxAssetId !== undefined) {
      if (dto.sfxAssetId === null) {
        plan.transition.sfxAssetId = null;
        plan.transition.kind = 'hard_cut';
      } else {
        const asset = await this.audioAssets.findOne(dto.sfxAssetId);
        if (!asset) throw new BadRequestException('Efeito não encontrado na biblioteca');
        plan.transition.sfxAssetId = asset.id;
        plan.transition.kind = 'whoosh_flash';
        plan.assets[asset.id] = { url: asset.publicUrl, name: asset.name, durationSec: asset.durationSec ?? null };
      }
    }
    if (dto.sfxVolume !== undefined) {
      plan.transition.sfxVolume = Math.max(0, Math.min(1, dto.sfxVolume));
    }

    if (dto.captionOffsetSec !== undefined) {
      plan.audio.captionOffsetSec = Math.max(-0.3, Math.min(0.3, dto.captionOffsetSec));
    }

    const validation = validateEditPlan(plan);
    if (!validation.ok) {
      throw new BadRequestException(`Ajuste inválido: ${validation.errors.join('; ')}`);
    }

    await this.repo.update(id, { plan });
    return this.findOne(id);
  }

  // Rede de segurança: um job que trava no meio do preparo/render (queda do
  // serviço de render, OOM, etc) fica pendurado pra sempre sem isso — o
  // usuário via a tela achando que ainda está processando. 45min é folgado
  // mesmo pro pior caso (vídeo de alguns minutos), ver plano, risco #3.
  @Cron('*/10 * * * *')
  async checkStuckJobs(): Promise<void> {
    const threshold = new Date(Date.now() - STUCK_THRESHOLD_MIN * 60_000);
    const stuck = await this.repo.find({
      where: { status: In(TRANSIENT_STATUSES), updatedAt: LessThan(threshold) },
    });
    for (const job of stuck) {
      this.logger.warn(`Job ${job.id} travado em '${job.status}' há mais de ${STUCK_THRESHOLD_MIN}min — marcando como falho`);
      await this.repo.update(job.id, {
        status: 'failed',
        errorMessage: `Travou no estado '${job.status}' por mais de ${STUCK_THRESHOLD_MIN} minutos — tente de novo`,
      });
    }
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
