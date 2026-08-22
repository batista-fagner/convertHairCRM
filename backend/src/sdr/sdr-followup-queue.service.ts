import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  SDR_FOLLOWUP_QUEUE_NAME,
  JOB_SCAN_FOLLOWUPS,
  SDR_FOLLOWUP_SCHEDULER_ID,
  QUEUE_ENGINE_BULLMQ,
} from '../queue/queue.constants';

const SCAN_EVERY_MS = 5 * 60_000;

// Design B da Fase 3 (deliberadamente conservador — ver plano): só troca o
// GATILHO do scan de follow-up de @Cron pra um job repetível do BullMQ. A
// query, o loop e o lock por lease em Postgres (tryAcquireLock) continuam
// exatamente os mesmos — não reescrevemos pra job-por-lead (isso é o código
// de maior risco do sistema, manda WhatsApp real pra lead real).
@Injectable()
export class SdrFollowupQueueService implements OnModuleInit {
  private readonly logger = new Logger(SdrFollowupQueueService.name);

  constructor(
    @Optional() @InjectQueue(SDR_FOLLOWUP_QUEUE_NAME) private readonly queue: Queue | null,
    private readonly config: ConfigService,
  ) {}

  private get activeQueue(): Queue | null {
    if (this.config.get<string>('QUEUE_ENGINE') !== QUEUE_ENGINE_BULLMQ) return null;
    return this.queue ?? null;
  }

  async onModuleInit(): Promise<void> {
    const queue = this.activeQueue;
    if (!queue) return;
    // upsert = idempotente, toda réplica pode chamar no boot sem duplicar.
    await queue.upsertJobScheduler(
      SDR_FOLLOWUP_SCHEDULER_ID,
      { every: SCAN_EVERY_MS },
      { name: JOB_SCAN_FOLLOWUPS, data: {} },
    );
    this.logger.log('[Followup][queue] Scan repetível registrado (5min)');
  }
}
