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
export function extractCandidateFirstName(rawName: string): string | null {
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
 * Consulta a API pública do IBGE (censo de nomes) pra decidir o gênero de um
 * primeiro nome. Nunca lança erro — retorna null (indeterminado) em qualquer
 * cenário sem dado confiável (sem dados no censo, sem gênero dominante, IBGE
 * fora do ar/timeout). Extraído de buildOpeningGreeting pra reuso (prospecção
 * ativa também precisa de gênero, mas pra decidir Doutor/Doutora, não saudação).
 */
export async function lookupGender(firstName: string): Promise<'M' | 'F' | null> {
  try {
    const [maleRes, femaleRes] = await Promise.all([
      axios.get(`${IBGE_NOMES_URL}/${encodeURIComponent(firstName)}`, { params: { sexo: 'M' }, timeout: 3000 }),
      axios.get(`${IBGE_NOMES_URL}/${encodeURIComponent(firstName)}`, { params: { sexo: 'F' }, timeout: 3000 }),
    ]);
    const maleCount = sumFrequencia(maleRes.data);
    const femaleCount = sumFrequencia(femaleRes.data);
    const total = maleCount + femaleCount;

    if (total === 0) {
      logger.log(`IBGE sem dados pra "${firstName}" (M=0, F=0) — gênero indeterminado`);
      return null;
    }
    const ratio = Math.max(maleCount, femaleCount) / total;
    if (ratio < 0.65) {
      logger.log(`IBGE "${firstName}": M=${maleCount} F=${femaleCount} (sem gênero dominante) — indeterminado`);
      return null;
    }

    const gender = maleCount > femaleCount ? 'M' : 'F';
    logger.log(`IBGE "${firstName}": M=${maleCount} F=${femaleCount} → gênero ${gender}`);
    return gender;
  } catch (err: any) {
    logger.warn(`Erro ao consultar IBGE pra "${firstName}": ${err.message} — gênero indeterminado`);
    return null;
  }
}

/**
 * Monta a bolha 1 de abertura (saudação) 100% em código — não deixa a IA
 * decidir nome/gênero, porque ela já errou isso mais de uma vez na prática.
 */
export async function buildOpeningGreeting(rawName: string): Promise<string> {
  const firstName = extractCandidateFirstName(rawName);
  if (!firstName) {
    logger.log(`"${rawName}" não parece nome de pessoa — saudação genérica "Oi! 👋"`);
    return 'Oi! 👋';
  }

  const gender = await lookupGender(firstName);
  if (gender === null) return `Fala ${firstName} tudo bem?`;
  return gender === 'M' ? `Fala ${firstName}, blz?` : `Olá minha amiga ${firstName}, tudo bem?`;
}
