import { Body, Controller, ForbiddenException, Headers, Inject, Logger, Post, Query, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { SMS_PROVIDER } from './providers/sms-provider.interface';
import type { ISmsProvider, WebhookVerifyContext } from './providers/sms-provider.interface';
import { SmsInboundService } from './sms-inbound.service';
import { SmsService } from './sms.service';

@Controller('webhooks/sms')
export class SmsWebhookController {
  private readonly logger = new Logger(SmsWebhookController.name);

  constructor(
    @Inject(SMS_PROVIDER) private readonly provider: ISmsProvider,
    private readonly inbound: SmsInboundService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  @Post('inbound')
  async handleInbound(
    @Body() body: any,
    @Headers() headers: Record<string, any>,
    @Query() query: Record<string, any>,
    @Req() req: any,
  ) {
    const ctx = this.buildContext(body, headers, query, req);
    this.assertAuthorized(ctx);

    const parsed = this.provider.parseInbound(ctx);
    if (!parsed) return { ok: true };

    try {
      return await this.inbound.handleInbound(parsed);
    } catch (err: any) {
      // 200 mesmo em erro: devolver 5xx faz o provedor entrar em retry storm.
      this.logger.error(`Erro processando inbound: ${err?.message ?? err}`);
      return { ok: true };
    }
  }

  @Post('status')
  async handleStatus(
    @Body() body: any,
    @Headers() headers: Record<string, any>,
    @Query() query: Record<string, any>,
    @Req() req: any,
  ) {
    const ctx = this.buildContext(body, headers, query, req);
    this.assertAuthorized(ctx);

    const parsed = this.provider.parseStatusCallback(ctx);
    if (!parsed) return { ok: true };

    try {
      await this.sms.applyStatusUpdate(parsed);
    } catch (err: any) {
      this.logger.error(`Erro processando status: ${err?.message ?? err}`);
    }
    return { ok: true };
  }

  private buildContext(body: any, headers: Record<string, any>, query: Record<string, any>, req: any): WebhookVerifyContext {
    return { body, headers, query, url: req?.originalUrl ?? '' };
  }

  /**
   * Duas camadas: token na URL (funciona com qualquer provedor, dá pra ligar
   * hoje) e a assinatura do provedor. Desligável em dev com
   * SMS_WEBHOOK_VERIFY=false.
   */
  private assertAuthorized(ctx: WebhookVerifyContext) {
    if (String(this.config.get('SMS_WEBHOOK_VERIFY') ?? 'true').toLowerCase() === 'false') return;

    const expected = this.config.get<string>('SMS_WEBHOOK_TOKEN');
    if (expected) {
      const received = String(ctx.query?.token ?? '');
      if (!this.safeCompare(received, expected)) {
        throw new ForbiddenException('Token de webhook inválido');
      }
    }

    if (!this.provider.verifySignature(ctx)) {
      throw new ForbiddenException('Assinatura de webhook inválida');
    }
  }

  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
