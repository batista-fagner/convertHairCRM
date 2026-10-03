import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';

// Refresh token da conta Google conectada (uma conta só — a agenda do sócio).
// Fica na tabela settings, que nenhuma rota pública lista por inteiro.
const REFRESH_TOKEN_KEY = 'google_calendar_refresh_token';
const CONNECTED_EMAIL_KEY = 'google_calendar_email';
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'openid', 'email'];
const TIMEZONE = 'America/Sao_Paulo';

export interface CalendarEventInput {
  summary: string;
  description: string;
  start: Date;
  durationMinutes: number;
  withMeet: boolean;
  attendeeEmail?: string | null;
}

export interface CalendarEventResult {
  eventId: string;
  meetLink: string | null;
  htmlLink: string | null;
}

/**
 * Integração mínima com o Google Agenda via REST (sem googleapis — só 3
 * chamadas: troca de código, refresh de token e CRUD de evento).
 * App OAuth publicado ("Em produção", não verificado) no projeto Google Cloud
 * converthair-crm-agenda — refresh token não expira sozinho. Se for revogado,
 * é só clicar em "Conectar Google Agenda" de novo.
 */
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  private get clientId() { return this.config.get<string>('GOOGLE_CLIENT_ID') ?? ''; }
  private get clientSecret() { return this.config.get<string>('GOOGLE_CLIENT_SECRET') ?? ''; }
  private get redirectUri() { return this.config.get<string>('GOOGLE_REDIRECT_URI') ?? ''; }

  getAuthUrl(): string {
    if (!this.clientId || !this.redirectUri) throw new BadRequestException('GOOGLE_CLIENT_ID/GOOGLE_REDIRECT_URI não configurados');
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      // consent força o Google a devolver refresh_token mesmo em reconexão.
      prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async handleCallback(code: string): Promise<string | null> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const data: any = await res.json();
    if (!res.ok || !data.refresh_token) {
      throw new BadRequestException(`Google não devolveu refresh token: ${data.error_description || data.error || res.status}`);
    }
    await this.settings.set(REFRESH_TOKEN_KEY, data.refresh_token);

    // E-mail da conta conectada (só pra mostrar na tela), vem no id_token.
    let email: string | null = null;
    try {
      const payload = JSON.parse(Buffer.from(String(data.id_token).split('.')[1], 'base64url').toString());
      email = payload.email ?? null;
    } catch { /* id_token ausente não impede a conexão */ }
    if (email) await this.settings.set(CONNECTED_EMAIL_KEY, email);
    return email;
  }

  async getStatus(): Promise<{ connected: boolean; email: string | null }> {
    const token = await this.settings.get(REFRESH_TOKEN_KEY);
    return { connected: !!token, email: token ? await this.settings.get(CONNECTED_EMAIL_KEY) : null };
  }

  private async getAccessToken(): Promise<string> {
    const refreshToken = await this.settings.get(REFRESH_TOKEN_KEY);
    if (!refreshToken) throw new BadRequestException('Google Agenda não conectado');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
      }),
    });
    const data: any = await res.json();
    if (!res.ok || !data.access_token) {
      // invalid_grant = token expirado/revogado (modo Teste expira em 7 dias).
      if (data.error === 'invalid_grant') await this.settings.set(REFRESH_TOKEN_KEY, '');
      throw new BadRequestException('Conexão com o Google Agenda expirou — clique em "Conectar Google Agenda" de novo');
    }
    return data.access_token;
  }

  // keepConference: remarcação de evento que já tem Meet — não manda
  // conferenceData pra não gerar um link novo (o prospect já recebeu o antigo).
  private buildEventBody(input: CalendarEventInput, keepConference = false) {
    const end = new Date(input.start.getTime() + input.durationMinutes * 60_000);
    const conference = keepConference
      ? {}
      : input.withMeet
        ? { conferenceData: { createRequest: { requestId: `cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
        : { conferenceData: null };
    return {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start.toISOString(), timeZone: TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
      // Lembrete por e-mail no Gmail + notificação no celular.
      reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 30 }, { method: 'popup', minutes: 10 }] },
      attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : [],
      ...conference,
    };
  }

  private async request(method: string, path: string, body?: unknown, sendUpdates = false): Promise<any> {
    const token = await this.getAccessToken();
    const qs = new URLSearchParams({ conferenceDataVersion: '1', ...(sendUpdates ? { sendUpdates: 'all' } : { sendUpdates: 'none' }) });
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events${path}?${qs}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204 || res.status === 410) return null; // delete ok / já apagado
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.error(`Google Calendar ${method} ${path} → ${res.status}: ${JSON.stringify(data.error ?? data)}`);
      throw new BadRequestException(`Erro no Google Agenda: ${data.error?.message ?? res.status}`);
    }
    return data;
  }

  private toResult(event: any): CalendarEventResult {
    const meet = event.hangoutLink
      ?? event.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri
      ?? null;
    return { eventId: event.id, meetLink: meet, htmlLink: event.htmlLink ?? null };
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEventResult> {
    const event = await this.request('POST', '', this.buildEventBody(input), !!input.attendeeEmail);
    return this.toResult(event);
  }

  async updateEvent(eventId: string, input: CalendarEventInput, hadMeet: boolean): Promise<CalendarEventResult> {
    const keep = hadMeet && input.withMeet;
    const event = await this.request('PATCH', `/${encodeURIComponent(eventId)}`, this.buildEventBody(input, keep), !!input.attendeeEmail);
    return this.toResult(event);
  }

  async deleteEvent(eventId: string, notifyAttendees: boolean): Promise<void> {
    await this.request('DELETE', `/${encodeURIComponent(eventId)}`, undefined, notifyAttendees);
  }
}
