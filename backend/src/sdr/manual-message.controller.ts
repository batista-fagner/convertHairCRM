import { Controller, Post, Param, Body, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { Lead } from '../common/entities/lead.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AvatarStorageService } from './avatar-storage.service';
import { SettingsService } from '../settings/settings.service';

export const CURIOSITY_MESSAGES_KEY = 'curiosity_messages';
export const DEFAULT_CURIOSITY_MESSAGES = [
  'Oi, tudo bem? 👋',
  'Vi seu perfil e achei muito interessante',
  'Tenho uma coisa que pode te ajudar bastante',
  'Deixa eu te mostrar uma coisa rápida',
  'Ops, deixa eu reformular isso aqui 🙈',
];

type MediaType = 'image' | 'video' | 'document' | 'audio';

interface SendMessageDto {
  type: 'text' | MediaType;
  text?: string;
  base64?: string;
  mimeType?: string;
  filename?: string;
  caption?: string;
}

@Controller('leads')
export class ManualMessageController {
  private readonly logger = new Logger(ManualMessageController.name);
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;

  constructor(
    @InjectRepository(Lead)
    private leadsRepo: Repository<Lead>,
    private http: HttpService,
    private config: ConfigService,
    private realtime: RealtimeGateway,
    private avatarStorage: AvatarStorageService,
    private settings: SettingsService,
  ) {
    this.uazapiBaseUrl = config.get('SDR_UAZAPI_BASE_URL') || config.get('UAZAPI_BASE_URL') || '';
    this.uazapiToken = config.get('SDR_UAZAPI_TOKEN') || '';
  }

  @Post(':id/send-message')
  async sendManualMessage(@Param('id') id: string, @Body() body: SendMessageDto) {
    const lead = await this.leadsRepo.findOne({ where: { id } });
    if (!lead) throw new HttpException('Lead not found', HttpStatus.NOT_FOUND);

    if (!this.uazapiToken) {
      throw new HttpException('WhatsApp não configurado (SDR_UAZAPI_TOKEN ausente)', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const phone = lead.phone.startsWith('55') ? lead.phone : `55${lead.phone}`;

    const waMessageId = await this.dispatchToUazapi(phone, body);

    const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    const entry: Record<string, any> = { role: 'assistant', source: 'operator', timestamp: new Date().toISOString() };
    if (waMessageId) entry.waMessageIds = [waMessageId];

    if (body.type === 'text') {
      entry.content = body.text || '';
    } else {
      entry.content = body.caption || '';
      entry.mediaType = body.type;
      entry.filename = body.filename || body.type;
      // Store base64 for inline display in the conversation modal.
      // Frontend enforces a 5 MB file size limit before sending.
      if (body.base64) entry.base64 = body.base64;
    }

    await this.leadsRepo.update(id, {
      aiContext: [...ctx, entry],
      waLastMessageAt: new Date(),
    });

    const fresh = await this.leadsRepo.findOne({ where: { id } });
    if (fresh) this.realtime.emitLeadUpdated(fresh);

    this.logger.log(`[Manual] Operador enviou ${body.type} para ${lead.phone}`);
    return { ok: true };
  }

  // Estratégia de "gerar curiosidade": manda uma sequência curta de mensagens
  // e apaga cada uma pra todos (revoke) imediatamente depois de enviada, antes
  // que o lead consiga ler — ela só vê "Esta mensagem foi apagada" e tende a
  // responder perguntando o que era, o que abre uma conversa mais natural do
  // que uma abordagem fria. Cada mensagem é apagada logo após o envio (não
  // espera mandar as 5 primeiro) pra minimizar a janela em que ela fica visível.
  @Post(':id/curiosity-blast')
  async curiosityBlast(@Param('id') id: string) {
    const lead = await this.leadsRepo.findOne({ where: { id } });
    if (!lead) throw new HttpException('Lead not found', HttpStatus.NOT_FOUND);
    if (!this.uazapiToken) {
      throw new HttpException('WhatsApp não configurado (SDR_UAZAPI_TOKEN ausente)', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const stored = await this.settings.get(CURIOSITY_MESSAGES_KEY);
    let messages: string[];
    try {
      messages = stored ? JSON.parse(stored) : DEFAULT_CURIOSITY_MESSAGES;
    } catch {
      messages = DEFAULT_CURIOSITY_MESSAGES;
    }
    messages = messages.map((m) => (m || '').trim()).filter(Boolean);
    if (messages.length === 0) messages = DEFAULT_CURIOSITY_MESSAGES;

    const phone = lead.phone.startsWith('55') ? lead.phone : `55${lead.phone}`;
    const headers = { token: this.uazapiToken };
    let sent = 0;
    let deleted = 0;
    // Uma entrada por mensagem, renderizada no Kanban como balão "Mensagem
    // apagada" (igual ao WhatsApp real) — não entra no histórico que a IA usa
    // pra responder (sdr.service.ts/sdr-followup.service.ts/group-workshop.service.ts
    // filtram `whatsappDeleted: true` antes de montar o prompt do OpenAI).
    const newEntries: Record<string, any>[] = [];

    for (const text of messages) {
      try {
        const res = await firstValueFrom(
          this.http.post(`${this.uazapiBaseUrl}/send/text`, { number: phone, text }, { headers }),
        );
        sent++;
        const messageId = (res.data as any)?.messageid;
        if (!messageId) continue;

        try {
          await firstValueFrom(
            this.http.post(`${this.uazapiBaseUrl}/message/delete`, { number: phone, id: messageId }, { headers }),
          );
          deleted++;
          newEntries.push({
            role: 'assistant',
            whatsappDeleted: true,
            content: text,
            timestamp: new Date().toISOString(),
          });
        } catch (delErr: any) {
          this.logger.warn(`[Curiosity] Falha ao apagar mensagem de ${lead.phone}: ${delErr.message}`);
        }
      } catch (sendErr: any) {
        this.logger.warn(`[Curiosity] Falha ao enviar mensagem de ${lead.phone}: ${sendErr.message}`);
      }
      // Pequeno intervalo entre cada ciclo pra não sobrecarregar/disparar
      // rate-limit da uazapi — não é sobre a curiosidade em si (que já é
      // resolvida pelo delete imediato), é só espaçamento técnico.
      await new Promise((r) => setTimeout(r, 400));
    }

    this.logger.log(`[Curiosity] ${lead.phone}: ${sent} enviadas, ${deleted} apagadas`);

    const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    await this.leadsRepo.update(id, { aiContext: [...ctx, ...newEntries] });
    const fresh = await this.leadsRepo.findOne({ where: { id } });
    if (fresh) this.realtime.emitLeadUpdated(fresh);

    return { ok: true, sent, deleted, total: messages.length };
  }

  /**
   * "Apagar para todos" de uma mensagem enviada (Sofia, operador ou follow-up).
   * A mensagem é achada pela posição no ai_context + timestamp (confere que é a
   * mesma que o operador viu — o histórico pode ter crescido desde então).
   * Só apaga o que tem ID do WhatsApp guardado (mensagens antigas não têm). Uma
   * resposta da Sofia em 2 bolhas é uma entrada só: apaga as duas.
   */
  @Post(':id/messages/delete')
  async deleteMessageForAll(@Param('id') id: string, @Body() body: { index: number; timestamp: string }) {
    const lead = await this.leadsRepo.findOne({ where: { id } });
    if (!lead) throw new HttpException('Lead not found', HttpStatus.NOT_FOUND);
    if (!this.uazapiToken) {
      throw new HttpException('WhatsApp não configurado (SDR_UAZAPI_TOKEN ausente)', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    const entry = Number.isInteger(body?.index) ? ctx[body.index] : undefined;
    if (!entry || entry.timestamp !== body.timestamp) {
      throw new HttpException('Mensagem não encontrada — recarregue a conversa', HttpStatus.NOT_FOUND);
    }
    if (entry.role !== 'assistant') {
      throw new HttpException('Só dá pra apagar mensagens enviadas por nós', HttpStatus.BAD_REQUEST);
    }
    if (entry.whatsappDeleted) return { ok: true, alreadyDeleted: true };
    const ids: string[] = Array.isArray(entry.waMessageIds) ? entry.waMessageIds : [];
    if (ids.length === 0) {
      throw new HttpException('Essa mensagem é anterior à função de apagar e não pode ser apagada pelo CRM', HttpStatus.BAD_REQUEST);
    }

    const phone = lead.phone.startsWith('55') ? lead.phone : `55${lead.phone}`;
    const headers = { token: this.uazapiToken };
    let deleted = 0;
    for (const messageId of ids) {
      try {
        await firstValueFrom(
          this.http.post(`${this.uazapiBaseUrl}/message/delete`, { number: phone, id: messageId }, { headers }),
        );
        deleted++;
      } catch (err: any) {
        this.logger.warn(`[Manual] Falha ao apagar mensagem ${messageId} de ${lead.phone}: ${err.response?.data?.error || err.message}`);
      }
    }
    if (deleted === 0) {
      throw new HttpException('O WhatsApp não aceitou apagar essa mensagem', HttpStatus.BAD_GATEWAY);
    }

    // Marca no lugar (jsonb_set na posição, conferindo o timestamp no WHERE) pra
    // não sobrescrever mensagens que chegaram enquanto o delete rodava. O balão
    // vira "Mensagem apagada" e a IA deixa de considerar essa mensagem.
    await this.leadsRepo.query(
      `UPDATE leads SET ai_context = jsonb_set(ai_context, ARRAY[$2::text, 'whatsappDeleted'], 'true'::jsonb)
       WHERE id = $1 AND ai_context->($2::int)->>'timestamp' = $3`,
      [id, String(body.index), body.timestamp],
    );

    const fresh = await this.leadsRepo.findOne({ where: { id } });
    if (fresh) this.realtime.emitLeadUpdated(fresh);
    this.logger.log(`[Manual] Mensagem apagada para todos em ${lead.phone} (${deleted}/${ids.length} bolhas)`);
    return { ok: true, deleted, total: ids.length };
  }

  @Post(':id/fetch-avatar')
  async fetchAvatar(@Param('id') id: string) {
    const lead = await this.leadsRepo.findOne({ where: { id } });
    if (!lead) throw new HttpException('Lead not found', HttpStatus.NOT_FOUND);
    if (!this.uazapiToken) {
      throw new HttpException('WhatsApp não configurado (SDR_UAZAPI_TOKEN ausente)', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const phone = lead.phone.startsWith('55') ? lead.phone : `55${lead.phone}`;

    try {
      const res = await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/chat/details`,
          { number: phone, preview: true },
          { headers: { token: this.uazapiToken } },
        ),
      );
      const data = res.data as { imagePreview?: string; image?: string; name?: string; wa_contactName?: string; wa_name?: string };
      const rawAvatarUrl = data.imagePreview || data.image || null;
      const realName = data.name || data.wa_contactName || data.wa_name;

      const avatarUrl = rawAvatarUrl ? await this.avatarStorage.persistFromUrl(id, rawAvatarUrl) : null;
      const patch: Record<string, any> = { avatarUrl };
      // Só sobrescreve o nome se ainda estiver no placeholder "Lead XXXX" —
      // não pisa em cima de um nome já coletado pela IA ou editado manualmente.
      if (realName && /^Lead \d+$/.test(lead.name)) patch.name = realName;

      await this.leadsRepo.update(id, patch);
      const fresh = await this.leadsRepo.findOne({ where: { id } });
      if (fresh) this.realtime.emitLeadUpdated(fresh);
      return { avatarUrl, name: patch.name };
    } catch (err: any) {
      this.logger.warn(`[Manual] Falha ao buscar foto de perfil de ${phone}: ${err.message}`);
      return { avatarUrl: null };
    }
  }

  /** Envia pela uazapi e devolve o ID da mensagem no WhatsApp (usado pra apagar depois). */
  private async dispatchToUazapi(phone: string, body: SendMessageDto): Promise<string | null> {
    const headers = { token: this.uazapiToken };
    const base = this.uazapiBaseUrl;

    try {
      if (body.type === 'text') {
        const res = await firstValueFrom(
          this.http.post(`${base}/send/text`, { number: phone, text: body.text }, { headers }),
        );
        return (res.data as any)?.messageid ?? null;
      } else {
        // uazapi expõe um único endpoint de mídia (/send/media) com "type"
        // indicando o formato. Áudio gravado pelo operador vai como "ptt"
        // pra se comportar como mensagem de voz nativa do WhatsApp.
        const mediaType = body.type === 'audio' ? 'ptt' : body.type;
        const res = await firstValueFrom(
          this.http.post(
            `${base}/send/media`,
            {
              number: phone,
              type: mediaType,
              file: body.base64,
              text: body.caption || '',
              mimetype: body.mimeType,
              ...(body.type === 'document' ? { docName: body.filename || 'arquivo' } : {}),
            },
            { headers },
          ),
        );
        return (res.data as any)?.messageid ?? null;
      }
    } catch (err: any) {
      this.logger.error(`[Manual] Falha ao enviar ${body.type} para ${phone}: ${err.message}`);
      throw new HttpException(`Falha ao enviar mensagem: ${err.message}`, HttpStatus.BAD_GATEWAY);
    }
  }
}
