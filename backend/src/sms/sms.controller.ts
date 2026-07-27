import { Body, Controller, Get, HttpException, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsService } from './sms.service';
import type { ConversationFilter } from './sms.service';
import { SmsInboundService } from './sms-inbound.service';

/**
 * REST da inbox de SMS. O projeto não tem ValidationPipe global, então a
 * validação é manual com HttpException — mesmo padrão do LeadsController.
 */
@Controller('sms')
export class SmsController {
  constructor(
    private readonly sms: SmsService,
    private readonly inbound: SmsInboundService,
    private readonly config: ConfigService,
  ) {}

  @Get('stats')
  async stats() {
    return this.sms.getStats();
  }

  @Get('conversations')
  async listConversations(
    @Query('search') search?: string,
    @Query('filter') filter?: ConversationFilter,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sms.listConversations({
      search: search?.trim() || undefined,
      filter: filter || 'all',
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 30,
    });
  }

  @Get('conversations/:id')
  async getConversation(@Param('id') id: string) {
    return this.sms.findContact(id);
  }

  @Get('conversations/:id/messages')
  async listMessages(
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    await this.sms.findContact(id); // 404 se não existir
    return this.sms.listMessages(id, {
      before,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Post('conversations/:id/messages')
  async sendMessage(@Param('id') id: string, @Body() body: { text?: string; pauseAi?: boolean }) {
    const text = (body?.text ?? '').trim();
    if (!text) throw new HttpException('Texto é obrigatório', HttpStatus.BAD_REQUEST);

    const message = await this.sms.sendMessage(id, text, {
      source: 'operator',
      force: true, // envio manual pode furar quiet hours — é decisão do operador
      pauseAi: body?.pauseAi !== false,
    });

    return { message, contact: await this.sms.findContact(id) };
  }

  @Patch('conversations/:id/read')
  async markRead(@Param('id') id: string) {
    return this.sms.markRead(id);
  }

  @Patch('conversations/:id/ai')
  async toggleAi(@Param('id') id: string, @Body() body: { paused?: boolean }) {
    if (typeof body?.paused !== 'boolean') {
      throw new HttpException('Campo "paused" (boolean) é obrigatório', HttpStatus.BAD_REQUEST);
    }
    return this.sms.setAiPaused(id, body.paused);
  }

  @Patch('conversations/:id')
  async updateContact(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      email?: string;
      cohort?: string;
      programStage?: string;
      tags?: string[];
      attributes?: Record<string, unknown>;
      assignedTo?: string;
      notes?: string;
      timezone?: string;
    },
  ) {
    return this.sms.updateContact(id, body);
  }

  @Post('contacts')
  async createContact(
    @Body() body: { phone?: string; name?: string; email?: string; cohort?: string; timezone?: string },
  ) {
    if (!body?.phone) throw new HttpException('Telefone é obrigatório', HttpStatus.BAD_REQUEST);
    return this.sms.createContact({
      phone: body.phone,
      name: body.name?.trim() || undefined,
      email: body.email?.trim() || undefined,
      cohort: body.cohort?.trim() || undefined,
      timezone: body.timezone?.trim() || undefined,
    });
  }

  @Post('conversations/:id/opt-out')
  async optOut(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.sms.optOut(id, body?.reason || 'manual');
  }

  @Post('conversations/:id/opt-in')
  async optIn(@Param('id') id: string, @Body() body: { consentSource?: string }) {
    if (!body?.consentSource) {
      throw new HttpException(
        'consentSource é obrigatório — reativação exige registro de consentimento',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.sms.optIn(id, body.consentSource);
  }

  // ------------------------------------------------------------------ dev

  /**
   * Injeta uma mensagem de entrada como se tivesse vindo do provedor.
   * É o que torna a demo end-to-end possível sem nenhum provedor contratado.
   * Bloqueado quando um provedor real está configurado.
   */
  @Post('dev/simulate-inbound')
  async simulateInbound(@Body() body: { phone?: string; text?: string }) {
    this.assertMockProvider();
    if (!body?.phone || !body?.text) {
      throw new HttpException('phone e text são obrigatórios', HttpStatus.BAD_REQUEST);
    }
    return this.inbound.handleInbound({
      providerMessageId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from: body.phone,
      to: '',
      body: body.text,
      receivedAt: new Date(),
    });
  }

  private assertMockProvider() {
    const provider = (this.config.get<string>('SMS_PROVIDER') ?? 'mock').toLowerCase();
    if (provider !== 'mock') {
      throw new HttpException('Endpoint disponível apenas com SMS_PROVIDER=mock', HttpStatus.FORBIDDEN);
    }
  }
}
