import { HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { SmsContact, SmsContactStatus } from './entities/sms-contact.entity';
import { SmsDeliveryStatus, SmsMessage, SmsMessageSource } from './entities/sms-message.entity';
import { SMS_PROVIDER } from './providers/sms-provider.interface';
import type { ISmsProvider, NormalizedStatusUpdate } from './providers/sms-provider.interface';
import { MockSmsProvider } from './providers/mock-sms.provider';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { toE164Us } from './utils/phone.util';
import { countSegments } from './utils/segments.util';

export type ConversationFilter = 'all' | 'unread' | 'ai_paused' | 'opted_out';

export interface SendOptions {
  source: SmsMessageSource;
  /** Só o operador pode furar quiet hours — é decisão consciente dele. */
  force?: boolean;
  pauseAi?: boolean;
}

@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    @InjectRepository(SmsContact) private readonly contacts: Repository<SmsContact>,
    @InjectRepository(SmsMessage) private readonly messages: Repository<SmsMessage>,
    @Inject(SMS_PROVIDER) private readonly provider: ISmsProvider,
    private readonly realtime: RealtimeGateway,
  ) {}

  onModuleInit() {
    // O mock empurra as transições de entrega por callback (não tem webhook real).
    if (this.provider instanceof MockSmsProvider) {
      this.provider.setStatusSink((update) => {
        void this.applyStatusUpdate(update);
      });
      this.logger.log('MockSmsProvider ativo — nenhum SMS real será enviado');
    }
  }

  // ---------------------------------------------------------------- contatos

  async findContact(id: string): Promise<SmsContact> {
    const contact = await this.contacts.findOne({ where: { id } });
    if (!contact) throw new NotFoundException(`Contato SMS ${id} não encontrado`);
    return contact;
  }

  async findByPhone(phone: string): Promise<SmsContact | null> {
    return this.contacts.findOne({ where: { phone } });
  }

  async createContact(input: {
    phone: string;
    name?: string;
    email?: string;
    cohort?: string;
    timezone?: string;
    externalId?: string;
    attributes?: Record<string, unknown>;
    aiPaused?: boolean;
  }): Promise<SmsContact> {
    const phone = toE164Us(input.phone);
    if (!phone) {
      throw new HttpException('Número inválido — informe um telefone dos EUA válido', HttpStatus.BAD_REQUEST);
    }

    const existing = await this.findByPhone(phone);
    if (existing) {
      throw new HttpException('Já existe um contato com esse número', HttpStatus.CONFLICT);
    }

    const contact = await this.contacts.save(
      this.contacts.create({
        ...input,
        phone,
        status: 'active',
        unreadCount: 0,
        aiPaused: input.aiPaused ?? false,
      }),
    );

    this.realtime.emitSmsContactCreated(contact);
    return contact;
  }

  /** Cria sem lançar se já existir — usado pelo webhook de entrada. */
  async findOrCreateByPhone(phone: string, defaults?: Partial<SmsContact>): Promise<SmsContact> {
    const existing = await this.findByPhone(phone);
    if (existing) return existing;

    const contact = await this.contacts.save(
      this.contacts.create({ phone, status: 'active', unreadCount: 0, aiPaused: false, ...defaults }),
    );
    this.realtime.emitSmsContactCreated(contact);
    return contact;
  }

  async updateContact(id: string, patch: Partial<SmsContact>): Promise<SmsContact> {
    // Campos sensíveis não podem ser alterados por PATCH genérico — opt-out tem
    // rota própria porque exige registro de consentimento.
    const { id: _id, phone: _phone, optedOut, optedOutAt, unreadCount, ...safe } = patch as any;

    await this.contacts.update(id, safe);
    const contact = await this.findContact(id);
    this.realtime.emitSmsContactUpdated(contact);
    return contact;
  }

  async setAiPaused(id: string, paused: boolean): Promise<SmsContact> {
    await this.contacts.update(id, { aiPaused: paused });
    const contact = await this.findContact(id);
    this.realtime.emitSmsContactUpdated(contact);
    return contact;
  }

  async markRead(id: string): Promise<SmsContact> {
    await this.contacts.update(id, { unreadCount: 0 });
    await this.messages
      .createQueryBuilder()
      .update(SmsMessage)
      .set({ readAt: new Date() })
      .where('contact_id = :id AND direction = :dir AND read_at IS NULL', { id, dir: 'inbound' })
      .execute();

    const contact = await this.findContact(id);
    this.realtime.emitSmsContactUpdated(contact);
    return contact;
  }

  async optOut(id: string, keyword: string): Promise<SmsContact> {
    await this.contacts.update(id, {
      optedOut: true,
      optedOutAt: new Date(),
      optOutKeyword: keyword,
      status: 'opted_out' as SmsContactStatus,
      aiPaused: true,
    });
    const contact = await this.findContact(id);
    this.realtime.emitSmsContactUpdated(contact);
    this.logger.warn(`Contato ${contact.phone} fez opt-out (keyword: ${keyword})`);
    return contact;
  }

  /** Reativação nunca é automática — exige registro de consentimento. */
  async optIn(id: string, consentSource: string): Promise<SmsContact> {
    await this.contacts.update(id, {
      optedOut: false,
      optedOutAt: undefined,
      optOutKeyword: undefined,
      status: 'active' as SmsContactStatus,
      consentSource,
      consentAt: new Date(),
    });
    const contact = await this.findContact(id);
    this.realtime.emitSmsContactUpdated(contact);
    return contact;
  }

  // ----------------------------------------------------------- conversas

  async listConversations(opts: {
    search?: string;
    filter?: ConversationFilter;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 30));

    const qb = this.contacts.createQueryBuilder('c');

    if (opts.search) {
      const digits = opts.search.replace(/\D/g, '');
      qb.andWhere(
        new Brackets((w) => {
          w.where('c.name ILIKE :s', { s: `%${opts.search}%` });
          if (digits) w.orWhere('c.phone ILIKE :d', { d: `%${digits}%` });
        }),
      );
    }

    switch (opts.filter) {
      case 'unread':
        qb.andWhere('c.unread_count > 0');
        break;
      case 'ai_paused':
        qb.andWhere('c.ai_paused = true AND c.opted_out = false');
        break;
      case 'opted_out':
        qb.andWhere('c.opted_out = true');
        break;
    }

    const total = await qb.getCount();
    const data = await qb
      .orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // Total geral de não-lidas (independe do filtro atual) — alimenta o badge do menu.
    const unreadTotal = await this.contacts.createQueryBuilder('c').where('c.unread_count > 0').getCount();

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      unreadTotal,
    };
  }

  /**
   * Thread paginada por keyset (cursor), não offset: mensagens chegam enquanto
   * o operador rola para cima, e offset duplicaria/pularia itens.
   */
  async listMessages(contactId: string, opts: { before?: string; limit?: number }) {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));

    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.contact_id = :contactId', { contactId })
      .orderBy('m.created_at', 'DESC')
      .take(limit + 1);

    if (opts.before) {
      const cursor = new Date(opts.before);
      if (!isNaN(cursor.getTime())) {
        qb.andWhere('m.created_at < :cursor', { cursor });
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      data: page.reverse(), // ASC para renderizar direto
      hasMore,
      nextBefore: page.length ? page[0].createdAt.toISOString() : null,
    };
  }

  // -------------------------------------------------------------- envio

  async sendMessage(contactId: string, body: string, opts: SendOptions): Promise<SmsMessage> {
    const text = (body ?? '').trim();
    if (!text) throw new HttpException('Mensagem vazia', HttpStatus.BAD_REQUEST);

    const contact = await this.findContact(contactId);

    // Guard central de compliance: nenhuma rota (operador, IA, cadência futura)
    // consegue furar isso.
    if (contact.optedOut) {
      throw new HttpException(
        { code: 'CONTACT_OPTED_OUT', message: 'Contato fez opt-out e não pode receber mensagens' },
        HttpStatus.CONFLICT,
      );
    }

    const { segments } = countSegments(text);

    let message = await this.messages.save(
      this.messages.create({
        contactId: contact.id,
        direction: 'outbound',
        body: text,
        status: 'queued',
        source: opts.source,
        providerName: this.provider.name,
        segments,
        fromNumber: this.provider.getSenderNumber(),
        toNumber: contact.phone,
      }),
    );

    await this.touchLastMessage(contact.id, text, 'outbound');
    this.realtime.emitSmsMessageCreated(message);

    try {
      const result = await this.provider.send({
        to: contact.phone,
        body: text,
        clientRef: message.id,
      });

      await this.messages.update(message.id, {
        providerMessageId: result.providerMessageId,
        status: result.status,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        segments: result.segments ?? segments,
        sentAt: result.status === 'sent' ? new Date() : undefined,
      });
      message = await this.messages.findOneOrFail({ where: { id: message.id } });
      this.emitStatus(message);
    } catch (err: any) {
      this.logger.error(`Falha ao enviar SMS para ${contact.phone}: ${err?.message ?? err}`);
      await this.messages.update(message.id, {
        status: 'failed',
        errorMessage: String(err?.message ?? err),
        failedAt: new Date(),
      });
      message = await this.messages.findOneOrFail({ where: { id: message.id } });
      this.emitStatus(message);
    }

    // Operador digitou = assumiu a conversa.
    if (opts.pauseAi && !contact.aiPaused) {
      await this.setAiPaused(contact.id, true);
    } else {
      this.realtime.emitSmsContactUpdated(await this.findContact(contact.id));
    }

    return message;
  }

  /**
   * Evento de sistema na thread (ex: "AI paused", "Contact opted out").
   * NÃO é um SMS — nada é enviado. O flag `meta.systemEvent` é o que faz a tela
   * renderizar como chip centralizado em vez de bolha.
   */
  async logSystemEvent(contactId: string, body: string): Promise<SmsMessage> {
    const message = await this.messages.save(
      this.messages.create({
        contactId,
        direction: 'outbound',
        body,
        status: 'delivered',
        source: 'system',
        providerName: this.provider.name,
        meta: { systemEvent: true },
      }),
    );
    this.realtime.emitSmsMessageCreated(message);
    return message;
  }

  // ------------------------------------------------------------- entrada

  async recordInbound(contact: SmsContact, body: string, providerMessageId?: string): Promise<SmsMessage | null> {
    try {
      const message = await this.messages.save(
        this.messages.create({
          contactId: contact.id,
          direction: 'inbound',
          body,
          status: 'received',
          source: 'contact',
          providerName: this.provider.name,
          providerMessageId,
          fromNumber: contact.phone,
          toNumber: this.provider.getSenderNumber(),
        }),
      );

      // increment() é atômico — o padrão read-modify-write teria race entre o
      // webhook e o operador marcando como lido.
      await this.contacts.increment({ id: contact.id }, 'unreadCount', 1);
      await this.touchLastMessage(contact.id, body, 'inbound');

      this.realtime.emitSmsMessageCreated(message);
      this.realtime.emitSmsContactUpdated(await this.findContact(contact.id));
      return message;
    } catch (err: any) {
      // Violação do unique de provider_message_id = webhook duplicado.
      if (err?.code === '23505') {
        this.logger.warn(`Mensagem duplicada ignorada (${providerMessageId})`);
        return null;
      }
      throw err;
    }
  }

  async applyStatusUpdate(update: NormalizedStatusUpdate): Promise<void> {
    const where = update.clientRef
      ? { id: update.clientRef }
      : update.providerMessageId
        ? { providerMessageId: update.providerMessageId }
        : null;
    if (!where) return;

    const message = await this.messages.findOne({ where: where as any });
    if (!message) return;

    // Não regride status: um `sent` atrasado não pode sobrescrever `delivered`.
    const rank: Record<SmsDeliveryStatus, number> = {
      queued: 0,
      sending: 1,
      sent: 2,
      received: 2,
      delivered: 3,
      undelivered: 3,
      failed: 3,
    };
    if (rank[update.status] < rank[message.status]) return;

    await this.messages.update(message.id, {
      status: update.status,
      providerStatusRaw: update.rawStatus,
      errorCode: update.errorCode,
      errorMessage: update.errorMessage,
      sentAt: update.status === 'sent' ? update.occurredAt : message.sentAt,
      deliveredAt: update.status === 'delivered' ? update.occurredAt : message.deliveredAt,
      failedAt: update.status === 'failed' || update.status === 'undelivered' ? update.occurredAt : message.failedAt,
    });

    this.emitStatus(await this.messages.findOneOrFail({ where: { id: message.id } }));
  }

  // --------------------------------------------------------------- stats

  async getStats() {
    const [totalContacts, optedOut, unreadConversations] = await Promise.all([
      this.contacts.count(),
      this.contacts.count({ where: { optedOut: true } }),
      this.contacts.createQueryBuilder('c').where('c.unread_count > 0').getCount(),
    ]);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const messagesLast24h = await this.messages
      .createQueryBuilder('m')
      .where('m.created_at >= :since', { since })
      .getCount();

    return {
      totalContacts,
      active: totalContacts - optedOut,
      optedOut,
      unreadConversations,
      messagesLast24h,
      provider: this.provider.name,
      fromNumber: this.provider.getSenderNumber(),
    };
  }

  // ------------------------------------------------------------ internos

  private async touchLastMessage(contactId: string, body: string, direction: 'inbound' | 'outbound') {
    await this.contacts.update(contactId, {
      lastMessageAt: new Date(),
      lastMessagePreview: body.slice(0, 280),
      lastMessageDirection: direction,
    });
  }

  private emitStatus(message: SmsMessage) {
    this.realtime.emitSmsMessageStatus({
      id: message.id,
      contactId: message.contactId,
      status: message.status,
      errorCode: message.errorCode,
      errorMessage: message.errorMessage,
      deliveredAt: message.deliveredAt ?? null,
    });
  }
}
