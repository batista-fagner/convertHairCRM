import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import axios from 'axios';
import { SettingsService } from '../settings/settings.service';
import { IG_TOKEN_JOB_ID, IG_TOKEN_QUEUE_NAME, JOB_REFRESH_IG_TOKEN, QUEUE_ENGINE_BULLMQ } from '../queue/queue.constants';

const IG_TOKEN_STATE_KEY = 'ig_token_state';
const DAY_MS = 86_400_000;
/** Renova com esta antecedência do vencimento. */
const RENEW_BEFORE_MS = 10 * DAY_MS;
/**
 * Vencimento do token que estava no Railway quando este código entrou
 * (gerado em 2026-11-21, validade de 60 dias). Só vale na primeira vez: depois
 * o vencimento real fica no banco.
 */
const SEED_EXPIRES_AT = '2027-01-20T00:00:00.000Z';

interface IgTokenState {
  token: string;
  expiresAt: string;
  /** Final do IG_TOKEN do Railway no momento em que o estado foi gravado — detecta token colado à mão. */
  envTail: string;
}

/**
 * Fonte única do token do Instagram. O token renovado fica no banco (o backend
 * não consegue alterar variável do Railway); o IG_TOKEN do Railway é a semente
 * e vale de novo sempre que for trocado à mão.
 */
@Injectable()
export class IgTokenService implements OnModuleInit {
  private readonly logger = new Logger(IgTokenService.name);
  private state: IgTokenState | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    @Optional() @InjectQueue(IG_TOKEN_QUEUE_NAME) private readonly queue: Queue | null,
  ) {}

  private get envToken(): string {
    return this.config.get<string>('IG_TOKEN') || '';
  }

  private get activeQueue(): Queue | null {
    if (this.config.get<string>('QUEUE_ENGINE') !== QUEUE_ENGINE_BULLMQ) return null;
    return this.queue ?? null;
  }

  /** Síncrono de propósito: os serviços de Instagram leem isso em vários pontos. */
  current(): string {
    return this.state?.token || this.envToken;
  }

  async onModuleInit() {
    try {
      await this.load();
      await this.schedule();
    } catch (err: any) {
      this.logger.error(`Falha ao preparar a renovação do token do Instagram: ${err.message}`);
    }
  }

  /** Decide qual token vale: o do banco (renovado) ou o do Railway (colado à mão). */
  private async load() {
    const env = this.envToken;
    if (!env) return;
    const envTail = env.slice(-20);

    let saved: IgTokenState | null = null;
    try {
      saved = JSON.parse((await this.settings.get(IG_TOKEN_STATE_KEY)) || 'null');
    } catch { /* estado inválido = recomeça do Railway */ }

    if (saved?.token && saved.envTail === envTail) {
      this.state = saved;
      return;
    }
    // Primeira vez: semente fixa. Token novo colado no Railway: 60 dias a partir de agora.
    const expiresAt = saved ? new Date(Date.now() + 60 * DAY_MS).toISOString() : SEED_EXPIRES_AT;
    this.state = { token: env, expiresAt, envTail };
    await this.settings.set(IG_TOKEN_STATE_KEY, JSON.stringify(this.state));
    if (saved) this.logger.log('IG_TOKEN do Railway foi trocado: usando o novo e contando 60 dias.');
    await this.activeQueue?.remove(IG_TOKEN_JOB_ID).catch(() => undefined);
  }

  /** 1 job agendado pro momento exato — sem varredura. jobId fixo: repetir o add é no-op. */
  private async schedule() {
    const queue = this.activeQueue;
    if (!queue || !this.state) {
      if (!queue) this.logger.warn('Fila desligada (QUEUE_ENGINE != bullmq): o token do Instagram NÃO será renovado sozinho.');
      return;
    }
    const runAt = new Date(this.state.expiresAt).getTime() - RENEW_BEFORE_MS;
    const delay = Math.max(0, runAt - Date.now());
    await queue.add(
      JOB_REFRESH_IG_TOKEN,
      {},
      {
        jobId: IG_TOKEN_JOB_ID,
        delay,
        // Falhou (Instagram fora do ar, etc.): tenta de novo por ~15h antes de desistir.
        attempts: 6,
        backoff: { type: 'exponential', delay: 30 * 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    this.logger.log(`Renovação do token do Instagram agendada para ${new Date(Date.now() + delay).toISOString()}`);
  }

  /** Chamado pelo job. Lança em caso de falha pra o BullMQ tentar de novo. */
  async refresh() {
    await this.load();
    const current = this.current();
    if (!current) throw new Error('IG_TOKEN ausente');

    const res = await axios.get('https://graph.instagram.com/refresh_access_token', {
      params: { grant_type: 'ig_refresh_token', access_token: current },
    });
    const token: string | undefined = res.data?.access_token;
    const expiresIn = Number(res.data?.expires_in);
    if (!token || !Number.isFinite(expiresIn)) throw new Error('Resposta inesperada do Instagram ao renovar');

    this.state = {
      token,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      envTail: this.envToken.slice(-20),
    };
    await this.settings.set(IG_TOKEN_STATE_KEY, JSON.stringify(this.state));
    this.logger.log(`Token do Instagram renovado, vale até ${this.state.expiresAt}`);
    await this.schedule();
  }

  /** Último erro definitivo: o token vence em ~10 dias e precisa ser gerado à mão. */
  logGaveUp(message: string) {
    this.logger.error(`Renovação do token do Instagram falhou de vez (${message}). Gere um token novo no app CRM-IA e troque o IG_TOKEN no Railway.`);
  }
}
