import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdrController } from './sdr.controller';
import { FollowupController } from './followup.controller';
import { ManualMessageController } from './manual-message.controller';
import { SdrService } from './sdr.service';
import { SdrFollowupService } from './sdr-followup.service';
import { FollowupVideoService } from './followup-video.service';
import { Lead } from '../common/entities/lead.entity';
import { FollowupRule } from '../common/entities/followup-rule.entity';
import { FollowupVideo } from '../common/entities/followup-video.entity';
import { LeadsModule } from '../leads/leads.module';
import { FacebookModule } from '../facebook/facebook.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
import { EnrichmentModule } from '../enrichment/enrichment.module';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([Lead, FollowupRule, FollowupVideo]),
    LeadsModule,
    FacebookModule,
    RealtimeModule,
    SettingsModule,
    EnrichmentModule,
  ],
  controllers: [SdrController, FollowupController, ManualMessageController],
  providers: [SdrService, SdrFollowupService, FollowupVideoService],
})
export class SdrModule {}
