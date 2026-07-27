/**
 * Cálculo de segmentos de SMS.
 *
 * Importa porque a cobrança é por segmento, não por mensagem: um emoji sozinho
 * derruba a mensagem inteira de GSM-7 (160 chars) para UCS-2 (70 chars) e pode
 * dobrar o custo de um disparo para 1.300 pessoas.
 */

// Alfabeto GSM 03.38 básico.
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

// Caracteres de escape: ocupam 2 posições no GSM-7.
const GSM7_EXTENDED = '^{}\\[~]|€';

export interface SmsSegmentInfo {
  encoding: 'GSM-7' | 'UCS-2';
  /** Caracteres cobrados (escapes do GSM-7 contam 2). */
  length: number;
  segments: number;
  /** Quanto ainda cabe sem estourar para o próximo segmento. */
  remaining: number;
}

export function countSegments(text: string): SmsSegmentInfo {
  const body = text ?? '';

  let isGsm7 = true;
  let length = 0;

  for (const char of body) {
    if (GSM7_BASIC.includes(char)) {
      length += 1;
    } else if (GSM7_EXTENDED.includes(char)) {
      length += 2;
    } else {
      isGsm7 = false;
      break;
    }
  }

  if (!isGsm7) {
    // UCS-2 conta unidades de código UTF-16 — emoji fora do BMP vale 2.
    const units = [...body].reduce((acc, c) => acc + (c.codePointAt(0)! > 0xffff ? 2 : 1), 0);
    const single = 70;
    const concat = 67;
    const segments = units === 0 ? 1 : units <= single ? 1 : Math.ceil(units / concat);
    const capacity = segments === 1 ? single : segments * concat;
    return { encoding: 'UCS-2', length: units, segments, remaining: capacity - units };
  }

  const single = 160;
  const concat = 153;
  const segments = length === 0 ? 1 : length <= single ? 1 : Math.ceil(length / concat);
  const capacity = segments === 1 ? single : segments * concat;
  return { encoding: 'GSM-7', length, segments, remaining: capacity - length };
}
