import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SdrFollowupService } from './sdr-followup.service';
import { SDR_FOLLOWUP_QUEUE_NAME } from '../queue/queue.constants';

// concurrency:1 de propósito — mesmo modelo do cron de hoje, um scan por vez.
// O lock por lease dentro de runFollowupScan() continua sendo a trava real
// contra sobreposição; isso aqui só evita 2 execuções simultâneas do MESMO
// worker (não protege contra 2 instâncias, é o lock do Postgres que faz isso).
@Processor(SDR_FOLLOWUP_QUEUE_NAME, { concurrency: 1 })
export class SdrFollowupScanProcessor extends WorkerHost {
  constructor(private readonly followups: SdrFollowupService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.followups.runFollowupScan();
  }
}
