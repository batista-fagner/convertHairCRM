/**
 * Palavras-chave obrigatórias de SMS nos EUA (TCPA / CTIA).
 *
 * Regra do CTIA: a keyword só vale quando é *a mensagem inteira*. "stop texting
 * me" NÃO é opt-out automático — é uma pessoa pedindo em linguagem livre, e
 * quem trata isso é o operador. Fazer opt-out por substring desativaria contatos
 * por engano ("don't stop the program", "I need help with module 3").
 */

const STOP_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'OPT-OUT'];
const START_KEYWORDS = ['START', 'UNSTOP', 'YES'];
const HELP_KEYWORDS = ['HELP', 'INFO'];

export type SmsKeyword = 'stop' | 'start' | 'help' | null;

export const DEFAULT_OPT_OUT_REPLY =
  'You are unsubscribed and will receive no more messages. Reply START to resubscribe.';

export const DEFAULT_HELP_REPLY =
  'Pro Cleaning mentorship support. Reply STOP to unsubscribe. Msg&data rates may apply.';

export const DEFAULT_OPT_IN_REPLY =
  'You are resubscribed to Pro Cleaning messages. Reply HELP for help, STOP to unsubscribe.';

/** Normaliza e casa a mensagem inteira contra as keyword lists. */
export function detectKeyword(body: string): SmsKeyword {
  const normalized = (body ?? '')
    .trim()
    .toUpperCase()
    // Tira pontuação e espaços das pontas — "STOP." e "STOP!" contam.
    .replace(/^[^\p{L}\p{N}-]+|[^\p{L}\p{N}-]+$/gu, '');

  if (!normalized) return null;
  if (STOP_KEYWORDS.includes(normalized)) return 'stop';
  if (START_KEYWORDS.includes(normalized)) return 'start';
  if (HELP_KEYWORDS.includes(normalized)) return 'help';
  return null;
}
