import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { SettingsModule } from '../settings/settings.module';
import { IgTokenService } from './ig-token.service';
import { IgTokenProcessor } from './ig-token.processor';
import { IG_TOKEN_QUEUE_NAME } from '../queue/queue.constants';
import { queueEngineEnabled } from '../queue/queue.enabled';

// Fila e worker só existem no modo bullmq (ver ig-posts.module.ts).
const queueParts = queueEngineEnabled ? [BullModule.registerQueue({ name: IG_TOKEN_QUEUE_NAME })] : [];
const queueProviders = queueEngineEnabled ? [IgTokenProcessor] : [];

@Module({
  imports: [ConfigModule, SettingsModule, ...queueParts],
  providers: [IgTokenService, ...queueProviders],
  exports: [IgTokenService],
})
export class IgTokenModule {}
