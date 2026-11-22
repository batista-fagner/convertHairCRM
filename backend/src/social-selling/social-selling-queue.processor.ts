import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SocialSellingService } from './social-selling.service';
import { JOB_COMMENT_DM, SOCIAL_SELLING_QUEUE_NAME } from '../queue/queue.constants';

@Processor(SOCIAL_SELLING_QUEUE_NAME, { concurrency: 1 })
export class SocialSellingQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(SocialSellingQueueProcessor.name);

  constructor(private readonly social: SocialSellingService) {
    super();
  }

  async process(job: Job<{ leadId: string }>): Promise<void> {
    if (job.name === JOB_COMMENT_DM) {
      await this.social.processCommentDm(job.data.leadId);
      return;
    }
    this.logger.warn(`[social-selling][queue] Job desconhecido: ${job.name}`);
  }
}
