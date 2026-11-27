import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { SocialLead } from './social-lead.entity';
import { SocialSignal } from './social-signal.entity';
import { SocialSellingService } from './social-selling.service';
import { SocialSellingController, SocialSellingExtController } from './social-selling.controller';
import { SocialSellingQueueProcessor } from './social-selling-queue.processor';
import { SettingsModule } from '../settings/settings.module';
import { AgendaModule } from '../agenda/agenda.module';
import { InstagramAutomationModule } from '../instagram-automation/instagram-automation.module';
import { SOCIAL_SELLING_QUEUE_NAME } from '../queue/queue.constants';
import { queueEngineEnabled } from '../queue/queue.enabled';

// Fila e worker só existem no modo bullmq (ver ig-posts.module.ts).
const queueParts = queueEngineEnabled ? [BullModule.registerQueue({ name: SOCIAL_SELLING_QUEUE_NAME })] : [];
const queueProviders = queueEngineEnabled ? [SocialSellingQueueProcessor] : [];

@Module({
  imports: [TypeOrmModule.forFeature([SocialLead, SocialSignal]), ConfigModule, SettingsModule, InstagramAutomationModule, AgendaModule, ...queueParts],
  controllers: [SocialSellingExtController, SocialSellingController],
  providers: [SocialSellingService, ...queueProviders],
})
export class SocialSellingModule {}
