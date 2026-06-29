import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdrController } from './sdr.controller';
import { FollowupController } from './followup.controller';
import { SdrService } from './sdr.service';
import { SdrFollowupService } from './sdr-followup.service';
import { Lead } from '../common/entities/lead.entity';
import { LeadsModule } from '../leads/leads.module';
import { FacebookModule } from '../facebook/facebook.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([Lead]),
    LeadsModule,
    FacebookModule,
    RealtimeModule,
    SettingsModule,
  ],
  controllers: [SdrController, FollowupController],
  providers: [SdrService, SdrFollowupService],
})
export class SdrModule {}
