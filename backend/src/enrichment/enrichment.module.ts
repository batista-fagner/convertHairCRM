import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadsModule } from '../leads/leads.module';
import { AiAnalysisModule } from '../ai-analysis/ai-analysis.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { Lead } from '../common/entities/lead.entity';
import { EnrichmentService } from './enrichment.service';
import { EnrichmentController } from './enrichment.controller';
import { InstagramProxyController } from './instagram-proxy.controller';
import { AvatarStorageService } from '../sdr/avatar-storage.service';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Lead]), LeadsModule, AiAnalysisModule, RealtimeModule],
  providers: [EnrichmentService, AvatarStorageService],
  controllers: [EnrichmentController, InstagramProxyController],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
