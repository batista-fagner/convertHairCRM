import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import OpenAI from 'openai';
import { InstagramAutomation } from './instagram-automation.entity';
import { IgConversation } from './ig-conversation.entity';
import { Lead } from '../common/entities/lead.entity';
import { SettingsService } from '../settings/settings.service';

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

@Injectable()
export class InstagramAutomationService {
  private readonly logger = new Logger(InstagramAutomationService.name);
  private readonly openai: OpenAI;

  constructor(
    @InjectRepository(InstagramAutomation)
    private repo: Repository<InstagramAutomation>,
    @InjectRepository(IgConversation)
    private convRepo: Repository<IgConversation>,
    @InjectRepository(Lead)
    private leadRepo: Repository<Lead>,
    private config: ConfigService,
    private settings: SettingsService,
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

    for (const auto of automations) {
      const matches = auto.acceptAny || commentText.includes(this.normalize(auto.keyword || 'eu quero'));
      if (!matches) continue;

      // Automação com IA: substitui todo o fluxo roteirizado abaixo — a IA
      // conduz a resposta pública e abre a conversa por DM decidindo sozinha
      // quando mandar o link, em vez de seguir os passos fixos de
      // confirmação/captura de email.
      if (auto.useAi && senderIgId) {
        const rawComment = value.text || '';
        const { blocks, sendLink } = await this.generateAiReply(auto, [], rawComment);
        if (blocks.length) {
          await this.sendBlocksToComment(commentId, blocks, sendLink ? auto.dmButtonLabel : undefined, sendLink ? auto.link : undefined);
          await this.upsertConversation(senderIgId, igUsername, auto.id, 'ai_chat', [
            { role: 'user', content: rawComment },
            { role: 'assistant', content: blocks.join('\n\n') },
          ]);
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

        // Criar/resetar conversa no passo waiting_confirmation
        await this.upsertConversation(senderIgId, igUsername, auto.id, 'waiting_confirmation');
      } else if (auto.captureEmail && senderIgId) {
        // Pula confirmação, vai direto pedir email — mesmo motivo acima: 1ª
        // mensagem da conversa precisa ir via comment_id, não user id.
        const question = auto.emailQuestion || 'Oi! Qual é o seu melhor email? 😊';
        await this.sendDm(commentId, question);
        await this.upsertConversation(senderIgId, igUsername, auto.id, 'waiting_email');
      } else {
        // Fluxo direto: envia DM com link
        await this.sendDm(commentId, auto.replyMessage, auto.dmButtonLabel, auto.link);
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
    // Ignora ecos (mensagens enviadas pela própria conta)
    if (messaging.is_echo) return;

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
      const { blocks, sendLink } = await this.generateAiReply(
        { aiPrompt: catchall.prompt, link: catchall.link },
        [],
        text,
      );
      if (!blocks.length) return;
      await this.sendBlocksToUser(senderIgId, blocks, sendLink ? catchall.buttonLabel : undefined, sendLink ? catchall.link : undefined);
      await this.convRepo.save(
        this.convRepo.create({
          senderIgId,
          automationId: null,
          step: 'ai_chat',
          aiContext: [
            { role: 'user', content: text },
            { role: 'assistant', content: blocks.join('\n\n') },
          ],
        }),
      );
      return;
    }

    if (conv.step === 'completed') return;

    const auto = conv.automationId ? await this.repo.findOneBy({ id: conv.automationId }) : null;

    // ── Passo: conversa conduzida pela IA (automação específica OU catch-all) ──
    if (conv.step === 'ai_chat') {
      const catchall = auto ? null : await this.getCatchallConfig();
      const aiConfig: AiReplyConfig = auto ?? { aiPrompt: catchall!.prompt, link: catchall!.link };
      const dmButtonLabel = auto ? auto.dmButtonLabel : catchall!.buttonLabel;

      const history = Array.isArray(conv.aiContext) ? conv.aiContext : [];
      const { blocks, sendLink } = await this.generateAiReply(aiConfig, history, text);
      if (blocks.length) {
        await this.sendBlocksToUser(senderIgId, blocks, sendLink ? dmButtonLabel : undefined, sendLink ? aiConfig.link ?? undefined : undefined);
        const updatedContext = [...history, { role: 'user', content: text }, { role: 'assistant', content: blocks.join('\n\n') }];
        await this.convRepo.update(conv.id, { aiContext: updatedContext });
      }

      // Se a pessoa mandar um email no meio da conversa, salva como lead —
      // a IA pode pedir isso naturalmente sem precisar do passo fixo antigo.
      if (this.isValidEmail(text)) {
        const email = text.toLowerCase().trim();
        await this.saveLead(email, conv);
        await this.convRepo.update(conv.id, { email });
      }
      return;
    }

    // ── Passo: esperando confirmação (Yes/No) ──
    if (conv.step === 'waiting_confirmation') {
      const isYes = quickReplyPayload === 'CONFIRM_YES' || /^(s|si|sim|yes|quero|ok|vai|bora)$/i.test(this.normalize(text));
      const isNo = quickReplyPayload === 'CONFIRM_NO' || /^(n|nao|no|nope|nã)/.test(this.normalize(text));

      if (isYes) {
        if (auto?.captureEmail) {
          const question = auto.emailQuestion || 'Ótimo! Qual é o seu melhor email? 😊';
          await this.sendDmToUser(senderIgId, question);
          await this.convRepo.update(conv.id, { step: 'waiting_email' });
        } else {
          // Sem captura de email: envia o link direto
          if (auto?.replyMessage) await this.sendDmToUser(senderIgId, auto.replyMessage, auto.dmButtonLabel, auto.link);
          await this.convRepo.update(conv.id, { step: 'completed' });
        }
      } else if (isNo) {
        await this.sendDmToUser(senderIgId, 'Tudo bem! Se mudar de ideia é só me chamar 😊');
        await this.convRepo.update(conv.id, { step: 'completed' });
      }
      // Se não for nem sim nem não, ignora (pode ser outra mensagem aleatória)
      return;
    }

    // ── Passo: esperando email ──
    if (conv.step === 'waiting_email') {
      if (!this.isValidEmail(text)) {
        await this.sendDmToUser(senderIgId, 'Hmm, não parece um email válido 🤔 Pode me mandar novamente? Ex: nome@gmail.com');
        return;
      }

      const email = text.toLowerCase().trim();
      await this.saveLead(email, conv);

      if (auto?.replyMessage) {
        await this.sendDmToUser(senderIgId, auto.replyMessage, auto.dmButtonLabel, auto.link);
      } else {
        await this.sendDmToUser(senderIgId, 'Perfeito! Em breve você receberá mais informações 🙌');
      }

      await this.convRepo.update(conv.id, { step: 'completed', email });
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async upsertConversation(senderIgId: string, igUsername: string, automationId: string, step: string, aiContext?: any[]) {
    const existing = await this.convRepo.findOne({ where: { senderIgId, automationId } });
    if (!existing) {
      await this.convRepo.save(this.convRepo.create({ senderIgId, igUsername, automationId, step, aiContext }));
    } else {
      await this.convRepo.update(existing.id, { step, email: undefined, igUsername, aiContext });
    }
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
