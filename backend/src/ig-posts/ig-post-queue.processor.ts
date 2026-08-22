import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { IgPostsService } from './ig-posts.service';
import { IG_POST_QUEUE_NAME, JOB_PUBLISH_POST, JOB_POLL_CONTAINER } from '../queue/queue.constants';

// Um processor só pros 2 tipos de job desta fila — cada um delega pro método
// correspondente do IgPostsService, que já tem toda a lógica de negócio
// (o processor não duplica nada, só decide qual método chamar).
@Processor(IG_POST_QUEUE_NAME, { concurrency: 5 })
export class IgPostQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(IgPostQueueProcessor.name);

  constructor(private readonly igPosts: IgPostsService) {
    super();
  }

  async process(job: Job<{ postId: string }>): Promise<void> {
    if (job.name === JOB_PUBLISH_POST) {
      await this.igPosts.startPublish(job.data.postId);
      return;
    }
    if (job.name === JOB_POLL_CONTAINER) {
      await this.igPosts.pollContainerJob(job.data.postId);
      return;
    }
    this.logger.warn(`[ig-posts][queue] Job desconhecido: ${job.name}`);
  }
}
