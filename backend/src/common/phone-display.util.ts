/**
 * Telefone pra mostrar em aviso de WhatsApp pro time: sem o DDI 55
 * ("5511992693973" → "11992693973"), pra copiar e ligar direto.
 * Número de fora do Brasil fica como está.
 */
export function phoneWithoutDdi(phone?: string | null): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits.slice(2);
  return digits || String(phone || '');
}
