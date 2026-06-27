import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SdrController } from './sdr.controller';
import { SdrService } from './sdr.service';
import { LeadsModule } from '../leads/leads.module';
import { FacebookModule } from '../facebook/facebook.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [HttpModule, LeadsModule, FacebookModule, RealtimeModule, SettingsModule],
  controllers: [SdrController],
  providers: [SdrService],
})
export class SdrModule {}
