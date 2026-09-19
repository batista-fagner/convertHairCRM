import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GreennController } from './greenn.controller';
import { GreennService } from './greenn.service';
import { GreennPixQueueService } from './greenn-pix-queue.service';
import { GreennPixQueueProcessor } from './greenn-pix-queue.processor';
import { FacebookModule } from '../facebook/facebook.module';
import { QuizModule } from '../quiz/quiz.module';
import { LeadsModule } from '../leads/leads.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { GREENN_PIX_PENDING_QUEUE } from '../queue/queue.constants';
import { queueEngineEnabled } from '../queue/queue.enabled';

// Fila e worker só existem no modo bullmq — no legado não há conexão Redis
// registrada (ver queue.module.ts), e declarar a fila aqui faria o boot
// falhar por dependência ausente.
const queueParts = queueEngineEnabled ? [BullModule.registerQueue({ name: GREENN_PIX_PENDING_QUEUE })] : [];
const queueProviders = queueEngineEnabled ? [GreennPixQueueProcessor] : [];

@Module({
  imports: [FacebookModule, QuizModule, LeadsModule, RealtimeModule, ...queueParts],
  controllers: [GreennController],
  providers: [GreennService, GreennPixQueueService, ...queueProviders],
})
export class GreennModule {}
