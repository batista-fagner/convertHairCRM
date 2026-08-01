import { Logger } from '@nestjs/common';
import axios from 'axios';

const logger = new Logger('NameGender');
const IBGE_NOMES_URL = 'https://servicodados.ibge.gov.br/api/v2/censos/nomes';

/**
 * Extrai o primeiro nome válido de "Nome" do WhatsApp, ou null se não parecer
 * nome de pessoa (loja/estabelecimento, texto estranho, placeholder "Lead 1234",
 * emoji, etc). Heurística puramente sintática: só letras, sem dígito, tamanho
 * mínimo — não decide sozinho se É pessoa, só filtra o que claramente NÃO é.
 */
function extractCandidateFirstName(rawName: string): string | null {
  const first = (rawName || '').trim().split(/\s+/)[0] || '';
  if (first.length < 2) return null;
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ]+$/.test(first)) return null;
  if (/^lead$/i.test(first)) return null; // "Lead 1234" (placeholder de criação)
  return first;
}

function sumFrequencia(data: any): number {
  const entries = Array.isArray(data) ? data[0]?.res : null;
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((acc: number, r: any) => acc + (Number(r?.frequencia) || 0), 0);
}

/**
 * Monta a bolha 1 de abertura (saudação) 100% em código — não deixa a IA
 * decidir nome/gênero, porque ela já errou isso mais de uma vez na prática.
 * Consulta a API pública do IBGE (censo de nomes) pra decidir o gênero do
 * primeiro nome; nunca lança erro, sempre cai num fallback seguro.
 */
export async function buildOpeningGreeting(rawName: string): Promise<string> {
  const firstName = extractCandidateFirstName(rawName);
  if (!firstName) {
    logger.log(`"${rawName}" não parece nome de pessoa — saudação genérica "Oi! 👋"`);
    return 'Oi! 👋';
  }

  try {
    const [maleRes, femaleRes] = await Promise.all([
      axios.get(`${IBGE_NOMES_URL}/${encodeURIComponent(firstName)}`, { params: { sexo: 'M' }, timeout: 3000 }),
      axios.get(`${IBGE_NOMES_URL}/${encodeURIComponent(firstName)}`, { params: { sexo: 'F' }, timeout: 3000 }),
    ]);
    const maleCount = sumFrequencia(maleRes.data);
    const femaleCount = sumFrequencia(femaleRes.data);
    const total = maleCount + femaleCount;

    if (total === 0) {
      logger.log(`IBGE sem dados pra "${firstName}" (M=0, F=0) — saudação neutra`);
      return `Fala ${firstName} tudo bem?`; // nome não consta no censo — trata como pessoa, mas neutro
    }
    const ratio = Math.max(maleCount, femaleCount) / total;
    if (ratio < 0.65) {
      logger.log(`IBGE "${firstName}": M=${maleCount} F=${femaleCount} (sem gênero dominante) — saudação neutra`);
      return `Fala ${firstName} tudo bem?`; // sem gênero dominante claro
    }

    const gender = maleCount > femaleCount ? 'M' : 'F';
    const greeting = gender === 'M' ? `Fala ${firstName}, blz?` : `Olá minha amiga ${firstName}, tudo bem?`;
    logger.log(`IBGE "${firstName}": M=${maleCount} F=${femaleCount} → gênero ${gender} → "${greeting}"`);
    return greeting;
  } catch (err: any) {
    logger.warn(`Erro ao consultar IBGE pra "${firstName}": ${err.message} — saudação neutra`);
    return `Fala ${firstName} tudo bem?`; // IBGE fora do ar/timeout — não trava a saudação por isso
  }
}
