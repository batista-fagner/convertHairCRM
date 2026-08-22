import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

export interface PendingUtm {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  fbc?: string;
  fbp?: string;
  clickId?: string;
}

const QUEUE_KEY = 'converthair:tracking:utm-queue';
const TTL_MS = 30 * 60 * 1000;

/**
 * Fila FIFO de UTMs capturados no clique do botão da LP, agora em Redis (sorted
 * set) em vez de array em memória — o array antigo se perdia a cada restart
 * (deploy no Railway) e não funcionaria com mais de 1 réplica. Sorted set (não
 * lista simples) porque precisa de expiração por item — Redis não tem TTL por
 * elemento de lista, então o score é o timestamp de inserção e a purga varre
 * por faixa de score antes de cada operação (mesma purga preguiçosa de antes,
 * sem criar um cron novo de limpeza).
 *
 * Quando um lead entra no grupo, GroupJoinService consome o UTM mais antigo
 * (primeiro a clicar = primeiro a entrar). Entradas expiram após 30 minutos.
 */
@Injectable()
export class TrackingService implements OnModuleDestroy {
  private readonly logger = new Logger(TrackingService.name);
  private readonly redis: Redis;

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis({
      host: this.config.get<string>('REDIS_HOST') ?? 'localhost',
      port: Number(this.config.get<string>('REDIS_PORT') ?? 6379),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      db: Number(this.config.get<string>('REDIS_BULLMQ_DB') ?? 3),
      maxRetriesPerRequest: 2,
    });
    this.redis.on('error', (err) => this.logger.error(`[Tracking] Erro na conexão Redis: ${err.message}`));
  }

  async registerClick(data: PendingUtm): Promise<void> {
    try {
      await this.purgeExpired();
      // _id garante membro único no sorted set — sem isso, 2 cliques com o
      // MESMO payload de UTM (comum: dois cliques rápidos no mesmo anúncio)
      // colidiriam no mesmo member e um sobrescreveria o outro em vez de
      // virar 2 entradas na fila, diferente do array antigo (que não dedupe).
      const entry = JSON.stringify({ ...data, _id: randomUUID() });
      await this.redis.zadd(QUEUE_KEY, Date.now(), entry);
      const len = await this.redis.zcard(QUEUE_KEY);
      this.logger.log(`UTM registrado (fila: ${len}) — source=${data.utmSource} medium=${data.utmMedium} campaign=${data.utmCampaign}`);
    } catch (err: any) {
      this.logger.error(`Falha ao registrar UTM no Redis: ${err.message}`);
    }
  }

  async consumeNextUtm(): Promise<PendingUtm | null> {
    try {
      await this.purgeExpired();
      const popped = await this.redis.zpopmin(QUEUE_KEY, 1);
      if (!popped || popped.length === 0) return null;
      const { _id, ...utm } = JSON.parse(popped[0]) as PendingUtm & { _id: string };
      this.logger.log(`UTM consumido — source=${utm.utmSource} campaign=${utm.utmCampaign}`);
      return utm;
    } catch (err: any) {
      this.logger.error(`Falha ao consumir UTM do Redis: ${err.message}`);
      return null;
    }
  }

  private async purgeExpired(): Promise<void> {
    const removed = await this.redis.zremrangebyscore(QUEUE_KEY, '-inf', Date.now() - TTL_MS);
    if (removed > 0) this.logger.debug(`${removed} UTM(s) expirados removidos da fila`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
