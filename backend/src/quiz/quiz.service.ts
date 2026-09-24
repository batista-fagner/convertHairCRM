import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { Quiz, QuizQuestion } from '../common/entities/quiz.entity';
import { QuizSubmission } from '../common/entities/quiz-submission.entity';
import { QuizProgress } from '../common/entities/quiz-progress.entity';
import { FacebookService } from '../facebook/facebook.service';
import { TrackingService } from '../tracking/tracking.service';

export interface WhatsappGroupCheckResult {
  ok: boolean;
  error?: string;
  groupName?: string;
  isMember?: boolean;
  isAdmin?: boolean;
  instanceNumber?: string;
}

const MAX_QUESTIONS = 7;
const MAX_IMAGE_SIZE_MB = 10;
const ALLOWED_IMAGE_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];

// As datas do filtro do funil ('YYYY-MM-DD') são dias no fuso de Brasília — é
// onde o operador do CRM está, e é o que ele espera ver ao escolher "hoje".
// Agrupar/cortar em UTC jogaria toda sessão da noite pro dia seguinte. O Brasil
// não tem mais horário de verão desde 2019, então o offset fixo é seguro.
const BR_UTC_OFFSET = '-03:00';
const BR_TIMEZONE = 'America/Sao_Paulo';
const MAX_DAILY_POINTS = 90;

/** 'YYYY-MM-DD' do dia em Brasília (en-CA formata justamente nessa ordem). */
function brDayKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: BR_TIMEZONE });
}

/**
 * Série diária do gráfico de evolução. Preenche os dias sem nenhuma sessão com
 * zero — sem isso o gráfico "pula" o dia vazio e a linha mente sobre o ritmo.
 * Sem janela definida ("Todo o período"), usa o intervalo real dos dados,
 * limitado aos últimos MAX_DAILY_POINTS dias pra não devolver série infinita.
 */
function buildDailySeries(
  sessions: QuizProgress[],
  windowStart: Date | null,
  windowEnd: Date | null,
): { date: string; started: number; completed: number }[] {
  if (!sessions.length) return [];

  const counts = new Map<string, { started: number; completed: number }>();
  for (const s of sessions) {
    const key = brDayKey(s.startedAt);
    const entry = counts.get(key) || { started: 0, completed: 0 };
    entry.started += 1;
    if (s.completed) entry.completed += 1;
    counts.set(key, entry);
  }

  const times = sessions.map((s) => s.startedAt.getTime());
  const firstKey = brDayKey(new Date(windowStart ? windowStart.getTime() : Math.min(...times)));
  const lastKey = brDayKey(new Date(windowEnd ? windowEnd.getTime() : Math.max(...times)));

  // Itera por dia-calendário de Brasília (meio-dia como âncora, longe de
  // qualquer borda de fuso) em vez de somar 24h ao horário da 1ª sessão —
  // assim o passo nunca "pula" nem corta o último dia por causa da hora.
  const series: { date: string; started: number; completed: number }[] = [];
  const cursor = new Date(`${firstKey}T12:00:00${BR_UTC_OFFSET}`);
  for (let key = firstKey; key <= lastKey && series.length <= MAX_DAILY_POINTS; ) {
    series.push({ date: key, ...(counts.get(key) || { started: 0, completed: 0 }) });
    cursor.setDate(cursor.getDate() + 1);
    key = brDayKey(cursor);
  }
  return series.slice(-MAX_DAILY_POINTS);
}

// Tipo mínimo do arquivo que o FileInterceptor entrega (buffer em memória) —
// @types/multer não está instalado no projeto, mesmo padrão do ig-posts.service.ts.
export interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

interface SubmitAnswer {
  questionId: string;
  optionId?: string;
  // Usado só quando a pergunta é do tipo 'phone' — texto livre digitado pelo
  // lead, em vez de optionId (não há opções nesse tipo de pergunta).
  value?: string;
}

interface ProgressDto {
  clickId: string;
  // -1 = abriu o quiz mas ainda não respondeu nenhuma pergunta ("started").
  questionIndex: number;
  questionId?: string;
  optionId?: string;
  // Preenchidos pelo controller a partir do request — nunca vêm do body.
  clientIp?: string;
  userAgent?: string;
}

interface SubmitDto {
  answers: SubmitAnswer[];
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  fbc?: string;
  fbp?: string;
  clickId?: string;
  userAgent?: string;
  clientIp?: string;
}

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string;

  constructor(
    @InjectRepository(Quiz) private repo: Repository<Quiz>,
    @InjectRepository(QuizSubmission) private submissionRepo: Repository<QuizSubmission>,
    @InjectRepository(QuizProgress) private progressRepo: Repository<QuizProgress>,
    private facebookService: FacebookService,
    private trackingService: TrackingService,
    private config: ConfigService,
    private http: HttpService,
  ) {
    // Mesmo bucket R2 já usado pelos posts do Instagram (ig-posts.service.ts)
    // — sem necessidade de bucket/credenciais separados só pra foto do quiz.
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: config.get('R2_ENDPOINT'),
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID') ?? '',
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY') ?? '',
      },
    });
    this.bucket = config.get('R2_BUCKET') ?? 'converthair-ig';
    this.publicUrlBase = (config.get<string>('R2_PUBLIC_URL') ?? '').replace(/\/$/, '');
  }

  async uploadImage(file: UploadedImageFile): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    if (!ALLOWED_IMAGE_MIMETYPES.includes(file.mimetype)) {
      throw new BadRequestException('Formato inválido — use JPG, PNG ou WebP');
    }
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      throw new BadRequestException(`Imagem muito grande (limite ${MAX_IMAGE_SIZE_MB}MB)`);
    }

    // Recomprime tudo pra WebP na entrada — mesma otimização feita manualmente
    // em 2026-09-16 (PNG de 2MB virou WebP de 247KB, qualidade visual igual),
    // agora automática pra qualquer upload novo do builder. Redimensiona pra
    // no máximo 1200px de largura (2026-09-19, PageSpeed acusou uma foto de
    // 233KB puxando o LCP da página de venda pra 5,7s) — nenhuma foto do quiz
    // é exibida maior que isso, então resolução acima só pesa sem ganho visual.
    let optimized: Buffer;
    try {
      optimized = await sharp(file.buffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer();
    } catch (err: any) {
      this.logger.error(`Erro ao comprimir imagem do quiz: ${err.message}`);
      throw new BadRequestException('Não foi possível processar essa imagem — tente outro arquivo');
    }

    const storagePath = `quiz/${randomUUID()}.webp`;

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
        Body: optimized,
        ContentType: 'image/webp',
        // Sem isso o R2 serve sem header de cache (PageSpeed: "Cache TTL: None")
        // — o nome do arquivo já é um UUID novo a cada upload, então cache
        // "immutable" nunca fica desatualizado.
        CacheControl: 'public, max-age=31536000, immutable',
      }));
    } catch (err: any) {
      this.logger.error(`Erro ao subir imagem do quiz pro R2: ${err.message}`);
      throw new BadRequestException(`Falha no upload: ${err.message}`);
    }

    this.logger.log(`Imagem do quiz comprimida: ${(file.size / 1024).toFixed(0)}KB → ${(optimized.length / 1024).toFixed(0)}KB`);

    return { url: `${this.publicUrlBase}/${storagePath}` };
  }

  findAll(): Promise<Quiz[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findById(id: string): Promise<Quiz> {
    const quiz = await this.repo.findOne({ where: { id } });
    if (!quiz) throw new NotFoundException(`Quiz ${id} não encontrado`);
    return quiz;
  }

  async findBySlug(slug: string): Promise<Quiz> {
    const quiz = await this.repo.findOne({ where: { slug, active: true } });
    if (!quiz) throw new NotFoundException(`Quiz "${slug}" não encontrado ou inativo`);
    return quiz;
  }

  /**
   * Registra o progresso do quiz público pergunta a pergunta — chamado pelo
   * front (Quiz.tsx, ConvertHairPage) em segundo plano, sem bloquear a
   * navegação. Uma linha por sessão (quizId + clickId), sempre em
   * quiz_progress — NUNCA em quiz_submissions (essa é histórico permanente de
   * quem terminou, intocável, ver quiz-submission.entity.ts). Idempotente:
   * pode chegar fora de ordem ou duplicado (rede instável) sem corromper o
   * dado, porque só avança furthestQuestionIndex, nunca recua.
   */
  async trackProgress(slug: string, dto: ProgressDto): Promise<{ ok: true }> {
    const quiz = await this.findBySlug(slug);
    if (!dto.clickId) return { ok: true }; // sem clickId não dá pra agrupar a sessão — ignora silenciosamente

    let progress = await this.progressRepo.findOne({ where: { quizId: quiz.id, clickId: dto.clickId } });
    if (!progress) {
      progress = this.progressRepo.create({
        quizId: quiz.id,
        quizSlug: quiz.slug,
        clickId: dto.clickId,
        totalQuestions: quiz.questions.length,
        furthestQuestionIndex: -1,
        answers: [],
        completed: false,
      });
    }

    if (dto.questionIndex > progress.furthestQuestionIndex) {
      progress.furthestQuestionIndex = dto.questionIndex;
    }

    // Sobrescreve a cada ping (não só na criação) — mais barato que checar se
    // já tinha valor, e serve pra detectar se IP/UA mudou no meio da sessão.
    if (dto.clientIp) progress.ipAddress = dto.clientIp;
    if (dto.userAgent) progress.userAgent = dto.userAgent;

    // Clicou em "Continuar" na apresentação (dispara sendProgress(0) sem
    // questionId, ver Quiz.tsx) OU já respondeu P1+ (que implica ter clicado)
    // — de qualquer forma, questionIndex >= 0 só chega depois desse clique.
    // Campo à parte de furthestQuestionIndex de propósito: esse continua
    // significando só "respondeu até aqui", nunca "só clicou".
    if (dto.questionIndex >= 0) {
      progress.clickedContinue = true;
    }

    if (dto.questionIndex >= 0 && dto.questionId && dto.optionId) {
      const question = quiz.questions.find((q) => q.id === dto.questionId);
      const option = question?.options.find((o) => o.id === dto.optionId);
      if (question && option) {
        const already = progress.answers.some((a) => a.questionIndex === dto.questionIndex);
        if (!already) {
          progress.answers = [...progress.answers, { questionIndex: dto.questionIndex, question: question.question, answer: option.label }];
        }
      }
    }

    await this.progressRepo.save(progress);
    return { ok: true };
  }

  /**
   * Funil de abandono do quiz — usado pela tela de analytics do CRM. Conta,
   * por índice de pergunta, quantas sessões chegaram ATÉ ALI (inclusive as
   * que foram além), mais quantas completaram de verdade.
   *
   * O primeiro degrau (questionIndex -1, "Abriu o quiz") é sempre igual a
   * totalStarted — trivialmente 100% — de propósito: ele existe só pra dar
   * uma base visual de 100% ao funil. O segundo (questionIndex -0.5, "Clicou
   * pra avançar") é o clique de verdade no botão "Continuar" da apresentação
   * — índice fracionário de propósito, só pra ficar entre -1 e 0 sem colidir
   * com nenhum índice real de pergunta. É a queda entre esses dois que
   * revela quem abandonou na tela de apresentação/intro sem nem clicar.
   */
  async getFunnel(
    quizId: string,
    from?: string,
    to?: string,
  ): Promise<{
    totalStarted: number;
    totalCompleted: number;
    previous: { totalStarted: number; totalCompleted: number } | null;
    steps: { questionIndex: number; question: string; reached: number }[];
    daily: { date: string; started: number; completed: number }[];
  }> {
    const quiz = await this.findById(quizId);
    // Só as colunas que o funil usa — `answers` é jsonb e não entra em nada
    // aqui, não faz sentido trazer a conversa inteira de cada sessão.
    const sessions = await this.progressRepo.find({
      where: { quizId },
      select: ['furthestQuestionIndex', 'clickedContinue', 'completed', 'startedAt'],
    });

    const windowStart = from ? new Date(`${from}T00:00:00${BR_UTC_OFFSET}`) : null;
    const windowEnd = to ? new Date(`${to}T23:59:59.999${BR_UTC_OFFSET}`) : null;
    const inWindow = (s: QuizProgress) =>
      (!windowStart || s.startedAt >= windowStart) && (!windowEnd || s.startedAt <= windowEnd);
    const current = sessions.filter(inWindow);
    const totalStarted = current.length;

    // Janela anterior, do mesmo tamanho e imediatamente antes — usada só pros
    // comparativos "vs. período anterior" na tela. "Todo o período" (sem
    // janela) não tem anterior nenhum, daí o null.
    let previous: { totalStarted: number; totalCompleted: number } | null = null;
    if (windowStart && windowEnd) {
      const prevEnd = new Date(windowStart.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - (windowEnd.getTime() - windowStart.getTime()));
      const prevSessions = sessions.filter((s) => s.startedAt >= prevStart && s.startedAt <= prevEnd);
      previous = {
        totalStarted: prevSessions.length,
        totalCompleted: prevSessions.filter((s) => s.completed).length,
      };
    }

    const steps = [
      { questionIndex: -1, question: 'Abriu o quiz', reached: totalStarted },
      { questionIndex: -0.5, question: 'Clicou pra avançar', reached: current.filter((s) => s.clickedContinue).length },
      ...quiz.questions.map((q, idx) => ({
        questionIndex: idx,
        question: q.question,
        reached: current.filter((s) => s.furthestQuestionIndex >= idx).length,
      })),
    ];

    return {
      totalStarted,
      totalCompleted: current.filter((s) => s.completed).length,
      previous,
      daily: buildDailySeries(current, windowStart, windowEnd),
      steps,
    };
  }

  async create(dto: Partial<Quiz>): Promise<Quiz> {
    this.validateQuestions(dto.questions);
    this.validateAccessToken(dto.fbAccessToken);
    const quiz = this.repo.create({
      name: dto.name,
      slug: dto.slug,
      active: dto.active ?? true,
      whatsappUrl: dto.whatsappUrl || null,
      checkoutUrl: dto.checkoutUrl || null,
      fbPixelId: dto.fbPixelId || null,
      fbAccessToken: dto.fbAccessToken || null,
      welcomeMessageTemplate: dto.welcomeMessageTemplate || null,
      welcomeMessageVariants: dto.welcomeMessageVariants || null,
      presentation: dto.presentation || {},
      questions: dto.questions || [],
      finalStep: dto.finalStep || {},
      salesPage: dto.salesPage || null,
    });
    return this.repo.save(quiz);
  }

  async update(id: string, dto: Partial<Quiz>): Promise<Quiz> {
    if (dto.questions) this.validateQuestions(dto.questions);
    if ('fbAccessToken' in dto) this.validateAccessToken(dto.fbAccessToken);
    await this.findById(id);
    await this.repo.update(id, dto);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  listSubmissions(quizId: string): Promise<QuizSubmission[]> {
    return this.submissionRepo.find({ where: { quizId }, order: { createdAt: 'DESC' } });
  }

  async deleteSubmission(id: string): Promise<{ success: true }> {
    await this.submissionRepo.delete(id);
    return { success: true };
  }

  // CAPI Access Token virou obrigatório em 2026-09-10 — desde que o pixel
  // client-side foi removido (ConvertHairPage/Quiz.tsx), todo evento desse
  // quiz depende exclusivamente do CAPI, então sem token o quiz não manda
  // sinal nenhum pro Meta.
  private validateAccessToken(token?: string | null): void {
    if (!token?.trim()) {
      throw new BadRequestException('CAPI Access Token é obrigatório');
    }
  }

  private validateQuestions(questions?: QuizQuestion[]): void {
    if (questions && questions.length > MAX_QUESTIONS) {
      throw new BadRequestException(`Máximo de ${MAX_QUESTIONS} perguntas por quiz`);
    }
  }

  /**
   * Recebe as respostas do quiz público, dispara os eventos ao Meta (conclusão
   * + qualquer evento MQL das perguntas "matadoras" respondidas com a opção
   * marcada) e empurra as respostas + UTM pra fila que o GroupJoinService
   * consome quando a pessoa efetivamente entra no grupo do WhatsApp.
   */
  async submit(slug: string, dto: SubmitDto): Promise<{ ok: true; redirectUrl: string; mqlEvents: string[] }> {
    const quiz = await this.findBySlug(slug);
    // Bug corrigido em 2026-08-30: antes mandava só `https://${slug}` (não é
    // uma URL real) — sem isso, uma regra de Conversão Personalizada no Meta
    // baseada em "URL contém" nunca bateria com nada de verdade.
    const quizPublicBase = (this.config.get<string>('QUIZ_PUBLIC_BASE_URL') || 'https://convert-hair-page.vercel.app/q').replace(/\/$/, '');
    const eventSourceUrl = `${quizPublicBase}/${slug}`;

    const answeredResponses: { question: string; answer: string }[] = [];
    const mqlEvents = new Set<string>();
    let capturedPhone: string | undefined;

    for (const submitted of dto.answers || []) {
      const question = quiz.questions.find((q) => q.id === submitted.questionId);
      if (!question) continue;

      if (question.type === 'phone') {
        const phone = (submitted.value || '').trim();
        if (!phone) continue;
        capturedPhone = phone;
        answeredResponses.push({ question: question.question, answer: phone });
        continue;
      }

      const option = question.options.find((o) => o.id === submitted.optionId);
      if (!option) continue;

      answeredResponses.push({ question: question.question, answer: option.label });

      if (question.isMqlQuestion && option.isMqlAnswer && question.mqlEventName) {
        mqlEvents.add(question.mqlEventName);
      }
    }

    const eventPayload = {
      fbclid: dto.fbclid,
      fbc: dto.fbc,
      fbp: dto.fbp,
      // external_id: identificador estável do nosso lado (o clickId que o
      // navegador já gera e guarda no localStorage) — ajuda o Meta a
      // reconhecer a mesma pessoa entre eventos, melhora o Event Match Quality.
      externalId: dto.clickId,
      clientIp: dto.clientIp,
      userAgent: dto.userAgent,
    };

    // Pixel/token próprios da campanha, se configurados — cai pro par global
    // (FB_PIXEL_ID/FB_ACCESS_TOKEN) dentro do FacebookService quando ausentes.
    const pixelOverride = quiz.fbPixelId || quiz.fbAccessToken
      ? { pixelId: quiz.fbPixelId ?? undefined, accessToken: quiz.fbAccessToken ?? undefined }
      : undefined;

    // Evento amplo — todo mundo que termina o quiz, independente de qualificar.
    // Necessário pro Meta ter volume suficiente pra otimizar (um evento MQL
    // sozinho, se raro, trava a campanha em aprendizado).
    //
    // Só dispara se o quiz tiver pergunta de verdade — um quiz de 0 perguntas
    // (ex.: landing só com botão, usado em remarketing) dispararia isso no
    // simples clique, sem nenhum "quiz" sendo respondido de fato. Como esse
    // evento é reaproveitado (mesma custom conversion) em todas as campanhas,
    // deixar disparar aqui sujaria o sinal pras outras também.
    if (quiz.questions.length > 0) {
      this.facebookService
        .sendCustomEvent('QuizCompleto', eventPayload, eventSourceUrl, `quiz-complete-${dto.clickId || randomUUID()}`, pixelOverride)
        .catch((err) => this.logger.error(`Erro ao enviar QuizCompleto: ${err.message}`));
    }

    // "Lead" (evento PADRÃO do Meta) NÃO dispara mais aqui — voltou a ser
    // disparado só quando a pessoa efetivamente entra no grupo do WhatsApp
    // (ver SdrGroupJoinService.handleJoin), pro pixel deste mesmo quiz.
    // Antes disparava nos dois momentos com event_id diferentes (sem dedup) e
    // o disparo daqui ainda ia pro pixel global, não pro pixel do quiz — 2
    // bugs corrigidos em 2026-09-10: contagem duplicada de Lead + evento no
    // pixel errado. "QuizCompleto" continua sendo o sinal de quem terminou o
    // quiz, independente de entrar no grupo depois ou não.

    for (const eventName of mqlEvents) {
      this.facebookService
        .sendCustomEvent(eventName, eventPayload, eventSourceUrl, `quiz-mql-${eventName}-${dto.clickId || randomUUID()}`, pixelOverride)
        .catch((err) => this.logger.error(`Erro ao enviar evento MQL "${eventName}": ${err.message}`));
    }

    await this.trackingService.registerClick({
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      utmContent: dto.utmContent,
      utmTerm: dto.utmTerm,
      fbclid: dto.fbclid,
      fbc: dto.fbc,
      fbp: dto.fbp,
      clickId: dto.clickId,
      quizSlug: quiz.slug,
      quizResponses: answeredResponses,
      quizMqlEvents: Array.from(mqlEvents),
    });

    // Registro permanente — ao contrário da fila acima (Redis, TTL 2min,
    // só vira Lead se a pessoa entrar no grupo), isso fica pra sempre,
    // independente do que acontece depois. Guarda UTM/fbclid completos pra
    // atribuir por campanha/conjunto/anúncio no relatório.
    await this.submissionRepo.save(
      this.submissionRepo.create({
        quizId: quiz.id,
        quizSlug: quiz.slug,
        quizName: quiz.name,
        answers: answeredResponses,
        phone: capturedPhone,
        mqlEvents: Array.from(mqlEvents),
        utmSource: dto.utmSource,
        utmMedium: dto.utmMedium,
        utmCampaign: dto.utmCampaign,
        utmContent: dto.utmContent,
        utmTerm: dto.utmTerm,
        fbclid: dto.fbclid,
        fbc: dto.fbc,
        fbp: dto.fbp,
        clickId: dto.clickId,
        userAgent: dto.userAgent,
        clientIp: dto.clientIp,
      }),
    );

    // Fecha a sessão de progresso desse quiz (tabela separada de
    // quiz_submissions acima — nunca mexe no histórico permanente). Se por
    // algum motivo não existir linha de progresso ainda (ex: front antigo em
    // cache, sem o tracking novo), cria uma já completa — não é um erro.
    if (dto.clickId) {
      let progress = await this.progressRepo.findOne({ where: { quizId: quiz.id, clickId: dto.clickId } });
      if (!progress) {
        progress = this.progressRepo.create({
          quizId: quiz.id,
          quizSlug: quiz.slug,
          clickId: dto.clickId,
          totalQuestions: quiz.questions.length,
          answers: [],
        });
      }
      progress.completed = true;
      progress.furthestQuestionIndex = quiz.questions.length - 1;
      await this.progressRepo.save(progress);
    }

    this.logger.log(`Quiz "${slug}" respondido — ${answeredResponses.length} pergunta(s), MQL events: ${Array.from(mqlEvents).join(', ') || 'nenhum'}`);

    return {
      ok: true,
      redirectUrl: quiz.whatsappUrl || '',
      mqlEvents: Array.from(mqlEvents),
    };
  }

  /**
   * Diagnóstico usado no Quiz Builder: confere se o link de convite de grupo
   * digitado no campo "Link do WhatsApp" aponta pra um grupo onde a instância
   * uazapi (SDR_UAZAPI_TOKEN — a mesma que detecta entrada no grupo via SSE em
   * sdr-group-join.service.ts) já está dentro, e como admin. Sem isso, criar um
   * grupo novo e trocar só o link não é suficiente — a instância precisa ser
   * adicionada manualmente no grupo (o WhatsApp não avisa quem entra em grupos
   * de que não faz parte). Não modifica nada, só lê.
   */
  async checkWhatsappGroupLink(url: string): Promise<WhatsappGroupCheckResult> {
    const match = (url || '').match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    if (!match) {
      return { ok: false, error: 'Isso não parece um link de convite do WhatsApp (chat.whatsapp.com/...)' };
    }

    const uazapiBaseUrl = this.config.get('SDR_UAZAPI_BASE_URL') || this.config.get('UAZAPI_BASE_URL') || 'https://free.uazapi.com';
    const uazapiToken = this.config.get('SDR_UAZAPI_TOKEN') || '';
    if (!uazapiToken) {
      return { ok: false, error: 'SDR_UAZAPI_TOKEN não configurado no servidor' };
    }

    let groupName: string;
    try {
      const preview = await firstValueFrom(this.http.get(`https://chat.whatsapp.com/${match[1]}`));
      const titleMatch = (preview.data as string).match(/property="og:title" content="([^"]+)"/);
      if (!titleMatch) {
        return { ok: false, error: 'Não consegui identificar o grupo desse link (pode estar expirado ou inválido)' };
      }
      groupName = titleMatch[1];
    } catch (err: any) {
      return { ok: false, error: `Não consegui abrir o link de convite: ${err.message}` };
    }

    let status: any;
    let groups: any[];
    try {
      [status, groups] = await Promise.all([
        firstValueFrom(this.http.get(`${uazapiBaseUrl}/instance/status`, { headers: { token: uazapiToken } })).then((r) => r.data),
        firstValueFrom(this.http.get(`${uazapiBaseUrl}/group/list`, { headers: { token: uazapiToken } })).then((r) => r.data?.groups || []),
      ]);
    } catch (err: any) {
      return { ok: false, error: `Não consegui consultar o uazapi: ${err.message}`, groupName };
    }

    const instanceNumber: string = status?.instance?.owner || '';
    const group = groups.find((g) => (g.Name || '').trim().toLowerCase() === groupName.trim().toLowerCase());
    if (!group) {
      return { ok: false, error: `Grupo "${groupName}" encontrado no link, mas a instância não é membro dele ainda — adicione o número ${instanceNumber} no grupo.`, groupName, isMember: false, instanceNumber };
    }

    const participant = (group.Participants || []).find((p: any) => String(p.PhoneNumber || '').startsWith(instanceNumber));
    const isAdmin = Boolean(participant?.IsAdmin || participant?.IsSuperAdmin);

    return { ok: true, groupName, isMember: true, isAdmin, instanceNumber };
  }
}
