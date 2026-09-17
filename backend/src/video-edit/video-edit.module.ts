import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioAsset } from './audio-asset.entity';
import { AudioAssetService } from './audio-asset.service';
import { VideoEditController } from './video-edit.controller';

// Editor de vídeo com IA. Etapa atual: só a biblioteca de áudio.
// As filas (video-edit-prepare/analyze/render) e o VideoEditJob entram nas
// etapas seguintes — ver o plano em ~/.claude/plans/spicy-humming-boole.md.
@Module({
  imports: [TypeOrmModule.forFeature([AudioAsset])],
  controllers: [VideoEditController],
  providers: [AudioAssetService],
  exports: [AudioAssetService],
})
export class VideoEditModule {}
