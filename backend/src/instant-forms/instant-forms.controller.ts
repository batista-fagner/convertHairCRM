import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { InstantFormsService } from './instant-forms.service';

/**
 * Webhook do Meta Lead Ads (Formulário Instantâneo) — separado do webhook de
 * WhatsApp (Sofia/sdr.controller.ts): esse aqui recebe notificação toda vez que
 * alguém completa o formulário "ConvertHair50" (ou outro que venha a existir),
 * não conversa via WhatsApp.
 */
@Controller('webhooks/leadgen')
export class InstantFormsController {
  constructor(
    private readonly service: InstantFormsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  verify(@Query() query: Record<string, string>, @Res() res: Response) {
    const verifyToken = this.config.get('LEADGEN_WEBHOOK_VERIFY_TOKEN');
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
      return res.status(200).send(query['hub.challenge']);
    }
    return res.status(403).send('Forbidden');
  }

  @Post()
  receive(@Body() body: any) {
    const entries = body?.entry || [];
    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        if (change?.field !== 'leadgen') continue;
        const leadgenId = change?.value?.leadgen_id;
        if (!leadgenId) continue;
        this.service.processLeadgenEvent(leadgenId).catch(() => {});
      }
    }
    return { status: 'ok' };
  }
}
