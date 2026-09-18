import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { VIDEO_EDIT_ANALYZE_QUEUE } from '../queue/queue.constants';
import { VideoEditService } from './video-edit.service';
import { VideoEditTranscribeService } from './video-edit-transcribe.service';
import { VideoEditPlanService } from './video-edit-plan.service';
import { EditPlanTranscript } from './edit-plan.types';

// Produzido pelo serviço de render (render-service/, fora deste projeto Nest)
// depois que o preparo (ffprobe/normalização/extração de áudio) termina e
// escreve norm_url/audio_url/src_duration_sec direto no Postgres via UPDATE
// cru. Concurrency 1 de propósito — transcrição+plano é trabalho de I/O
// pesado (chamadas à OpenAI), não precisa nem deve competir consigo mesmo.
@Processor(VIDEO_EDIT_ANALYZE_QUEUE, { concurrency: 1 })
export class VideoEditQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoEditQueueProcessor.name);

  constructor(
    private readonly videoEdit: VideoEditService,
    private readonly transcribeService: VideoEditTranscribeService,
    private readonly planService: VideoEditPlanService,
  ) {
    super();
  }

  async process(bullJob: Job<{ jobId: string }>): Promise<void> {
    const { jobId } = bullJob.data;
    const job = await this.videoEdit.findOne(jobId);

    try {
      let transcript: EditPlanTranscript;

      if (job.audioUrl) {
        await this.videoEdit.markTranscribing(jobId);
        const res = await fetch(job.audioUrl);
        if (!res.ok) throw new Error(`Não foi possível baixar o áudio preparado (HTTP ${res.status})`);
        const audioBuffer = Buffer.from(await res.arrayBuffer());
        transcript = await this.transcribeService.transcribe(audioBuffer);
      } else {
        // Vídeo sem faixa de áudio (silencioso) — sem o que transcrever.
        // edit-plan-builder.ts sabe montar um plano mínimo pra esse caso.
        transcript = { text: '', words: [], segments: [], language: 'pt', duration: 0 };
      }

      await this.videoEdit.markPlanning(jobId, transcript);

      const { plan, planModel } = await this.planService.generatePlan(
        transcript,
        job.instruction,
        job.normUrl ?? job.sourceUrl,
        job.srcDurationSec ?? 0,
        job.srcWidth ?? 1080,
        job.srcHeight ?? 1920,
        Boolean(job.audioUrl),
      );

      await this.videoEdit.savePlan(jobId, plan, planModel);
      this.logger.log(`Plano pronto pro job ${jobId} (modelo: ${planModel})`);
    } catch (err: any) {
      await this.videoEdit.markFailed(jobId, err.message ?? String(err));
      throw err;
    }
  }
}
