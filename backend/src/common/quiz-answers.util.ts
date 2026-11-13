import type { Lead } from './entities/lead.entity';

/**
 * Respostas do quiz em linhas "• pergunta: resposta", pros avisos de WhatsApp
 * do time. null quando o lead não respondeu quiz.
 */
export function formatQuizAnswers(lead: Pick<Lead, 'quizResponses' | 'name' | 'phone'>): string | null {
  const phoneDigits = String(lead.phone || '').replace(/\D/g, '');
  // Nome e WhatsApp já vão no topo do aviso — não repete.
  const answers = (lead.quizResponses || []).filter(
    (a) => a?.question && a?.answer && a.answer.trim() !== (lead.name || '').trim() && (!phoneDigits || a.answer.replace(/\D/g, '') !== phoneDigits),
  );
  if (!answers.length) return null;
  return answers.map((a) => `• ${a.question.trim()}: ${a.answer.trim()}`).join('\n');
}
