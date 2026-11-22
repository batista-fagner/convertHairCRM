import type { CommentIntent, SocialTemperature } from './social-lead.entity';
import { greetingNow } from '../coldcall/coldcall-outreach.service';

export function normalizeUsername(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
}

function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Pedido explícito de contato/compra/informação. Bate em qualquer ponto do
 * comentário ("eu quero", "qual o valor?", "me chama no direct").
 */
const HOT_PATTERNS: RegExp[] = [
  /\bquero\b/, /\bqro\b/, /\bqueria\b/, /\binteress/, /\bcomo (faco|funciona|faz|compr|adquir|particip|consigo|entro|acesso)/,
  /\bvalor\b/, /\bvalores\b/, /\bpreco\b/, /\bquanto (custa|e|eh|fica|sai|cobra)/, /\bme (manda|envia|passa|chama|explica)/,
  /\bmanda\b/, /\blink\b/, /\binfo\b/, /\binformac/, /\bonde (compro|encontro|consigo|acho)/, /\btem (vaga|como)\b/,
  /\bdirect\b/, /\bdm\b/, /\binbox\b/, /\bwhats/, /\bzap\b/, /\bcontato\b/, /\bpode me ajudar\b/,
];

/** Spam de "sigo de volta" / divulgação — nunca é lead. */
const SPAM_PATTERNS: RegExp[] = [/\bsig[oa] (todos )?de volta\b/, /\bsegue de volta\b/, /\bsdv\b/, /\bseguidores\b/, /\bconfira meu perfil\b/, /\bvisite meu perfil\b/];

/** "eu", "eu!", "euu" sozinho é o clássico "comenta EU que eu te mando". */
const HOT_EXACT = /^(eu+|eu quero|quero+|sim+|eu tbm|eu tambem)[!.\s]*$/;

/**
 * Intenção do comentário, sem IA (barato e previsível):
 * - quente: pediu valor, link, contato, "quero", "eu"…
 * - morno: escreveu de verdade (2+ palavras) sem pedir nada
 * - frio: só emoji, só marcou alguém ou uma palavra solta ("top", "lindo")
 */
export function classifyComment(text: string | null | undefined): CommentIntent {
  const raw = String(text || '');
  const withoutMentions = raw.replace(/@[\w.]+/g, ' ');
  const t = plain(withoutMentions).replace(/[^\p{L}\p{N}\s?!.]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return 'frio';
  if (SPAM_PATTERNS.some((re) => re.test(t))) return 'frio';
  if (HOT_EXACT.test(t) || HOT_PATTERNS.some((re) => re.test(t))) return 'quente';
  const words = t.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length >= 2 ? 'morno' : 'frio';
}

const INTENT_RANK: Record<CommentIntent, number> = { frio: 1, morno: 2, quente: 3 };

export function bestIntent(a: CommentIntent | null | undefined, b: CommentIntent | null | undefined): CommentIntent | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return INTENT_RANK[a] >= INTENT_RANK[b] ? a : b;
}

/**
 * Seguir é o sinal mais forte (decisão do sócio). Seguir + comentar algo de
 * verdade, ou responder a DM, vira muito quente.
 */
export function computeTemperature(p: {
  followedAt?: Date | null;
  bestCommentIntent?: CommentIntent | null;
  repliedAt?: Date | null;
}): { temperature: SocialTemperature; score: number } {
  const followed = !!p.followedAt;
  const intent = p.bestCommentIntent ?? null;
  if (p.repliedAt || (followed && intent && intent !== 'frio')) return { temperature: 'muito_quente', score: 4 };
  if (followed || intent === 'quente') return { temperature: 'quente', score: 3 };
  if (intent === 'morno') return { temperature: 'morno', score: 2 };
  return { temperature: 'frio', score: 1 };
}

export function firstName(fullName: string | null | undefined): string {
  const first = String(fullName || '')
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .trim()
    .split(/\s+/)[0] || '';
  if (first.length < 2) return '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Tira o espaço que sobra quando uma variável sai vazia ("Oi , tudo bem" → "Oi, tudo bem"). */
export function tidy(text: string): string {
  return text
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

export const SOCIAL_TEMPLATE_VARIABLES = [
  { key: '{nome}', label: 'Primeiro nome do perfil (some se não der pra saber)' },
  { key: '{saudacao}', label: 'Bom dia / Boa tarde / Boa noite' },
  { key: '{comentario}', label: 'O que a pessoa comentou (só na DM de comentário)' },
];

/**
 * Variáveis {nome} {saudacao} {comentario} e spintax {a|b|c}. Com
 * `keepName`, {nome} fica no texto pra extensão trocar pelo nome que ela lê
 * no perfil na hora do envio.
 */
export function renderSocialTemplate(
  template: string,
  vars: { fullName?: string | null; comment?: string | null },
  opts: { keepName?: boolean; now?: Date } = {},
): string {
  let out = String(template || '');
  out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, options: string) => {
    const list = options.split('|');
    return list[Math.floor(Math.random() * list.length)];
  });
  const comment = String(vars.comment || '').replace(/\s+/g, ' ').trim();
  out = out
    .replace(/\{saudacao\}/gi, greetingNow(opts.now))
    .replace(/\{comentario\}/gi, comment.length > 80 ? `${comment.slice(0, 77)}…` : comment);
  const name = firstName(vars.fullName);
  if (name) out = out.replace(/\{nome\}/gi, name);
  else if (!opts.keepName) out = out.replace(/\{nome\}/gi, '');
  return tidy(out);
}
