import axios from 'axios';

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
  if (!firstName) return 'Oi! 👋';

  try {
    const [maleRes, femaleRes] = await Promise.all([
      axios.get(`${IBGE_NOMES_URL}/${encodeURIComponent(firstName)}`, { params: { sexo: 'M' }, timeout: 3000 }),
      axios.get(`${IBGE_NOMES_URL}/${encodeURIComponent(firstName)}`, { params: { sexo: 'F' }, timeout: 3000 }),
    ]);
    const maleCount = sumFrequencia(maleRes.data);
    const femaleCount = sumFrequencia(femaleRes.data);
    const total = maleCount + femaleCount;

    if (total === 0) return `Fala ${firstName} tudo bem?`; // nome não consta no censo — trata como pessoa, mas neutro
    const ratio = Math.max(maleCount, femaleCount) / total;
    if (ratio < 0.65) return `Fala ${firstName} tudo bem?`; // sem gênero dominante claro

    return maleCount > femaleCount
      ? `Fala ${firstName}, blz?`
      : `Olá minha amiga ${firstName}, tudo bem?`;
  } catch {
    return `Fala ${firstName} tudo bem?`; // IBGE fora do ar/timeout — não trava a saudação por isso
  }
}
