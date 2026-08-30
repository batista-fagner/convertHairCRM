import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { Quiz, QuizQuestion } from '../common/entities/quiz.entity';
import { QuizSubmission } from '../common/entities/quiz-submission.entity';
import { FacebookService } from '../facebook/facebook.service';
import { TrackingService } from '../tracking/tracking.service';

const MAX_QUESTIONS = 6;
const MAX_IMAGE_SIZE_MB = 10;
const ALLOWED_IMAGE_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp'];

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
  optionId: string;
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
    private facebookService: FacebookService,
    private trackingService: TrackingService,
    private config: ConfigService,
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

    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const storagePath = `quiz/${randomUUID()}.${ext}`;

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: storagePath,
        Body: file.buffer,
        ContentType: file.mimetype,
      }));
    } catch (err: any) {
      this.logger.error(`Erro ao subir imagem do quiz pro R2: ${err.message}`);
      throw new BadRequestException(`Falha no upload: ${err.message}`);
    }

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

  async create(dto: Partial<Quiz>): Promise<Quiz> {
    this.validateQuestions(dto.questions);
    const quiz = this.repo.create({
      name: dto.name,
      slug: dto.slug,
      active: dto.active ?? true,
      whatsappUrl: dto.whatsappUrl || null,
      fbPixelId: dto.fbPixelId || null,
      fbAccessToken: dto.fbAccessToken || null,
      welcomeMessageTemplate: dto.welcomeMessageTemplate || null,
      presentation: dto.presentation || {},
      questions: dto.questions || [],
      finalStep: dto.finalStep || {},
    });
    return this.repo.save(quiz);
  }

  async update(id: string, dto: Partial<Quiz>): Promise<Quiz> {
    if (dto.questions) this.validateQuestions(dto.questions);
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

  private validateQuestions(questions?: QuizQuestion[]): void {
    if (questions && questions.length > MAX_QUESTIONS) {
      throw new BadRequestException(`Máximo de ${MAX_QUESTIONS} perguntas por quiz`);
    }
  }

  /**
   * Dispara o evento PADRÃO "Lead" do Meta assim que a pessoa abre a 1ª tela
   * do quiz (apresentação) — ao contrário de QuizCompleto/MQL-*, que só
   * disparam em quem termina todas as perguntas. Sendo padrão, permite a
   * campanha otimizar direto pro objetivo de Lead sem Conversão Personalizada.
   */
  async trackView(slug: string, dto: SubmitDto): Promise<{ ok: true }> {
    const quiz = await this.findBySlug(slug);
    const quizPublicBase = (this.config.get<string>('QUIZ_PUBLIC_BASE_URL') || 'https://convert-hair-page.vercel.app/q').replace(/\/$/, '');
    const eventSourceUrl = `${quizPublicBase}/${slug}`;

    const pixelOverride = quiz.fbPixelId || quiz.fbAccessToken
      ? { pixelId: quiz.fbPixelId ?? undefined, accessToken: quiz.fbAccessToken ?? undefined }
      : undefined;

    await this.facebookService
      .sendCustomEvent(
        'Lead',
        {
          fbclid: dto.fbclid,
          fbc: dto.fbc,
          fbp: dto.fbp,
          externalId: dto.clickId,
          clientIp: dto.clientIp,
          userAgent: dto.userAgent,
        },
        eventSourceUrl,
        `quiz-view-${dto.clickId || randomUUID()}`,
        pixelOverride,
      )
      .catch((err) => this.logger.error(`Erro ao enviar Lead (view): ${err.message}`));

    return { ok: true };
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

    for (const submitted of dto.answers || []) {
      const question = quiz.questions.find((q) => q.id === submitted.questionId);
      if (!question) continue;
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
    // "Lead" (padrão do Meta) NÃO é disparado aqui — sairia redundante com
    // QuizCompleto, já que os dois marcariam exatamente quem termina o quiz.
    // Lead agora dispara na 1ª tela (ver trackView()), representando "viu o
    // quiz" em vez de "terminou o quiz".
    this.facebookService
      .sendCustomEvent('QuizCompleto', eventPayload, eventSourceUrl, `quiz-complete-${dto.clickId || randomUUID()}`, pixelOverride)
      .catch((err) => this.logger.error(`Erro ao enviar QuizCompleto: ${err.message}`));

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

    this.logger.log(`Quiz "${slug}" respondido — ${answeredResponses.length} pergunta(s), MQL events: ${Array.from(mqlEvents).join(', ') || 'nenhum'}`);

    return {
      ok: true,
      redirectUrl: quiz.whatsappUrl || '',
      mqlEvents: Array.from(mqlEvents),
    };
  }
}
