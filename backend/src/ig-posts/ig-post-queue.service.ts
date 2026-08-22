import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { IG_POST_QUEUE_NAME, JOB_PUBLISH_POST, JOB_POLL_CONTAINER, QUEUE_ENGINE_BULLMQ } from '../queue/queue.constants';

// Substitui os crons de 1min (checkScheduled) e 30s (checkProcessing) por job
// por post — o job fica parado no Redis até a hora certa, em vez do banco
// inteiro ser varrido a cada tick. Padrão igual ao FollowupQueueService do
// fisio-secretary: @Optional pra funcionar em modo legado (fila nem registrada).
@Injectable()
export class IgPostQueueService {
  constructor(
    @Optional() @InjectQueue(IG_POST_QUEUE_NAME) private readonly queue: Queue | null,
    private readonly config: ConfigService,
  ) {}

  private get activeQueue(): Queue | null {
    if (this.config.get<string>('QUEUE_ENGINE') !== QUEUE_ENGINE_BULLMQ) return null;
    return this.queue ?? null;
  }

  /** Substitui o scan de checkScheduled() — 1 job agendado pro momento exato da publicação. */
  async enqueuePublish(postId: string, delayMs: number): Promise<void> {
    const queue = this.activeQueue;
    if (!queue) return;
    await queue.add(
      JOB_PUBLISH_POST,
      { postId },
      {
        jobId: `igpost-publish_${postId}`,
        delay: Math.max(0, delayMs),
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  /**
   * Substitui o scan de checkProcessing() — cadeia auto-reagendada, 30s fixos
   * entre checagens (não é backoff crescente: 30s já é a cadência escolhida
   * pra essa API, não um "dar mais tempo"). `attempts` é o valor JÁ incrementado
   * no banco (não o número de chamadas deste método) — usado só pra compor um
   * jobId único por tentativa, já que o BullMQ descarta em silêncio um add com
   * jobId repetido (o elo anterior ainda pode estar em processamento).
   */
  async enqueuePoll(postId: string, attempts: number): Promise<void> {
    const queue = this.activeQueue;
    if (!queue) return;
    const jobId = attempts === 0 ? `igpost-poll_${postId}` : `igpost-poll_${postId}_a${attempts}`;
    await queue.add(
      JOB_POLL_CONTAINER,
      { postId },
      {
        jobId,
        delay: 30_000,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  /** Sem guard de propósito — remover jobId inexistente é no-op nos dois modos. */
  async cancelPublish(postId: string): Promise<void> {
    if (!this.queue) return;
    await this.queue.remove(`igpost-publish_${postId}`).catch(() => undefined);
  }
}
