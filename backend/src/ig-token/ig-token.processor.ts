import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { IgTokenService } from './ig-token.service';
import { IG_TOKEN_QUEUE_NAME, JOB_REFRESH_IG_TOKEN } from '../queue/queue.constants';

@Processor(IG_TOKEN_QUEUE_NAME, { concurrency: 1 })
export class IgTokenProcessor extends WorkerHost {
  constructor(private readonly igToken: IgTokenService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_REFRESH_IG_TOKEN) await this.igToken.refresh();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: any) {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      this.igToken.logGaveUp(err.response?.data?.error?.message || err.message);
    }
  }
}
