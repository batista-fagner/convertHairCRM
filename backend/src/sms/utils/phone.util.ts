/**
 * Normalização de número para E.164 americano.
 *
 * NÃO reusar `MessagingService.normalizePhone()` — aquela força prefixo 55
 * (Brasil) e quebraria todo número +1.
 *
 * Retorna `null` em vez de lançar: o import de CSV precisa reportar linha a
 * linha o que deu errado, sem abortar as 1.300 linhas por causa de uma.
 */
export function toE164Us(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;

  let national: string;
  if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    national = digits.slice(1);
  } else {
    return null;
  }

  // Regras do NANP: area code e central office code não começam com 0 ou 1.
  const areaCode = national.slice(0, 3);
  const centralOffice = national.slice(3, 6);
  if (areaCode[0] === '0' || areaCode[0] === '1') return null;
  if (centralOffice[0] === '0' || centralOffice[0] === '1') return null;
  // N11 (411, 911...) não são números discáveis de assinante.
  if (areaCode[1] === '1' && areaCode[2] === '1') return null;

  return `+1${national}`;
}

/** `+13055550198` → `+1 (305) 555-0198`. Só para log/telas do backend. */
export function formatUsPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `+1 (${m[1]}) ${m[2]}-${m[3]}`;
}
