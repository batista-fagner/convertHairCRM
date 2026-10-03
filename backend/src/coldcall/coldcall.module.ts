import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ColdCallLead } from '../common/entities/coldcall-lead.entity';
import { ColdCallStage } from '../common/entities/coldcall-stage.entity';
import { ColdCallService } from './coldcall.service';
import { ColdCallController } from './coldcall.controller';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';

@Module({
  imports: [TypeOrmModule.forFeature([ColdCallLead, ColdCallStage]), GoogleCalendarModule],
  providers: [ColdCallService],
  controllers: [ColdCallController],
})
export class ColdCallModule {}
