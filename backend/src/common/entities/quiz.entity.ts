import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export interface QuizOption {
  id: string;
  label: string;
  // true = escolher essa opção conta como MQL para o evento configurado na
  // pergunta (isMqlQuestion + mqlEventName). Independente por opção — a mesma
  // pergunta pode ter respostas que qualificam e outras que não.
  isMqlAnswer?: boolean;
}

export interface QuizQuestion {
  id: string;
  order: number;
  question: string;
  // "pergunta matadora" — quando true, cada opção marcada isMqlAnswer dispara
  // o evento mqlEventName ao ser escolhida.
  isMqlQuestion?: boolean;
  mqlEventName?: string;
  options: QuizOption[];
}

export interface QuizPresentation {
  badgeTitle?: string;
  badgeSubtitle?: string;
  badgeDateLine?: string;
  photoUrl?: string;
  // altura máxima da foto em px — null/undefined usa o padrão do layout (340).
  photoMaxHeight?: number | null;
  title?: string;
  titleHighlight?: string;
  // tamanho da fonte do título em px — null/undefined usa o padrão do layout.
  titleFontSize?: number | null;
  subtitleBox?: string;
  subtitleBoxFontSize?: number | null;
  // trecho dentro de subtitleBox pra deixar com peso mais forte (font-black,
  // 900) que o resto do texto (que já é font-bold, 700).
  subtitleBoxBold?: string;
  bodyText?: string;
  bodyTextFontSize?: number | null;
  // trecho dentro de bodyText pra deixar com peso mais forte (font-black,
  // 900) que o resto do texto (que é normal, sem peso extra).
  bodyTextBold?: string;
  buttonLabel?: string;
  // segundos até redirecionar direto pro grupo se a pessoa não clicar no
  // botão da apresentação. null/0 = sem auto-redirect.
  autoRedirectSeconds?: number | null;
}

export interface SalesPageDor {
  titulo: string;
  texto: string;
}

export interface SalesPageFornecedor {
  numero: number;
  diferencial: string;
  detalhe: string;
  imagem?: string;
}

export interface SalesPageFaq {
  pergunta: string;
  resposta: string;
}

// Conteúdo da página de venda pós-quiz (fora deste repo, ver
// ConvertHairPage/src/pages/Oferta5Fornecedores.tsx) — existe pra quizzes que
// vendem um produto (checkoutUrl preenchido) em vez de só direcionar pro
// grupo do WhatsApp. Layout/cores ficam fixos no código da página; só o
// CONTEÚDO abaixo é editável aqui no builder, no mesmo espírito de
// presentation/finalStep.
export interface SalesPage {
  headlineBadge?: string;
  headlineTitle?: string;
  headlineHighlight?: string;
  headlineSubtitle?: string;
  dores?: SalesPageDor[];
  ofertaBadge?: string;
  ofertaTitle?: string;
  ofertaSubtitle?: string;
  criterios?: string[];
  fornecedores?: SalesPageFornecedor[];
  valorAncoragemTexto?: string;
  precoDe?: string;
  precoPor?: string;
  valorRodape?: string;
  depoimentoTexto?: string;
  depoimentoAutor?: string;
  garantiaTitulo?: string;
  garantiaTexto?: string;
  ctaTitulo?: string;
  ctaBotaoLabel?: string;
  faq?: SalesPageFaq[];
}

export interface QuizFinalStep {
  title?: string;
  titleHighlight?: string;
  progressLabel?: string;
  bodyText?: string;
  buttonLabel?: string;
  // segundos que a barra "Falta pouco!" leva animando até 100% na página
  // pública — o auto-redirect pro whatsappUrl dispara junto (ver Quiz.tsx no
  // repo da ConvertHairPage). O botão da tela final também redireciona a
  // qualquer momento, adiantando o auto-redirect.
  autoRedirectSeconds?: number | null;
}

// Quiz de captação (apresentação → até 6 perguntas de múltipla escolha, 1
// resposta por pergunta → tela final com botão pro grupo). Cada pergunta pode
// ser marcada como "MQL" com um nome de evento próprio (ex: MQL-workshop-1),
// disparado ao Meta via FacebookService.sendCustomEvent no momento da resposta
// (não espera o lead entrar no grupo) — é o que permite otimizar a campanha
// pelo evento de qualificação.
@Entity('quizzes')
export class Quiz {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'slug', type: 'varchar', unique: true })
  slug: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'whatsapp_url', type: 'varchar', nullable: true })
  whatsappUrl?: string | null;

  // Link de pagamento externo (Kiwify/Hotmart/Stripe Payment Link etc) — usado
  // pela página final de venda (fora deste repo) como destino do botão de
  // compra, quando esse quiz vende um produto em vez de só direcionar pro
  // grupo do WhatsApp. Null/vazio = quiz sem oferta de checkout.
  @Column({ name: 'checkout_url', type: 'varchar', nullable: true })
  checkoutUrl?: string | null;

  // Pixel/CAPI dedicados dessa campanha — null/vazio usa o par global
  // (FB_PIXEL_ID/FB_ACCESS_TOKEN) usado pelo resto do CRM (Lead/MQL do
  // WhatsApp etc). Existe pra campanhas que precisam de um pixel próprio,
  // sem misturar sinal com o pixel principal.
  @Column({ name: 'fb_pixel_id', type: 'varchar', nullable: true })
  fbPixelId?: string | null;

  @Column({ name: 'fb_access_token', type: 'varchar', nullable: true })
  fbAccessToken?: string | null;

  @Column({ name: 'presentation', type: 'jsonb' })
  presentation: QuizPresentation;

  @Column({ name: 'questions', type: 'jsonb', default: '[]' })
  questions: QuizQuestion[];

  @Column({ name: 'final_step', type: 'jsonb' })
  finalStep: QuizFinalStep;

  @Column({ name: 'sales_page', type: 'jsonb', nullable: true })
  salesPage?: SalesPage | null;

  // Mensagem individual (privada) enviada ao lead quando ele entra no grupo do
  // WhatsApp vindo deste quiz — em vez da abertura padrão do Efraim/Sofia, que
  // é pulada pra leads de quiz (ver GroupJoinService, cameFromQuiz). Suporta
  // placeholders {nome} e {resposta_1}..{resposta_6} (respostas do quiz, na
  // ordem em que a pessoa respondeu — ver Lead.quizResponses). Null/vazio =
  // nenhuma mensagem individual é enviada (comportamento atual).
  //
  // Serve de mensagem PADRÃO — usada quando nenhuma regra de
  // welcomeMessageVariants bate com a resposta do lead.
  @Column({ name: 'welcome_message_template', type: 'text', nullable: true })
  welcomeMessageTemplate?: string | null;

  // Mensagens condicionais por resposta — permite personalizar a mensagem de
  // boas-vindas de acordo com o que o lead respondeu numa pergunta específica
  // (ex: quem respondeu "Acima de 50" na pergunta de volume de mensagens/dia
  // recebe uma mensagem diferente de quem respondeu "5 - 10"). Avaliadas na
  // ordem da lista — a primeira regra cujo questionIndex/optionLabel bate com
  // lead.quizResponses vence; nenhuma bate → cai no welcomeMessageTemplate.
  @Column({ name: 'welcome_message_variants', type: 'jsonb', nullable: true })
  welcomeMessageVariants?: { questionIndex: number; optionLabel: string; template: string }[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
