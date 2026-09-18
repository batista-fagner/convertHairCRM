import { Injectable, Optional, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  VIDEO_EDIT_PREPARE_QUEUE, JOB_PREPARE,
  VIDEO_EDIT_RENDER_QUEUE, JOB_RENDER,
  QUEUE_ENGINE_BULLMQ,
} from '../queue/queue.constants';

// Produtor de video-edit-prepare — consumido pelo serviço de render
// (render-service/, fora deste projeto Nest). Sem fallback legado por cron
// aqui: sem BullMQ ativo, não tem outro jeito de disparar o preparo do vídeo
// (diferente do followup/ig-posts, que tinham um scan por trás pra herdar).
@Injectable()
export class VideoEditQueueService {
  private readonly logger = new Logger(VideoEditQueueService.name);

  constructor(
    @Optional() @InjectQueue(VIDEO_EDIT_PREPARE_QUEUE) private readonly prepareQueue: Queue | null,
    @Optional() @InjectQueue(VIDEO_EDIT_RENDER_QUEUE) private readonly renderQueue: Queue | null,
    private readonly config: ConfigService,
  ) {}

  private get bullmqActive(): boolean {
    return this.config.get<string>('QUEUE_ENGINE') === QUEUE_ENGINE_BULLMQ;
  }

  async enqueuePrepare(jobId: string, sourceUrl: string): Promise<void> {
    if (!this.bullmqActive || !this.prepareQueue) {
      this.logger.error(`QUEUE_ENGINE != bullmq — job ${jobId} criado mas nunca vai ser preparado`);
      return;
    }
    await this.prepareQueue.add(
      JOB_PREPARE,
      { jobId, sourceUrl },
      { jobId: `video-edit-prepare_${jobId}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
  }

  // attempts:1 de propósito — um render de vários minutos não deve reentrar
  // sozinho em caso de falha (ver plano, risco #3). Erro vira status='failed'
  // e o usuário decide se manda renderizar de novo.
  async enqueueRender(jobId: string): Promise<void> {
    if (!this.bullmqActive || !this.renderQueue) {
      throw new Error('QUEUE_ENGINE != bullmq — não é possível renderizar agora');
    }
    await this.renderQueue.add(
      JOB_RENDER,
      { jobId },
      { jobId: `video-edit-render_${jobId}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
  }
}
