import { Injectable, Optional, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { VIDEO_EDIT_PREPARE_QUEUE, JOB_PREPARE, QUEUE_ENGINE_BULLMQ } from '../queue/queue.constants';

// Produtor de video-edit-prepare — consumido pelo serviço de render
// (render-service/, fora deste projeto Nest). Sem fallback legado por cron
// aqui: sem BullMQ ativo, não tem outro jeito de disparar o preparo do vídeo
// (diferente do followup/ig-posts, que tinham um scan por trás pra herdar).
@Injectable()
export class VideoEditQueueService {
  private readonly logger = new Logger(VideoEditQueueService.name);

  constructor(
    @Optional() @InjectQueue(VIDEO_EDIT_PREPARE_QUEUE) private readonly queue: Queue | null,
    private readonly config: ConfigService,
  ) {}

  private get activeQueue(): Queue | null {
    if (this.config.get<string>('QUEUE_ENGINE') !== QUEUE_ENGINE_BULLMQ) return null;
    return this.queue ?? null;
  }

  async enqueuePrepare(jobId: string, sourceUrl: string): Promise<void> {
    const queue = this.activeQueue;
    if (!queue) {
      this.logger.error(`QUEUE_ENGINE != bullmq — job ${jobId} criado mas nunca vai ser preparado`);
      return;
    }
    await queue.add(
      JOB_PREPARE,
      { jobId, sourceUrl },
      { jobId: `video-edit-prepare_${jobId}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
  }
}
