import { Controller, Post, Param, Body, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { Lead } from '../common/entities/lead.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

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

    await this.dispatchToUazapi(phone, body);

    const ctx = Array.isArray(lead.aiContext) ? lead.aiContext : [];
    const entry: Record<string, any> = { role: 'assistant', source: 'operator', timestamp: new Date().toISOString() };

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

  private async dispatchToUazapi(phone: string, body: SendMessageDto) {
    const headers = { token: this.uazapiToken };
    const base = this.uazapiBaseUrl;

    try {
      if (body.type === 'text') {
        await firstValueFrom(
          this.http.post(`${base}/send/text`, { number: phone, text: body.text }, { headers }),
        );
      } else {
        // uazapi expõe um único endpoint de mídia (/send/media) com "type"
        // indicando o formato. Áudio gravado pelo operador vai como "ptt"
        // pra se comportar como mensagem de voz nativa do WhatsApp.
        const mediaType = body.type === 'audio' ? 'ptt' : body.type;
        await firstValueFrom(
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
      }
    } catch (err: any) {
      this.logger.error(`[Manual] Falha ao enviar ${body.type} para ${phone}: ${err.message}`);
      throw new HttpException(`Falha ao enviar mensagem: ${err.message}`, HttpStatus.BAD_GATEWAY);
    }
  }
}
