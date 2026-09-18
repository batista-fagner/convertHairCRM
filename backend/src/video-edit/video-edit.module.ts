import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AudioAsset } from './audio-asset.entity';
import { AudioAssetService } from './audio-asset.service';
import { VideoEditJob } from './video-edit-job.entity';
import { VideoEditController } from './video-edit.controller';
import { VideoEditService } from './video-edit.service';
import { VideoEditQueueService } from './video-edit-queue.service';
import { VideoEditQueueProcessor } from './video-edit-queue.processor';
import { VideoEditTranscribeService } from './video-edit-transcribe.service';
import { VideoEditPlanService } from './video-edit-plan.service';
import { VIDEO_EDIT_PREPARE_QUEUE, VIDEO_EDIT_ANALYZE_QUEUE } from '../queue/queue.constants';
import { queueEngineEnabled } from '../queue/queue.enabled';

// video-edit-prepare: este módulo só PRODUZ (consumido pelo render-service,
// fora deste projeto Nest). video-edit-analyze: este módulo CONSOME (produzido
// pelo render-service depois do preparo). video-edit-render (Etapa 5) segue o
// mesmo padrão do prepare — produz aqui, consome lá.
const queueParts = queueEngineEnabled
  ? [BullModule.registerQueue({ name: VIDEO_EDIT_PREPARE_QUEUE }, { name: VIDEO_EDIT_ANALYZE_QUEUE })]
  : [];
const queueProviders = queueEngineEnabled ? [VideoEditQueueProcessor] : [];

@Module({
  imports: [TypeOrmModule.forFeature([AudioAsset, VideoEditJob]), ...queueParts],
  controllers: [VideoEditController],
  providers: [
    AudioAssetService,
    VideoEditService,
    VideoEditQueueService,
    VideoEditTranscribeService,
    VideoEditPlanService,
    ...queueProviders,
  ],
  exports: [AudioAssetService],
})
export class VideoEditModule {}
