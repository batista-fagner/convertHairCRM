import pg from 'pg';

// O serviço de render NUNCA usa TypeORM nem `synchronize` — só UPDATE/SELECT
// crus. Duas ferramentas de schema escrevendo na mesma tabela é risco real de
// dado; o backend (com synchronize:true) é o único dono do schema.
//
// DATABASE_URL aqui precisa ser o POOLER do Supabase (aws-0-us-east-1.pooler.
// supabase.com), copiado do backend/.env — o host direto só resolve em IPv6 e
// o Railway não tem saída IPv6 (ENETUNREACH), já causou downtime uma vez no
// backend principal.
// Mesmo fallback do backend (app.module.ts) — lá a variável usada em produção
// é SUPABASE_DATABASE_URL; DATABASE_URL existe como alternativa genérica.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 4,
});

export const pingDb = async () => {
  const res = await pool.query('select now() as now');
  return res.rows[0]?.now ?? null;
};

export const query = (text, params) => pool.query(text, params);
