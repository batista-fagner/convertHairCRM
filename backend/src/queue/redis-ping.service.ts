import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { QUEUE_ENGINE_BULLMQ } from './queue.constants';

// Prova de vida da conexão Redis no boot — sem isso, uma conexão mal configurada
// (host/porta/senha errados) só se manifestaria como erro silencioso na primeira
// tentativa real de enfileirar um job, minutos ou horas depois do deploy.
// Client próprio (não reaproveita a conexão interna do BullMQ, que não é exposta
// como provider injetável) — só pra esse PING de diagnóstico, fecha logo em seguida.
@Injectable()
export class RedisPingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisPingService.name);
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('QUEUE_ENGINE') !== QUEUE_ENGINE_BULLMQ) return;

    const db = Number(this.config.get<string>('REDIS_BULLMQ_DB') ?? 3);
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST') ?? 'localhost',
      port: Number(this.config.get<string>('REDIS_PORT') ?? 6379),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      db,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    try {
      const pong = await this.client.ping();
      this.logger.log(`[Queue] Redis PING -> ${pong} (db=${db}, prefix=converthair-bullmq)`);
    } catch (err: any) {
      this.logger.error(`[Queue] Falha ao conectar no Redis: ${err.message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
