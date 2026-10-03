import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GoogleCalendarService } from './google-calendar.service';

const page = (title: string, text: string) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a">
<div style="text-align:center;max-width:420px;padding:16px"><h1 style="font-size:20px">${title}</h1><p style="color:#475569">${text}</p></div></body></html>`;

@Controller('google-calendar')
export class GoogleCalendarController {
  constructor(private readonly calendar: GoogleCalendarService) {}

  /** Abre a tela de autorização do Google (o botão do CRM aponta pra cá). */
  @Get('connect')
  connect(@Res() res: Response) {
    res.redirect(this.calendar.getAuthUrl());
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('error') error: string, @Res() res: Response) {
    if (error || !code) {
      res.status(400).send(page('Conexão cancelada', 'O Google Agenda não foi conectado. Feche esta aba e tente de novo pelo CRM.'));
      return;
    }
    try {
      const email = await this.calendar.handleCallback(code);
      res.send(page('Google Agenda conectado ✓', `${email ? `Conta: ${email}. ` : ''}Pode fechar esta aba e voltar pro CRM.`));
    } catch (err: any) {
      res.status(400).send(page('Erro ao conectar', err?.message ?? 'Tente de novo pelo CRM.'));
    }
  }

  @Get('status')
  status() {
    return this.calendar.getStatus();
  }
}
