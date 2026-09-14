import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Prospect } from './prospect.entity';
import { ProspectingService } from './prospecting.service';
import { ProspectingController } from './prospecting.controller';
import { SettingsModule } from '../settings/settings.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([Prospect]), SettingsModule, RealtimeModule],
  providers: [ProspectingService],
  controllers: [ProspectingController],
})
export class ProspectingModule {}
