import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { GreennService } from './greenn.service';
import { GREENN_PIX_PENDING_QUEUE, JOB_CHECK_PIX_PENDING } from '../queue/queue.constants';
import { PixPendingJobData } from './greenn-pix-queue.service';

@Processor(GREENN_PIX_PENDING_QUEUE, { concurrency: 5 })
export class GreennPixQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(GreennPixQueueProcessor.name);

  constructor(private readonly greennService: GreennService) {
    super();
  }

  async process(job: Job<PixPendingJobData>): Promise<void> {
    if (job.name !== JOB_CHECK_PIX_PENDING) {
      this.logger.warn(`[greenn-pix][queue] Job desconhecido: ${job.name}`);
      return;
    }
    await this.greennService.sendPixPendingRecoveryIfStillPending(job.data);
  }
}
