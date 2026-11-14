import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../common/entities/lead.entity';
import { AgendaModule } from '../agenda/agenda.module';
import { SettingsModule } from '../settings/settings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Lead]), AgendaModule, SettingsModule, RealtimeModule],
  providers: [BookingService],
  controllers: [BookingController],
})
export class BookingModule {}
