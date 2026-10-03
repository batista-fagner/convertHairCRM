import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SettingsModule } from '../settings/settings.module';
import { GoogleCalendarService } from './google-calendar.service';
import { GoogleCalendarController } from './google-calendar.controller';
import { LegalController } from '../legal/legal.controller';

@Module({
  imports: [ConfigModule, SettingsModule],
  providers: [GoogleCalendarService],
  controllers: [GoogleCalendarController, LegalController],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
