import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Carousel, SlideData } from './carousel.entity';

// ÂNGULO = a estrutura da história (que forma o conteúdo tem).
// TOM = como ela soa. São coisas diferentes de propósito: o mesmo ângulo
// "erros" pode ser escrito no tom educativo ou no provocativo.
export const ANGLES: Record<string, { label: string; instruction: string }> = {
  contraintuitivo: {
    label: 'Contra-intuitivo',
    instruction:
      'Derrube uma crença que o público tem como certa. O slide 1 afirma o oposto do senso comum do nicho, e os slides seguintes provam por quê. Não suavize a tese em nenhum momento ("na verdade depende" mata esse ângulo).',
  },
  erros: {
    label: 'Erros / o que não fazer',
    instruction:
      'Cada slide do meio é UM erro específico que o público comete, seguido da consequência concreta dele. Nomeie o erro de um jeito que a pessoa se reconheça — cite a frase que ela fala, o atalho que ela toma.',
  },
  bastidor: {
    label: 'Bastidor / como eu faço',
    instruction:
      'Mostre o processo real por dentro: números, ferramentas, decisões, o que deu errado no meio. Primeira pessoa. Especificidade é o que dá credibilidade aqui — sem número real, esse ângulo não funciona.',
  },
  historia: {
    label: 'História / caso real',
    instruction:
      'Conte uma história com cena, virada e desfecho. O slide 1 abre no meio da tensão (não no "era uma vez"). Cada slide avança a narrativa e NUNCA entrega o final antes do último slide.',
  },
  passo_a_passo: {
    label: 'Passo a passo',
    instruction:
      'Um passo executável por slide, na ordem de execução. Cada passo precisa ser específico o suficiente pra pessoa conseguir fazer hoje sozinha. Nada de passo vago tipo "defina sua estratégia".',
  },
  mito_verdade: {
    label: 'Mito vs verdade',
    instruction:
      'Cada slide do meio confronta um mito do nicho com o que acontece na prática. Direto, sem rodeio. O mito precisa ser um que o público realmente repete, não um espantalho fácil de derrubar.',
  },
  comparacao: {
    label: 'Comparação',
    instruction:
      'Compare dois caminhos que o público de fato considera. Seja honesto sobre o trade-off de cada um (inclusive do que você defende) e termine tomando um lado com clareza.',
  },
  tendencia: {
    label: 'Tendência / o que mudou',
    instruction:
      'Aponte o que mudou no mercado do público e o que isso exige dele agora. Fundamente em sinal concreto e observável, nunca em futurologia genérica.',
  },
};

export const TONES: Record<string, string> = {
  educativo: 'educativo e claro, de quem ensina sem ser arrogante',
  provocativo: 'provocativo e questionador, incomoda pra fazer pensar',
  storytelling: 'narrativo e pessoal, como quem conta um caso pra um amigo',
  case: 'analítico e baseado em prova, cita números e resultados',
  direto: 'direto e seco, frases curtas, zero enrolação',
  inspirador: 'inspirador, mas sem clichê de coach e sem frase de efeito vazia',
};

// Regras de formato/qualidade compartilhadas entre a geração do carrossel inteiro
// e a regeração de um slide isolado — se divergirem, o slide regerado sai com
// outra "voz" e quebra a consistência do carrossel.
const FORMAT_RULES = `FORMATO (é um print de tweet: fundo branco, texto preto, sem imagem)
- Linhas curtas, quebradas com \\n. Muito espaço em branco. O texto é a única coisa que existe no slide.
- Sem markdown, sem título, sem "Slide 1:", sem numerar o texto.
- No máximo 1 emoji no carrossel inteiro — de preferência nenhum.
- Sem hashtag dentro dos slides.
- Português do Brasil, coloquial. Pode usar frase sem verbo.
- Nada de palavra de IA ("mergulhe", "desvende", "revolucionário", "no mundo de hoje").`;

@Injectable()
export class CarouselService {
  private readonly logger = new Logger(CarouselService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    @InjectRepository(Carousel)
    private repo: Repository<Carousel>,
    private config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    // Hardcoded igual ao resto do projeto (ai-analysis, efraim): OPENAI_MODEL no
    // .env ainda aponta pro gpt-4o-mini antigo, e a diferença de qualidade aqui é
    // gritante — no 4o-mini o ângulo era ignorado (os 5 slides viravam o mesmo
    // erro reescrito) e o gancho só repetia o tema.
    this.model = 'gpt-5.4-mini';
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string) {
    const carousel = await this.repo.findOneBy({ id });
    if (!carousel) throw new NotFoundException('Carrossel não encontrado');
    return carousel;
  }

  async remove(id: string) {
    await this.repo.delete(id);
  }

  // Ângulos/tons vêm do backend pro frontend não manter uma segunda lista que
  // desatualiza sozinha (foi assim que a lista de tons antiga ficou órfã).
  listOptions() {
    return {
      angles: Object.entries(ANGLES).map(([value, a]) => ({ value, label: a.label })),
      tones: Object.keys(TONES).map((value) => ({
        value,
        label: value.charAt(0).toUpperCase() + value.slice(1).replace('_', ' '),
      })),
    };
  }

  // ─── Geração ─────────────────────────────────────────────────────────────────

  async create(dto: {
    topic: string;
    angle: string;
    tone: string;
    audience?: string;
    slideCount: number;
    instagramHandle?: string;
  }) {
    if (!dto.topic?.trim()) throw new BadRequestException('Tema é obrigatório');
    if (!ANGLES[dto.angle]) throw new BadRequestException(`Ângulo inválido: ${dto.angle}`);
    if (!TONES[dto.tone]) throw new BadRequestException(`Tom inválido: ${dto.tone}`);

    const carousel = this.repo.create({
      topic: dto.topic.trim(),
      angle: dto.angle,
      tone: dto.tone,
      audience: dto.audience?.trim() || null,
      slideCount: dto.slideCount,
      instagramHandle: dto.instagramHandle ?? null,
      status: 'draft',
      slides: [],
    });
    await this.repo.save(carousel);

    const { slides, caption } = await this.generateCopy(carousel);
    carousel.slides = slides;
    carousel.caption = caption;
    carousel.status = 'text_ready';
    return this.repo.save(carousel);
  }

  private buildBrief(c: Carousel): string {
    const angle = ANGLES[c.angle];
    return `Tema: "${c.topic}"
Público-alvo (quem precisa parar o scroll): ${c.audience || 'não informado — escreva para quem já vive o problema do tema, nunca para leigos'}
Ângulo: ${angle.label} — ${angle.instruction}
Tom de voz: ${TONES[c.tone]}`;
  }

  private async generateCopy(c: Carousel): Promise<{ slides: SlideData[]; caption: string }> {
    const prompt = `Você escreve carrosséis de Instagram que atraem seguidor QUALIFICADO — não alcance vazio.

${this.buildBrief(c)}

ESTRUTURA — exatamente ${c.slideCount} slides, nem um a mais nem um a menos:
- slide 1: gancho
- slide 2: retenção
- slides 3 a ${c.slideCount - 1}: desenvolvimento (${Math.max(0, c.slideCount - 3)} slides)
- slide ${c.slideCount}: CTA
O array "slides" do JSON precisa ter exatamente ${c.slideCount} itens.

O QUE É "SEGUIDOR QUALIFICADO"
Escreva no vocabulário e nas dores específicas do público-alvo acima.
Se esse conteúdo pudesse ser escrito para "qualquer pessoa", ele está genérico demais e falhou.
É BOM que quem não é do público role pro lado — o filtro é o que traz seguidor certo.

SLIDE 1 — O GANCHO (decide 80% do resultado)
- No máximo 2 linhas curtas. Zero introdução, zero contexto, zero "hoje eu vim falar sobre".
- Precisa criar tensão: afirmação forte, número específico, ou lacuna de curiosidade real.
- Fala com UMA pessoa ("você"), não com uma plateia.
- Proibido: pergunta retórica genérica ("você sabia que..."), clickbait que os outros slides não entregam.

SLIDE 2 — RETENÇÃO
- Entrega imediatamente o que o gancho prometeu. NUNCA repete o gancho com outras palavras.

SLIDES DO MEIO
- Uma ideia por slide. Se tem duas ideias, viram dois slides.
- Sempre concreto: número, exemplo, a frase que a pessoa realmente fala, situação reconhecível.
- 2 a 5 linhas curtas por slide.

ÚLTIMO SLIDE — CTA
- UM único pedido, específico e ligado ao conteúdo.
- Proibido: "curte, comenta, compartilha e salva" tudo junto.

${FORMAT_RULES}

LEGENDA DO POST
2 a 4 linhas que ampliam o gancho (não repetem os slides) + 1 pergunta que puxa comentário + 5 hashtags específicas do nicho (nunca hashtag genérica de alcance tipo #instagood).

Responda SOMENTE com JSON válido:
{"slides": [{"index": 0, "text": "..."}, {"index": 1, "text": "..."}], "caption": "..."}`;

    const raw = await this.callModel(prompt, 3000);
    const parsed = JSON.parse(raw) as { slides: { index: number; text: string }[]; caption: string };

    const slides = (parsed.slides ?? [])
      .map((s, i) => ({ index: typeof s.index === 'number' ? s.index : i, text: (s.text ?? '').trim() }))
      .filter((s) => s.text.length > 0)
      .sort((a, b) => a.index - b.index)
      .map((s, i) => ({ index: i, text: s.text })); // reindexa: o modelo às vezes pula índice

    if (slides.length === 0) throw new BadRequestException('A IA não retornou nenhum slide — tente de novo');

    return { slides, caption: (parsed.caption ?? '').trim() };
  }

  // Regera UM slide mantendo o resto — o gancho (slide 0) é o que mais se reescreve
  // na prática, e regerar o carrossel inteiro só pra trocar o gancho perde as edições
  // manuais dos outros slides.
  async regenerateSlide(id: string, slideIndex: number) {
    const carousel = await this.findOne(id);
    const target = carousel.slides.find((s) => s.index === slideIndex);
    if (!target) throw new NotFoundException(`Slide ${slideIndex} não encontrado`);

    const isHook = slideIndex === 0;
    const isCta = slideIndex === carousel.slides.length - 1;
    const role = isHook
      ? 'o GANCHO (slide 1): no máximo 2 linhas, cria tensão, fala com uma pessoa só, sem introdução'
      : isCta
        ? 'o CTA final: um único pedido específico, ligado ao conteúdo'
        : 'um slide do meio: uma ideia só, concreta (número, exemplo ou frase real), 2 a 5 linhas curtas';

    const context = carousel.slides
      .map((s) => `[slide ${s.index + 1}${s.index === slideIndex ? ' — ESTE, o que você vai reescrever' : ''}]\n${s.text}`)
      .join('\n\n');

    const prompt = `Reescreva UM slide de um carrossel de Instagram já existente.

${this.buildBrief(carousel)}

CARROSSEL ATUAL:
${context}

Reescreva APENAS o slide ${slideIndex + 1}, que é ${role}.
A nova versão precisa ser claramente DIFERENTE da atual (outro caminho, não a mesma frase reordenada) e continuar encaixando com os slides vizinhos.

${FORMAT_RULES}

Responda SOMENTE com JSON válido: {"text": "..."}`;

    const raw = await this.callModel(prompt, 600);
    const parsed = JSON.parse(raw) as { text: string };
    const text = (parsed.text ?? '').trim();
    if (!text) throw new BadRequestException('A IA não retornou texto — tente de novo');

    carousel.slides = carousel.slides.map((s) => (s.index === slideIndex ? { ...s, text } : s));
    return this.repo.save(carousel);
  }

  // ─── Edição manual ───────────────────────────────────────────────────────────

  async update(id: string, body: { slides?: SlideData[]; caption?: string }) {
    const carousel = await this.findOne(id);
    if (body.slides) carousel.slides = body.slides;
    if (body.caption !== undefined) carousel.caption = body.caption;
    return this.repo.save(carousel);
  }

  // ─── Chamada ao modelo ───────────────────────────────────────────────────────

  private async callModel(prompt: string, maxTokens: number): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9, // texto criativo — mais alto que o resto do projeto (0.7) de propósito
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
    });

    let raw = response.choices[0].message.content?.trim() ?? '';
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    if (!raw) {
      this.logger.error('Resposta vazia do modelo ao gerar copy');
      throw new BadRequestException('A IA não respondeu — tente de novo');
    }
    return raw;
  }
}
