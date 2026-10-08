import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { User, UserRole } from './auth/user.entity';

/**
 * Cria um usuário do CRM direto no banco — usado pra criar o PRIMEIRO sócio
 * (a tela de usuários exige estar logado como sócio). Imprime a senha no
 * terminal; não envia email.
 *
 *   npm run create-user -- email@x.com "Nome" socio [senha]
 */
async function main() {
  const [email, name, role = 'socio', password] = process.argv.slice(2);
  if (!email || !name || !['socio', 'sdr'].includes(role)) {
    console.error('Uso: npm run create-user -- email@x.com "Nome" socio|sdr [senha]');
    process.exit(1);
  }

  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    // Só a entidade User: o synchronize cria a tabela `users` se não existir
    // e não mexe nas demais tabelas.
    entities: [User],
    synchronize: true,
  });
  await ds.initialize();

  const repo = ds.getRepository(User);
  const normalized = email.trim().toLowerCase();
  if (await repo.findOne({ where: { email: normalized } })) {
    console.error(`Já existe usuário com o email ${normalized}.`);
    await ds.destroy();
    process.exit(1);
  }

  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const finalPassword = password || Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join('');
  await repo.save(repo.create({ email: normalized, name, role: role as UserRole, passwordHash: await bcrypt.hash(finalPassword, 10), active: true }));

  console.log(`✅ Usuário criado: ${normalized} (${role})`);
  console.log(`   Senha: ${finalPassword}`);
  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
