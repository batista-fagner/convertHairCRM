import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { queueEngineEnabled } from './queue.enabled';
import { RedisPingService } from './redis-ping.service';

// Conexão Redis compartilhada por todas as filas. Registrada UMA vez aqui (como o
// ScheduleModule.forRoot() no AppModule) — os módulos de domínio só declaram suas
// filas com BullModule.registerQueue({ name }).
//
// O Redis do Railway já é usado pelo fisio-secretary/kanbam-ia-whatsapp no DB 2 com
// prefixo 'fisio-bullmq'. Por isso DB separado (3) + prefixo próprio: as chaves das
// duas aplicações nunca se encostam, e um FLUSHDB de uma não derruba a outra.
//
// Com QUEUE_ENGINE != 'bullmq' nada é registrado e nenhuma conexão é aberta: o app
// roda igual ao que era antes das filas existirem, mesmo sem Redis no ambiente.
const bullImports = queueEngineEnabled
  ? [
      BullModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          connection: {
            host: config.get<string>('REDIS_HOST') ?? 'localhost',
            port: Number(config.get<string>('REDIS_PORT') ?? 6379),
            password: config.get<string>('REDIS_PASSWORD') || undefined,
            db: Number(config.get<string>('REDIS_BULLMQ_DB') ?? 3),
          },
          prefix: 'converthair-bullmq',
        }),
      }),
    ]
  : [];

const diagnosticProviders = queueEngineEnabled ? [RedisPingService] : [];

@Global()
@Module({
  imports: bullImports,
  providers: diagnosticProviders,
  exports: bullImports,
})
export class QueueModule {}
