import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  GREENN_PIX_PENDING_QUEUE,
  JOB_CHECK_PIX_PENDING,
  GREENN_PIX_PENDING_DELAY_MS,
  QUEUE_ENGINE_BULLMQ,
} from '../queue/queue.constants';

export interface PixPendingJobData {
  saleId?: number;
  phone: string; // já normalizado (com DDI)
  name?: string;
  qrcode?: string;
}

@Injectable()
export class GreennPixQueueService {
  constructor(
    @Optional() @InjectQueue(GREENN_PIX_PENDING_QUEUE) private readonly queue: Queue | null,
    private readonly config: ConfigService,
  ) {}

  private get activeQueue(): Queue | null {
    if (this.config.get<string>('QUEUE_ENGINE') !== QUEUE_ENGINE_BULLMQ) return null;
    return this.queue ?? null;
  }

  /**
   * Agenda a checagem/envio pra daqui 8min. jobId por sale.id evita agendar
   * duas vezes se a Greenn reenviar o mesmo webhook de waiting_payment.
   * Retorna false quando a fila não está disponível (QUEUE_ENGINE != bullmq)
   * — o chamador decide o fallback (enviar direto, sem esperar).
   */
  async scheduleCheck(data: PixPendingJobData): Promise<boolean> {
    const queue = this.activeQueue;
    if (!queue) return false;
    const jobId = `greenn-pix_${data.saleId ?? data.phone}`;
    await queue.add(JOB_CHECK_PIX_PENDING, data, {
      jobId,
      delay: GREENN_PIX_PENDING_DELAY_MS,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
    return true;
  }
}
