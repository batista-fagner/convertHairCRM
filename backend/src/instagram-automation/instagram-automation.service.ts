import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import OpenAI from 'openai';
import { InstagramAutomation } from './instagram-automation.entity';
import { IgConversation, IgConversationOrigin } from './ig-conversation.entity';
import { IgMessage, IgMessageDirection, IgMessageSource } from './ig-message.entity';
import { IgCommentEvent } from './ig-comment-event.entity';
import { Lead } from '../common/entities/lead.entity';
import { SettingsService } from '../settings/settings.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const IG_API = 'https://graph.instagram.com/v21.0';

const DEFAULT_IG_AI_PROMPT = `Você é uma atendente simpática respondendo comentários e DMs no Instagram.
Escreva como alguém mandando mensagem de verdade, curto, direto, no máximo 2-3 frases, com no máximo 1 emoji.
Nunca invente informação sobre produto/preço que não foi te dada no contexto.`;

// DM que chega sem vir de um comentário/automação rastreada (ex.: alguém vê o
// anúncio, mas em vez de ir pro WhatsApp manda DM direto no Instagram falando
// "quero a IA de vocês"). Chave única no key-value de settings (mesmo padrão
// do prompt da Sofia em sdr.prompt.ts).
export const IG_CATCHALL_ENABLED_KEY = 'ig_catchall_enabled';
export const IG_CATCHALL_PROMPT_KEY = 'ig_catchall_prompt';
export const IG_CATCHALL_LINK_KEY = 'ig_catchall_link';
export const IG_CATCHALL_BUTTON_KEY = 'ig_catchall_button_label';

const DEFAULT_CATCHALL_PROMPT = `Você é uma atendente simpática da Convert Hair AI respondendo mensagens diretas no Instagram.
Essas pessoas vieram de um anúncio (às vezes de um anúncio que leva pro WhatsApp, mas preferiram mandar DM direto aqui) dizendo que têm interesse na IA.
Seja breve, humana, no máximo 2-3 frases por mensagem, no máximo 1 emoji.
Se a mensagem da pessoa for só um cumprimento solto (oi, olá, boa tarde, opa, e aí etc.), sem contar nada ainda, NÃO se apresente nem dispare a pergunta de qualificação de cara — isso soa robótico. Responda o cumprimento de forma leve e natural, como alguém real responderia, e só avance pra entender o interesse dela na mensagem seguinte.
Entenda rapidamente se a pessoa vende cabelo/mega hair/perucas, e quando fizer sentido, mande o link pra continuar a conversa.
Nunca invente preço ou funcionalidade que não foi te dada no contexto.`;

interface AiReplyConfig {
  aiPrompt?: string | null;
  replyMessage?: string | null;
  link?: string | null;
}

/** Espera entre cada bloco de mensagem enviado em sequência, simulando alguém digitando. */
const BLOCK_DELAY_MS = 2000;

export type IgConversationFilter = 'all' | 'unread' | 'ai_paused';

@Injectable()
export class InstagramAutomationService {
  private readonly logger = new Logger(InstagramAutomationService.name);
  private readonly openai: OpenAI;

  constructor(
    @InjectRepository(InstagramAutomation)
    private repo: Repository<InstagramAutomation>,
    @InjectRepository(IgConversation)
    private convRepo: Repository<IgConversation>,
    @InjectRepository(IgMessage)
    private msgRepo: Repository<IgMessage>,
    @InjectRepository(IgCommentEvent)
    private commentEventRepo: Repository<IgCommentEvent>,
    @InjectRepository(Lead)
    private leadRepo: Repository<Lead>,
    private config: ConfigService,
    private settings: SettingsService,
    private realtime: RealtimeGateway,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
  }

  async getCatchallConfig() {
    const [enabled, prompt, link, buttonLabel] = await Promise.all([
      this.settings.get(IG_CATCHALL_ENABLED_KEY),
      this.settings.get(IG_CATCHALL_PROMPT_KEY),
      this.settings.get(IG_CATCHALL_LINK_KEY),
      this.settings.get(IG_CATCHALL_BUTTON_KEY),
    ]);
    return {
      enabled: enabled === 'true',
      prompt: prompt || DEFAULT_CATCHALL_PROMPT,
      isCustomPrompt: prompt != null,
      defaultPrompt: DEFAULT_CATCHALL_PROMPT,
      link: link || '',
      buttonLabel: buttonLabel || '',
    };
  }

  async setCatchallConfig(body: { enabled?: boolean; prompt?: string; link?: string; buttonLabel?: string }) {
    if (body.enabled !== undefined) await this.settings.set(IG_CATCHALL_ENABLED_KEY, body.enabled ? 'true' : 'false');
    if (body.prompt !== undefined) await this.settings.set(IG_CATCHALL_PROMPT_KEY, body.prompt.trim() || DEFAULT_CATCHALL_PROMPT);
    if (body.link !== undefined) await this.settings.set(IG_CATCHALL_LINK_KEY, body.link.trim());
    if (body.buttonLabel !== undefined) await this.settings.set(IG_CATCHALL_BUTTON_KEY, body.buttonLabel.trim());
    return this.getCatchallConfig();
  }

  private get igToken() {
    return this.config.get<string>('IG_TOKEN');
  }

  private get aiModel() {
    return this.config.get<string>('IG_AI_MODEL') || 'gpt-4o-mini';
  }

  private async getIgUserId(): Promise<string> {
    const stored = this.config.get<string>('IG_USER_ID');
    if (stored) return stored;
    const res = await axios.get(`${IG_API}/me`, {
      params: { fields: 'id,username', access_token: this.igToken },
    });
    const igId = res.data.id;
    if (igId) return igId;
    throw new Error('Conta Instagram não encontrada. Configure IG_USER_ID no .env');
  }

  findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  create(dto: Partial<InstagramAutomation>) {
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: string, dto: Partial<InstagramAutomation>) {
    await this.repo.update(id, dto);
    return this.repo.findOneBy({ id });
  }

  remove(id: string) {
    return this.repo.delete(id);
  }

  findConversations(automationId: string) {
    return this.convRepo.find({
      where: { automationId },
      order: { createdAt: 'DESC' },
    });
  }

  async getRecentMedia(after?: string) {
    const igUserId = await this.getIgUserId();
    const res = await axios.get(`${IG_API}/${igUserId}/media`, {
      params: {
        fields: 'id,media_type,media_url,thumbnail_url,timestamp,caption,permalink,children{media_url,thumbnail_url}',
        limit: 12,
        ...(after ? { after } : {}),
        access_token: this.igToken,
      },
    });
    return res.data;
  }

  async subscribeWebhook() {
    const igUserId = await this.getIgUserId();
    await axios.post(
      `${IG_API}/${igUserId}/subscribed_apps`,
      {},
      { params: { subscribed_fields: 'comments,messages', access_token: this.igToken } },
    );
    return { subscribed: true, igUserId };
  }

  /**
   * DMs (diferente de comentários) não vêm com o username no payload do
   * webhook — só o IGSID. A API do Instagram permite resolver o perfil de
   * quem já trocou mensagem com a conta via este endpoint.
   */
  private async fetchIgUsername(igsid: string): Promise<string | undefined> {
    try {
      const res = await axios.get(`${IG_API}/${igsid}`, {
        params: { fields: 'username', access_token: this.igToken },
      });
      return res.data?.username || undefined;
    } catch (err: any) {
      this.logger.warn(`Não consegui buscar username de ${igsid}: ${err.message}`);
      return undefined;
    }
  }

  private normalize(text: string): string {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  // ─── Webhook principal ──────────────────────────────────────────────────────

  async handleWebhookEvent(body: any) {
    this.logger.log(`Webhook recebido: ${JSON.stringify(body)}`);
    const entries: any[] = body.entry || [];

    for (const entry of entries) {
      // Mensagens DM (respostas do lead)
      for (const messaging of entry.messaging || []) {
        await this.handleMessagingEvent(messaging).catch(err =>
          this.logger.error(`Erro ao processar messaging: ${err.message}`),
        );
      }

      // Comentários no post
      for (const change of entry.changes || []) {
        if (change.field !== 'comments') continue;
        await this.handleCommentEvent(change.value).catch(err =>
          this.logger.error(`Erro ao processar comentário: ${err.message}`),
        );
      }
    }
  }

  // ─── Comentário disparando automação ────────────────────────────────────────

  private async handleCommentEvent(value: any) {
    const commentText = this.normalize(value.text || '');
    const commentId: string = value.id;
    const mediaId: string = value.media?.id;
    const senderIgId: string = value.from?.id;
    const igUsername: string = value.from?.username;
    if (!commentId || !mediaId) return;

    // Ignora comentários feitos pela própria conta conectada — sem isso, a
    // resposta pública que a automação posta (replyToComment) é capturada de
    // volta pelo webhook como um novo comentário e dispara a automação de novo,
    // em loop (visto em produção: 7+ disparos em ~20s até a API do Instagram
    // começar a rejeitar com 500).
    const igUserId = await this.getIgUserId();
    if (senderIgId && senderIgId === igUserId) return;

    const automations = await this.repo.find({ where: { postId: mediaId, isActive: true } });
    const rawComment = value.text || '';
    const matchedAuto = automations.find(
      (a) => a.acceptAny || commentText.includes(this.normalize(a.keyword || 'eu quero')),
    );

    // Loga o comentário independentemente de ter batido com alguma automação —
    // é o que permite montar a jornada completa do lead (timeline), não só o
    // que virou DM. Retries do webhook são ignorados via unique(comment_id).
    let commentEventId: string | null = null;
    try {
      const saved = await this.commentEventRepo.save(
        this.commentEventRepo.create({
          commentId,
          senderIgId,
          igUsername,
          postId: mediaId,
          postCaption: matchedAuto?.postCaption,
          postThumbnail: matchedAuto?.postThumbnail,
          postPermalink: matchedAuto?.postPermalink,
          commentText: rawComment,
          matchedAutomationId: matchedAuto?.id ?? null,
        }),
      );
      commentEventId = saved.id;
    } catch (err: any) {
      if (err?.code !== '23505') this.logger.error(`Erro ao registrar comment event: ${err.message}`);
    }

    for (const auto of automations) {
      const matches = auto.acceptAny || commentText.includes(this.normalize(auto.keyword || 'eu quero'));
      if (!matches) continue;

      // Automação com IA: substitui todo o fluxo roteirizado abaixo — a IA
      // conduz a resposta pública e abre a conversa por DM decidindo sozinha
      // quando mandar o link, em vez de seguir os passos fixos de
      // confirmação/captura de email.
      if (auto.useAi && senderIgId) {
        const conv = await this.upsertConversation(senderIgId, igUsername, auto.id, 'ai_chat', {
          originType: 'comment',
          originPostId: mediaId,
          originCommentText: rawComment,
        });
        if (commentEventId) await this.commentEventRepo.update(commentEventId, { conversationId: conv.id });
        await this.recordMessage(conv.id, 'inbound', rawComment, 'contact');

        const { blocks, sendLink } = await this.generateAiReply(auto, [], rawComment);
        if (blocks.length) {
          await this.sendBlocksToComment(commentId, blocks, sendLink ? auto.dmButtonLabel : undefined, sendLink ? auto.link : undefined);
          for (const block of blocks) await this.recordMessage(conv.id, 'outbound', block, 'ai');
        }

        const publicReply = await this.generateAiCommentReply(auto, rawComment);
        if (publicReply) await this.replyToComment(commentId, publicReply);

        await this.repo.increment({ id: auto.id }, 'triggeredCount', 1);
        this.logger.log(`Automação IA "${auto.id}" disparada`);
        continue;
      }

      if (auto.captureConfirmation && senderIgId) {
        // Passo 1: enviar quick reply de confirmação. Usa comment_id (não o
        // id do usuário) porque essa é a 1ª mensagem da conversa — a API do
        // Instagram bloqueia com 403 mensagens proativas por user id pra quem
        // nunca abriu DM com a conta; resposta privada a um comentário é a
        // única forma permitida de iniciar a conversa a partir daqui.
        const question = auto.confirmationQuestion || 'Quer receber o material gratuito? 👇';
        await this.sendQuickReply(commentId, question);

        const conv = await this.upsertConversation(senderIgId, igUsername, auto.id, 'waiting_confirmation', {
          originType: 'comment',
          originPostId: mediaId,
          originCommentText: rawComment,
        });
        if (commentEventId) await this.commentEventRepo.update(commentEventId, { conversationId: conv.id });
        await this.recordMessage(conv.id, 'outbound', question, 'ai');
      } else if (auto.captureEmail && senderIgId) {
        // Pula confirmação, vai direto pedir email — mesmo motivo acima: 1ª
        // mensagem da conversa precisa ir via comment_id, não user id.
        const question = auto.emailQuestion || 'Oi! Qual é o seu melhor email? 😊';
        await this.sendDm(commentId, question);

        const conv = await this.upsertConversation(senderIgId, igUsername, auto.id, 'waiting_email', {
          originType: 'comment',
          originPostId: mediaId,
          originCommentText: rawComment,
        });
        if (commentEventId) await this.commentEventRepo.update(commentEventId, { conversationId: conv.id });
        await this.recordMessage(conv.id, 'outbound', question, 'ai');
      } else {
        // Fluxo direto: envia DM com link
        await this.sendDm(commentId, auto.replyMessage, auto.dmButtonLabel, auto.link);

        if (senderIgId) {
          const conv = await this.upsertConversation(senderIgId, igUsername, auto.id, 'completed', {
            originType: 'comment',
            originPostId: mediaId,
            originCommentText: rawComment,
          });
          if (commentEventId) await this.commentEventRepo.update(commentEventId, { conversationId: conv.id });
          await this.recordMessage(conv.id, 'outbound', auto.replyMessage, 'ai');
        }
      }

      if (auto.commentReply) {
        await this.replyToComment(commentId, auto.commentReply);
      }
      await this.repo.increment({ id: auto.id }, 'triggeredCount', 1);
      this.logger.log(`Automação "${auto.id}" disparada`);
    }
  }

  // ─── Resposta via DM ─────────────────────────────────────────────────────────

  private async handleMessagingEvent(messaging: any) {
    // Ignora ecos (mensagens enviadas pela própria conta) — o campo `is_echo`
    // vem DENTRO de `message`, não no nível raiz do evento. Checar no lugar
    // errado (bug pré-existente) fazia toda resposta da IA ser reprocessada
    // como se fosse uma nova DM recebida da própria conta, criando uma
    // conversa catch-all fantasma que ficava respondendo a si mesma em loop.
    if (messaging.message?.is_echo) return;

    const senderIgId: string = messaging.sender?.id;
    const text: string = messaging.message?.text?.trim();
    const quickReplyPayload: string = messaging.message?.quick_reply?.payload;
    if (!senderIgId || !text) return;

    this.logger.log(`DM de ${senderIgId}: "${text}" | payload: ${quickReplyPayload}`);

    // Busca conversa ativa mais recente
    const conv = await this.convRepo.findOne({
      where: { senderIgId },
      order: { updatedAt: 'DESC' },
    });

    // Nenhuma conversa rastreada (não veio de comentário/automação nenhuma) —
    // ex.: a pessoa viu o anúncio mas mandou DM direto no Instagram em vez de
    // ir pro WhatsApp. Se a IA "catch-all" estiver ligada, abre a conversa
    // agora mesmo; senão, mantém o comportamento antigo (ignora).
    if (!conv) {
      const catchall = await this.getCatchallConfig();
      if (!catchall.enabled) return;
      this.logger.log(`DM catch-all: nova conversa com ${senderIgId}`);

      const igUsername = await this.fetchIgUsername(senderIgId);
      const newConv = await this.convRepo.save(
        this.convRepo.create({ senderIgId, igUsername, automationId: null, step: 'ai_chat', originType: 'direct' }),
      );
      this.realtime.emitIgConversationCreated(newConv);
      await this.recordMessage(newConv.id, 'inbound', text, 'contact');

      const { blocks, sendLink } = await this.generateAiReply(
        { aiPrompt: catchall.prompt, link: catchall.link },
        [],
        text,
      );
      if (!blocks.length) return;
      await this.sendBlocksToUser(senderIgId, blocks, sendLink ? catchall.buttonLabel : undefined, sendLink ? catchall.link : undefined);
      for (const block of blocks) await this.recordMessage(newConv.id, 'outbound', block, 'ai');
      return;
    }

    // Conversas antigas/DM não têm username salvo (só comentário traz isso no
    // payload) — busca uma vez e preenche, pra parar de aparecer só o ID.
    if (!conv.igUsername) {
      const igUsername = await this.fetchIgUsername(senderIgId);
      if (igUsername) {
        conv.igUsername = igUsername;
        await this.convRepo.update(conv.id, { igUsername });
      }
    }

    if (conv.step === 'completed') {
      // Continua registrando pra jornada aparecer completa na inbox, mas não responde mais.
      await this.recordMessage(conv.id, 'inbound', text, 'contact');
      return;
    }

    if (conv.aiPaused) {
      // Operador assumiu a conversa — só registra, quem responde é o humano
      // pelo endpoint de envio manual (sendOperatorMessage).
      await this.recordMessage(conv.id, 'inbound', text, 'contact');
      return;
    }

    const auto = conv.automationId ? await this.repo.findOneBy({ id: conv.automationId }) : null;

    // ── Passo: conversa conduzida pela IA (automação específica OU catch-all) ──
    if (conv.step === 'ai_chat') {
      const catchall = auto ? null : await this.getCatchallConfig();
      const aiConfig: AiReplyConfig = auto ?? { aiPrompt: catchall!.prompt, link: catchall!.link };
      const dmButtonLabel = auto ? auto.dmButtonLabel : catchall!.buttonLabel;

      const history = await this.buildAiHistory(conv.id, conv.contextResetAt);
      await this.recordMessage(conv.id, 'inbound', text, 'contact');

      const { blocks, sendLink } = await this.generateAiReply(aiConfig, history, text);
      if (blocks.length) {
        await this.sendBlocksToUser(senderIgId, blocks, sendLink ? dmButtonLabel : undefined, sendLink ? aiConfig.link ?? undefined : undefined);
        for (const block of blocks) await this.recordMessage(conv.id, 'outbound', block, 'ai');
      }

      // Se a pessoa mandar um email no meio da conversa, salva como lead —
      // a IA pode pedir isso naturalmente sem precisar do passo fixo antigo.
      if (this.isValidEmail(text)) {
        const email = text.toLowerCase().trim();
        await this.saveLead(email, conv);
        await this.convRepo.update(conv.id, { email, emailCapturedAt: conv.emailCapturedAt ?? new Date() });
      }
      return;
    }

    // ── Passo: esperando confirmação (Yes/No) ──
    if (conv.step === 'waiting_confirmation') {
      await this.recordMessage(conv.id, 'inbound', text, 'contact');

      const isYes = quickReplyPayload === 'CONFIRM_YES' || /^(s|si|sim|yes|quero|ok|vai|bora)$/i.test(this.normalize(text));
      const isNo = quickReplyPayload === 'CONFIRM_NO' || /^(n|nao|no|nope|nã)/.test(this.normalize(text));

      if (isYes) {
        if (auto?.captureEmail) {
          const question = auto.emailQuestion || 'Ótimo! Qual é o seu melhor email? 😊';
          await this.sendDmToUser(senderIgId, question);
          await this.recordMessage(conv.id, 'outbound', question, 'ai');
          await this.convRepo.update(conv.id, { step: 'waiting_email' });
        } else {
          // Sem captura de email: envia o link direto
          if (auto?.replyMessage) {
            await this.sendDmToUser(senderIgId, auto.replyMessage, auto.dmButtonLabel, auto.link);
            await this.recordMessage(conv.id, 'outbound', auto.replyMessage, 'ai');
          }
          await this.convRepo.update(conv.id, { step: 'completed' });
        }
      } else if (isNo) {
        const bye = 'Tudo bem! Se mudar de ideia é só me chamar 😊';
        await this.sendDmToUser(senderIgId, bye);
        await this.recordMessage(conv.id, 'outbound', bye, 'ai');
        await this.convRepo.update(conv.id, { step: 'completed' });
      }
      // Se não for nem sim nem não, ignora (pode ser outra mensagem aleatória)
      return;
    }

    // ── Passo: esperando email ──
    if (conv.step === 'waiting_email') {
      await this.recordMessage(conv.id, 'inbound', text, 'contact');

      if (!this.isValidEmail(text)) {
        const retry = 'Hmm, não parece um email válido 🤔 Pode me mandar novamente? Ex: nome@gmail.com';
        await this.sendDmToUser(senderIgId, retry);
        await this.recordMessage(conv.id, 'outbound', retry, 'ai');
        return;
      }

      const email = text.toLowerCase().trim();
      await this.saveLead(email, conv);

      let reply: string;
      if (auto?.replyMessage) {
        await this.sendDmToUser(senderIgId, auto.replyMessage, auto.dmButtonLabel, auto.link);
        reply = auto.replyMessage;
      } else {
        reply = 'Perfeito! Em breve você receberá mais informações 🙌';
        await this.sendDmToUser(senderIgId, reply);
      }
      await this.recordMessage(conv.id, 'outbound', reply, 'ai');

      await this.convRepo.update(conv.id, {
        step: 'completed',
        email,
        emailCapturedAt: conv.emailCapturedAt ?? new Date(),
      });
    }
  }

  // ─── Inbox: mensagens normalizadas (ig_messages) ────────────────────────────

  /**
   * Fonte única de verdade de uma conversa. Toda entrada/saída passa por
   * aqui: grava a IgMessage, denormaliza os campos de lista (last_message_*,
   * unread_count) e emite os eventos de tempo real da inbox.
   */
  private async recordMessage(
    conversationId: string,
    direction: IgMessageDirection,
    body: string,
    source: IgMessageSource,
    meta?: Record<string, unknown>,
  ): Promise<IgMessage> {
    const message = await this.msgRepo.save(
      this.msgRepo.create({ conversationId, direction, body, source, meta }),
    );

    if (direction === 'inbound') {
      await this.convRepo.increment({ id: conversationId }, 'unreadCount', 1);
    }
    await this.convRepo.update(conversationId, {
      lastMessageAt: new Date(),
      lastMessagePreview: body.slice(0, 280),
      lastMessageDirection: direction,
    });

    this.realtime.emitIgMessageCreated(message);
    const conv = await this.convRepo.findOneBy({ id: conversationId });
    if (conv) this.realtime.emitIgConversationUpdated(conv);
    return message;
  }

  /** Últimas ~40 mensagens (em ordem cronológica) usadas como contexto da IA. Ignora tudo antes de `contextResetAt`, se setado (ver resetContext). */
  private async buildAiHistory(conversationId: string, contextResetAt?: Date | null) {
    const qb = this.msgRepo
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId })
      .orderBy('m.created_at', 'DESC')
      .take(40);
    if (contextResetAt) qb.andWhere('m.created_at > :cutoff', { cutoff: contextResetAt });

    const rows = await qb.getMany();
    return rows.reverse().map((r) => ({ role: r.direction === 'inbound' ? 'user' : 'assistant', content: r.body }));
  }

  // ─── Inbox: API pra tela (mirror da SmsService) ─────────────────────────────

  async listConversations(opts: { search?: string; filter?: IgConversationFilter; page?: number; limit?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 30));

    const qb = this.convRepo.createQueryBuilder('c');
    if (opts.search) {
      qb.andWhere('c.ig_username ILIKE :s', { s: `%${opts.search}%` });
    }
    switch (opts.filter) {
      case 'unread':
        qb.andWhere('c.unread_count > 0');
        break;
      case 'ai_paused':
        qb.andWhere('c.ai_paused = true');
        break;
    }

    const total = await qb.getCount();
    const data = await qb
      .orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const unreadTotal = await this.convRepo.createQueryBuilder('c').where('c.unread_count > 0').getCount();

    return { data, total, page, totalPages: Math.ceil(total / limit) || 1, unreadTotal };
  }

  async getConversation(id: string): Promise<IgConversation> {
    const conv = await this.convRepo.findOneBy({ id });
    if (!conv) throw new NotFoundException(`Conversa ${id} não encontrada`);
    return conv;
  }

  /** Thread paginada por keyset (cursor) — mesma lógica da SmsService.listMessages. */
  async listMessages(conversationId: string, opts: { before?: string; limit?: number }) {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));

    const qb = this.msgRepo
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId })
      .orderBy('m.created_at', 'DESC')
      .take(limit + 1);

    if (opts.before) {
      const cursor = new Date(opts.before);
      if (!isNaN(cursor.getTime())) qb.andWhere('m.created_at < :cursor', { cursor });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      data: page.reverse(),
      hasMore,
      nextBefore: page.length ? page[0].createdAt.toISOString() : null,
    };
  }

  /** Timeline de comentários do contato — inclui os que ainda não têm conversationId vinculado. */
  async listCommentEvents(conversationId: string) {
    const conv = await this.getConversation(conversationId);
    const [byConv, bySender] = await Promise.all([
      this.commentEventRepo.find({ where: { conversationId }, order: { createdAt: 'ASC' } }),
      this.commentEventRepo.find({ where: { senderIgId: conv.senderIgId, conversationId: IsNull() }, order: { createdAt: 'ASC' } }),
    ]);

    const seen = new Set<string>();
    return [...bySender, ...byConv]
      .filter((e) => (seen.has(e.commentId) ? false : (seen.add(e.commentId), true)))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async sendOperatorMessage(conversationId: string, text: string) {
    const conv = await this.getConversation(conversationId);
    await this.sendDmToUser(conv.senderIgId, text);
    const message = await this.recordMessage(conversationId, 'outbound', text, 'operator');
    await this.convRepo.update(conversationId, { aiPaused: true });
    const updated = await this.getConversation(conversationId);
    this.realtime.emitIgConversationUpdated(updated);
    return { message, conversation: updated };
  }

  async markRead(conversationId: string) {
    await this.convRepo.update(conversationId, { unreadCount: 0 });
    await this.msgRepo
      .createQueryBuilder()
      .update(IgMessage)
      .set({ readAt: new Date() })
      .where('conversation_id = :id AND direction = :dir AND read_at IS NULL', { id: conversationId, dir: 'inbound' })
      .execute();

    const conv = await this.getConversation(conversationId);
    this.realtime.emitIgConversationUpdated(conv);
    return conv;
  }

  async setAiPaused(conversationId: string, paused: boolean) {
    await this.convRepo.update(conversationId, { aiPaused: paused });
    const conv = await this.getConversation(conversationId);
    this.realtime.emitIgConversationUpdated(conv);
    return conv;
  }

  /**
   * "Reiniciar contexto" — NÃO apaga nada. O histórico continua visível na
   * tela pra sempre; só a memória que a IA usa (buildAiHistory) passa a
   * ignorar tudo antes de `contextResetAt`. email/emailCapturedAt não são
   * tocados de propósito, pra não corromper a métrica de tempo-até-virar-lead.
   */
  async resetContext(conversationId: string) {
    await this.getConversation(conversationId); // 404 se não existir
    await this.recordMessage(conversationId, 'outbound', 'Contexto da IA reiniciado pelo operador', 'system', {
      systemEvent: true,
    });
    await this.convRepo.update(conversationId, { contextResetAt: new Date() });
    const updated = await this.getConversation(conversationId);
    this.realtime.emitIgConversationUpdated(updated);
    return updated;
  }

  async getStats() {
    const [totalConversations, aiPaused, unreadTotal] = await Promise.all([
      this.convRepo.count(),
      this.convRepo.count({ where: { aiPaused: true } }),
      this.convRepo.createQueryBuilder('c').where('c.unread_count > 0').getCount(),
    ]);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const messagesLast24h = await this.msgRepo
      .createQueryBuilder('m')
      .where('m.created_at >= :since', { since })
      .getCount();

    return { totalConversations, aiPaused, unreadTotal, messagesLast24h };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async upsertConversation(
    senderIgId: string,
    igUsername: string,
    automationId: string,
    step: string,
    origin?: { originType: IgConversationOrigin; originPostId?: string; originCommentText?: string },
  ): Promise<IgConversation> {
    const existing = await this.convRepo.findOne({ where: { senderIgId, automationId } });
    if (!existing) {
      const conv = await this.convRepo.save(
        this.convRepo.create({
          senderIgId,
          igUsername,
          automationId,
          step,
          originType: origin?.originType ?? 'comment',
          originPostId: origin?.originPostId,
          originCommentText: origin?.originCommentText,
        }),
      );
      this.realtime.emitIgConversationCreated(conv);
      return conv;
    }
    await this.convRepo.update(existing.id, { step, email: undefined, igUsername });
    return (await this.convRepo.findOneBy({ id: existing.id }))!;
  }

  // ─── IA ──────────────────────────────────────────────────────────────────────

  /** Gera a próxima mensagem de DM (abertura a partir de um comentário/DM direta, ou continuação de uma conversa em andamento). */
  private async generateAiReply(
    auto: AiReplyConfig,
    history: { role: string; content: string }[],
    incomingText: string,
  ): Promise<{ blocks: string[]; sendLink: boolean }> {
    try {
      const basePrompt = auto.aiPrompt || DEFAULT_IG_AI_PROMPT;
      const context = `\n\nCONTEXTO:\n- Mensagem/oferta que você pode usar quando fizer sentido: "${auto.replyMessage || ''}"\n- Link disponível pra mandar quando for a hora certa (nunca invente outro): ${auto.link || 'nenhum'}\n\nResponda SEMPRE em JSON: {"blocks": ["mensagem 1", "mensagem 2 (opcional)"], "sendLink": true|false}. "blocks" é a lista de mensagens a mandar em sequência, como alguém real mandando 2-3 mensagens curtas seguidas em vez de um texto único grande — use 1 bloco só quando a resposta já é curta, e separe em 2-3 blocos quando a resposta natural ficaria longa. Cada bloco deve ser curto (1-2 frases). sendLink=true só no momento certo de mandar o link — não force isso na 1ª mensagem se não fizer sentido.`;

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: basePrompt + context },
        ...history.map((h) => ({ role: (h.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user', content: h.content })),
        { role: 'user', content: incomingText },
      ];

      const response = await this.openai.chat.completions.create({
        model: this.aiModel,
        messages,
        temperature: 0.7,
        max_completion_tokens: 300,
        response_format: { type: 'json_object' },
      });

      const raw = response.choices[0].message.content?.trim() ?? '{}';
      const parsed = JSON.parse(raw);
      let blocks: string[] = Array.isArray(parsed.blocks)
        ? parsed.blocks.filter((b: unknown) => typeof b === 'string' && b.trim()).map((b: string) => b.trim())
        : [];
      if (!blocks.length && typeof parsed.reply === 'string' && parsed.reply.trim()) {
        blocks = [parsed.reply.trim()];
      }
      return { blocks, sendLink: Boolean(parsed.sendLink) };
    } catch (err) {
      this.logger.error(`Erro ao gerar resposta da IA: ${err.message}`);
      return { blocks: [], sendLink: false };
    }
  }

  /** Gera a resposta pública (visível no comentário) — nunca inclui link. */
  private async generateAiCommentReply(auto: InstagramAutomation, commentText: string): Promise<string> {
    const fallback = auto.commentReply || 'Verifica lá na sua DM, já te mandei! 😉';
    try {
      const basePrompt = auto.aiPrompt || DEFAULT_IG_AI_PROMPT;
      const response = await this.openai.chat.completions.create({
        model: this.aiModel,
        messages: [
          {
            role: 'system',
            content: `${basePrompt}\n\nTAREFA: responda PUBLICAMENTE a este comentário com 1 frase curta avisando que a pessoa vai receber algo no direct. Nunca inclua links. Responda só com o texto da resposta, sem aspas.`,
          },
          { role: 'user', content: commentText },
        ],
        temperature: 0.7,
        max_completion_tokens: 80,
      });
      return response.choices[0].message.content?.trim() || fallback;
    } catch (err) {
      this.logger.error(`Erro ao gerar resposta pública da IA: ${err.message}`);
      return fallback;
    }
  }

  private async saveLead(email: string, conv: IgConversation) {
    try {
      const existing = await this.leadRepo.findOne({ where: { email } });
      if (!existing) {
        await this.leadRepo.save(
          this.leadRepo.create({
            name: conv.igUsername || `ig_${conv.senderIgId}`,
            email,
            phone: `ig_${conv.senderIgId}`,
            instagram: conv.igUsername,
            utmSource: 'instagram',
            utmMedium: 'dm-automation',
            status: 'novo',
            classification: 'frio',
            score: 0,
          }),
        );
        this.logger.log(`Lead criado via IG DM: ${email}`);
      } else {
        this.logger.log(`Lead já existe: ${email}`);
      }
    } catch (err) {
      this.logger.error(`Erro ao salvar lead: ${err.message}`);
    }
  }

  private async sendQuickReply(commentId: string, text: string) {
    const igUserId = await this.getIgUserId();
    try {
      await axios.post(
        `${IG_API}/${igUserId}/messages`,
        {
          recipient: { comment_id: commentId },
          message: {
            text,
            quick_replies: [
              { content_type: 'text', title: 'Sim, quero! ✅', payload: 'CONFIRM_YES' },
              { content_type: 'text', title: 'Não, obrigado', payload: 'CONFIRM_NO' },
            ],
          },
        },
        { params: { access_token: this.igToken } },
      );
      this.logger.log(`Quick reply enviado para comentário ${commentId}`);
    } catch (err) {
      this.logger.error(`Erro ao enviar quick reply: ${err.message}`);
    }
  }

  /** Manda vários blocos de mensagem em sequência com pausa entre eles, simulando alguém digitando. Só o último bloco leva o botão/link. */
  private async sendBlocksToUser(senderIgId: string, blocks: string[], buttonLabel?: string, link?: string) {
    for (let i = 0; i < blocks.length; i++) {
      const isLast = i === blocks.length - 1;
      await this.sendDmToUser(senderIgId, blocks[i], isLast ? buttonLabel : undefined, isLast ? link : undefined);
      if (!isLast) await new Promise((resolve) => setTimeout(resolve, BLOCK_DELAY_MS));
    }
  }

  /** Mesma ideia de sendBlocksToUser, mas pra 1ª mensagem de uma conversa (via comment_id). */
  private async sendBlocksToComment(commentId: string, blocks: string[], buttonLabel?: string, link?: string) {
    for (let i = 0; i < blocks.length; i++) {
      const isLast = i === blocks.length - 1;
      await this.sendDm(commentId, blocks[i], isLast ? buttonLabel : undefined, isLast ? link : undefined);
      if (!isLast) await new Promise((resolve) => setTimeout(resolve, BLOCK_DELAY_MS));
    }
  }

  private async sendDmToUser(senderIgId: string, message: string, buttonLabel?: string, link?: string) {
    const igUserId = await this.getIgUserId();
    // Automações antigas ainda têm a URL embutida no texto da mensagem; as
    // novas mandam o link no campo dedicado. Prioriza o campo — se não vier,
    // cai pro regex antigo (compatibilidade com automações já criadas).
    const urlMatch = message.match(/https?:\/\/[^\s]+/);
    const url = link || urlMatch?.[0];

    let messagePayload: any;
    if (buttonLabel && url) {
      const textWithoutUrl = urlMatch ? message.replace(urlMatch[0], '').trim() : message;
      messagePayload = {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: textWithoutUrl || message,
            buttons: [{ type: 'web_url', url, title: buttonLabel }],
          },
        },
      };
    } else if (url && !urlMatch) {
      // Link veio só pelo campo dedicado (não estava embutido no texto) e não
      // tem label de botão — anexa como texto simples pra não se perder.
      messagePayload = { text: `${message}\n${url}` };
    } else {
      messagePayload = { text: message };
    }

    try {
      await axios.post(
        `${IG_API}/${igUserId}/messages`,
        { recipient: { id: senderIgId }, message: messagePayload },
        { params: { access_token: this.igToken } },
      );
      this.logger.log(`DM enviado para ${senderIgId}`);
    } catch (err) {
      this.logger.error(`Erro ao enviar DM: ${err.message}`);
    }
  }

  private async replyToComment(commentId: string, message: string) {
    try {
      await axios.post(
        `${IG_API}/${commentId}/replies`,
        { message },
        { params: { access_token: this.igToken } },
      );
      this.logger.log(`Resposta pública postada no comentário ${commentId}`);
    } catch (err) {
      this.logger.error(`Erro ao responder comentário: ${err.message}`);
    }
  }

  private async sendDm(commentId: string, message: string, buttonLabel?: string, link?: string) {
    const igUserId = await this.getIgUserId();
    // Automações antigas ainda têm a URL embutida no texto da mensagem; as
    // novas mandam o link no campo dedicado. Prioriza o campo — se não vier,
    // cai pro regex antigo (compatibilidade com automações já criadas).
    const urlMatch = message.match(/https?:\/\/[^\s]+/);
    const url = link || urlMatch?.[0];

    let messagePayload: any;
    if (buttonLabel && url) {
      const textWithoutUrl = urlMatch ? message.replace(urlMatch[0], '').trim() : message;
      messagePayload = {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: textWithoutUrl || message,
            buttons: [{ type: 'web_url', url, title: buttonLabel }],
          },
        },
      };
    } else if (url && !urlMatch) {
      // Link veio só pelo campo dedicado (não estava embutido no texto) e não
      // tem label de botão — anexa como texto simples pra não se perder.
      messagePayload = { text: `${message}\n${url}` };
    } else {
      messagePayload = { text: message };
    }

    try {
      await axios.post(
        `${IG_API}/${igUserId}/messages`,
        { recipient: { comment_id: commentId }, message: messagePayload },
        { params: { access_token: this.igToken } },
      );
      this.logger.log(`DM enviado para comentário ${commentId}`);
    } catch (err) {
      this.logger.error(`Erro ao enviar DM: ${err.message}`);
    }
  }
}
