import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { SdrController } from './sdr.controller';
import { FollowupController } from './followup.controller';
import { ManualMessageController } from './manual-message.controller';
import { SdrService } from './sdr.service';
import { SdrFollowupService } from './sdr-followup.service';
import { SdrFollowupQueueService } from './sdr-followup-queue.service';
import { SdrFollowupScanProcessor } from './sdr-followup-scan.processor';
import { FollowupVideoService } from './followup-video.service';
import { AvatarStorageService } from './avatar-storage.service';
import { SdrGroupJoinService } from './sdr-group-join.service';
import { GroupWorkshopService } from './group-workshop.service';
import { GroupWorkshopController } from './group-workshop.controller';
import { Lead } from '../common/entities/lead.entity';
import { FollowupRule } from '../common/entities/followup-rule.entity';
import { FollowupVideo } from '../common/entities/followup-video.entity';
import { LeadsModule } from '../leads/leads.module';
import { FacebookModule } from '../facebook/facebook.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { TrackingModule } from '../tracking/tracking.module';
import { QuizModule } from '../quiz/quiz.module';
import { SDR_FOLLOWUP_QUEUE_NAME } from '../queue/queue.constants';
import { queueEngineEnabled } from '../queue/queue.enabled';

// Fila e worker só existem no modo bullmq — no legado não há conexão Redis
// registrada (ver queue.module.ts).
const queueParts = queueEngineEnabled ? [BullModule.registerQueue({ name: SDR_FOLLOWUP_QUEUE_NAME })] : [];
const queueProviders = queueEngineEnabled ? [SdrFollowupScanProcessor] : [];

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([Lead, FollowupRule, FollowupVideo]),
    LeadsModule,
    FacebookModule,
    RealtimeModule,
    SettingsModule,
    EnrichmentModule,
    TrackingModule,
    QuizModule,
    ...queueParts,
  ],
  controllers: [SdrController, FollowupController, ManualMessageController, GroupWorkshopController],
  providers: [SdrService, SdrFollowupService, SdrFollowupQueueService, FollowupVideoService, AvatarStorageService, SdrGroupJoinService, GroupWorkshopService, ...queueProviders],
})
export class SdrModule {}
