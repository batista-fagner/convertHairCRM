import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { AudioAsset, AudioAssetKind } from './audio-asset.entity';

// @types/multer não está instalado — mesma solução usada em quiz.service.ts e
// ig-posts.service.ts.
export interface UploadedAudioFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

const MAX_AUDIO_SIZE_MB = 20;

// mimetype normalizado -> extensão. O Chrome manda `audio/webm;codecs=opus`,
// por isso normalizamos antes de comparar (ver normalizeMime): comparação
// estrita com o valor cru rejeitaria upload legítimo.
const ALLOWED_AUDIO_MIMETYPES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

const normalizeMime = (raw: string): string => (raw || '').split(';')[0].trim().toLowerCase();

@Injectable()
export class AudioAssetService {
  private readonly logger = new Logger(AudioAssetService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string;

  constructor(
    @InjectRepository(AudioAsset) private repo: Repository<AudioAsset>,
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
    // Sem barra no final — montamos a URL como `${base}/${storagePath}`.
    this.publicUrlBase = (config.get<string>('R2_PUBLIC_URL') ?? '').replace(/\/$/, '');
  }

  list(): Promise<AudioAsset[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async upload(
    file: UploadedAudioFile,
    name: string,
    kind: AudioAssetKind,
    durationSec?: number | null,
  ): Promise<AudioAsset> {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');

    const mime = normalizeMime(file.mimetype);
    const ext = ALLOWED_AUDIO_MIMETYPES[mime];
    if (!ext) {
      throw new BadRequestException('Formato inválido — use MP3, WAV, M4A, AAC, OGG ou FLAC');
    }
    if (file.size > MAX_AUDIO_SIZE_MB * 1024 * 1024) {
      throw new BadRequestException(`Áudio muito grande (limite ${MAX_AUDIO_SIZE_MB}MB)`);
    }
    const cleanName = (name ?? '').trim();
    if (!cleanName) throw new BadRequestException('Dê um nome pro áudio');

    const storagePath = `video-edit/audio/${randomUUID()}.${ext}`;

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
        Body: file.buffer,
        // Guardamos o mimetype NORMALIZADO: o `;codecs=` do Chrome atrapalha
        // quem for consumir o arquivo depois.
        ContentType: mime,
      }));
    } catch (err: any) {
      this.logger.error(`Erro ao subir áudio pro R2: ${err.message}`);
      throw new BadRequestException(`Falha no upload: ${err.message}`);
    }

    const asset = this.repo.create({
      name: cleanName,
      kind: kind === 'sfx' ? 'sfx' : 'music',
      storagePath,
      publicUrl: `${this.publicUrlBase}/${storagePath}`,
      durationSec: Number.isFinite(durationSec as number) ? durationSec : null,
    });
    return this.repo.save(asset);
  }

  async update(id: string, dto: { name?: string; kind?: AudioAssetKind }): Promise<AudioAsset> {
    const asset = await this.repo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('Áudio não encontrado');

    if (dto.name !== undefined) {
      const cleanName = dto.name.trim();
      if (!cleanName) throw new BadRequestException('O nome não pode ficar vazio');
      asset.name = cleanName;
    }
    if (dto.kind !== undefined) {
      asset.kind = dto.kind === 'sfx' ? 'sfx' : 'music';
    }
    return this.repo.save(asset);
  }

  async remove(id: string): Promise<void> {
    const asset = await this.repo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('Áudio não encontrado');

    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: asset.storagePath }));
    } catch (err: any) {
      // Objeto órfão no R2 custa centavos; linha órfã no banco aparece na tela
      // como um áudio que não toca. Some com a linha de qualquer jeito.
      this.logger.warn(`Não foi possível apagar ${asset.storagePath} do R2: ${err.message}`);
    }
    await this.repo.delete(id);
  }
}
