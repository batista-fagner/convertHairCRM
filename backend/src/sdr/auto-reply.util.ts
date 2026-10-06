// Sinais típicos de resposta automática de ausência/boas-vindas do WhatsApp
// Business. Exige 3+ sinais pra não confundir com um lead que só disse
// "obrigado" ou "retorno depois".
const SIGNALS: RegExp[] = [
  /\bausente\b|\bindispon[ií]vel\b/i,
  /assim que (estiver|puder|poss[ií]vel|dispon[ií]vel)/i,
  /retorn(o|arei|aremos)\b|responderei|responderemos|entrarei em contato|entraremos em contato/i,
  /no momento|neste momento|fora do hor[aá]rio|hor[aá]rio de atendimento/i,
  /mensagem autom[aá]tica|atendimento autom[aá]tico/i,
  /obrigad[ao] (pel[ao]|por) (sua |seu )?(mensagem|contato)/i,
  /por ordem de chegada|aguarde (meu|nosso) retorno/i,
];

export function isAutoReply(text: string): boolean {
  const t = (text || '').trim();
  if (t.length < 60) return false;
  return SIGNALS.filter((re) => re.test(t)).length >= 3;
}
