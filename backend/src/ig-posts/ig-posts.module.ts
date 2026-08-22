import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { IgPost } from './ig-post.entity';
import { IgPostsService } from './ig-posts.service';
import { IgPostsController } from './ig-posts.controller';
import { IgPostQueueService } from './ig-post-queue.service';
import { IgPostQueueProcessor } from './ig-post-queue.processor';
import { IG_POST_QUEUE_NAME } from '../queue/queue.constants';
import { queueEngineEnabled } from '../queue/queue.enabled';
import { RealtimeModule } from '../realtime/realtime.module';

// Fila e worker só existem no modo bullmq — no legado não há conexão Redis
// registrada (ver queue.module.ts), e declarar a fila aqui faria o boot
// falhar por dependência ausente.
const queueParts = queueEngineEnabled ? [BullModule.registerQueue({ name: IG_POST_QUEUE_NAME })] : [];
const queueProviders = queueEngineEnabled ? [IgPostQueueProcessor] : [];

@Module({
  imports: [TypeOrmModule.forFeature([IgPost]), RealtimeModule, ...queueParts],
  controllers: [IgPostsController],
  providers: [IgPostsService, IgPostQueueService, ...queueProviders],
})
export class IgPostsModule {}
