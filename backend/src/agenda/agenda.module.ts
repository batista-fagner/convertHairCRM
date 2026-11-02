import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgendaAvailability } from '../common/entities/agenda-availability.entity';
import { AgendaBlock } from '../common/entities/agenda-block.entity';
import { Lead } from '../common/entities/lead.entity';
import { SettingsModule } from '../settings/settings.module';
import { AgendaService } from './agenda.service';
import { AgendaController } from './agenda.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AgendaAvailability, AgendaBlock, Lead]), SettingsModule],
  providers: [AgendaService],
  controllers: [AgendaController],
  exports: [AgendaService],
})
export class AgendaModule {}
