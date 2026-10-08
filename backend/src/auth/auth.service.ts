import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { Resend } from 'resend';
import { User, UserRole } from './user.entity';
import { JwtPayload, invalidateUserCache } from './auth.guard';

const ROLES: UserRole[] = ['socio', 'sdr'];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly resend: Resend | null;

  constructor(
    @InjectRepository(User) private users: Repository<User>,
    private jwt: JwtService,
    private config: ConfigService,
  ) {
    const key = config.get<string>('RESEND_API_KEY');
    this.resend = key ? new Resend(key) : null;
  }

  async login(email: string, password: string) {
    const normalized = normalizeEmail(email);
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: normalized })
      .getOne();

    // Mesma mensagem pra email inexistente e senha errada — não revela quem tem conta.
    const ok = user && user.active && (await bcrypt.compare(password ?? '', user.passwordHash));
    if (!ok) throw new UnauthorizedException('Email ou senha incorretos.');

    await this.users.update(user.id, { lastLoginAt: new Date() });
    const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name, role: user.role };
    return { token: await this.jwt.signAsync(payload), user: toPublic(user) };
  }

  async me(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !user.active) throw new UnauthorizedException('Usuário inativo.');
    return toPublic(user);
  }

  list() {
    return this.users.find({ order: { createdAt: 'ASC' } }).then((rows) => rows.map(toPublic));
  }

  /**
   * Cria o usuário com senha gerada (ou a informada) e envia os dados de
   * acesso por email. Se o email falhar, devolve a senha pra quem criou
   * repassar manualmente — senão o usuário ficaria sem como entrar.
   */
  async create(input: { name: string; email: string; role?: UserRole; password?: string }) {
    const email = normalizeEmail(input.email);
    const name = (input.name ?? '').trim();
    const role = input.role ?? 'sdr';
    if (!email.includes('@')) throw new BadRequestException('Email inválido.');
    if (!name) throw new BadRequestException('Nome é obrigatório.');
    if (!ROLES.includes(role)) throw new BadRequestException('Papel inválido.');
    if (await this.users.findOne({ where: { email } })) throw new ConflictException('Já existe um usuário com esse email.');

    const password = input.password?.trim() || generatePassword();
    if (password.length < 8) throw new BadRequestException('A senha precisa ter pelo menos 8 caracteres.');

    const user = await this.users.save(
      this.users.create({ email, name, role, passwordHash: await bcrypt.hash(password, 10), active: true }),
    );
    const emailSent = await this.sendAccessEmail(user, password);
    return { user: toPublic(user), emailSent, ...(emailSent ? {} : { password }) };
  }

  /** Gera uma senha nova e reenvia os dados de acesso (ex.: usuário esqueceu). */
  async resetAccess(id: string) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const password = generatePassword();
    await this.users.update(id, { passwordHash: await bcrypt.hash(password, 10) });
    const emailSent = await this.sendAccessEmail(user, password);
    return { user: toPublic(user), emailSent, ...(emailSent ? {} : { password }) };
  }

  async update(id: string, data: { name?: string; role?: UserRole; active?: boolean }, actorId: string) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    // Evita o sócio se trancar fora do próprio CRM.
    if (id === actorId && (data.active === false || (data.role && data.role !== 'socio'))) {
      throw new BadRequestException('Você não pode desativar nem rebaixar a sua própria conta.');
    }
    if (data.role && !ROLES.includes(data.role)) throw new BadRequestException('Papel inválido.');

    const patch: Partial<User> = {};
    if (typeof data.name === 'string' && data.name.trim()) patch.name = data.name.trim();
    if (data.role) patch.role = data.role;
    if (typeof data.active === 'boolean') patch.active = data.active;
    await this.users.update(id, patch);
    invalidateUserCache(id);
    return toPublic({ ...user, ...patch });
  }

  private async sendAccessEmail(user: User, password: string): Promise<boolean> {
    if (!this.resend) {
      this.logger.warn('[AUTH] RESEND_API_KEY não configurada — email de acesso não enviado.');
      return false;
    }
    const from = this.config.get<string>('RESEND_FROM_EMAIL') ?? 'Convert Hair <contato@converthair.com.br>';
    const crmUrl = this.config.get<string>('CRM_URL');
    const loginLink = crmUrl ? `${crmUrl.replace(/\/$/, '')}/login` : null;

    try {
      const { error } = await this.resend.emails.send({
        from,
        to: user.email,
        subject: 'Seu acesso ao Convert Hair CRM',
        html: `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #1f1f1f;">
          <p>Olá, ${escapeHtml(user.name)}!</p>
          <p>Seu acesso ao <strong>Convert Hair CRM</strong> foi criado:</p>
          <p>
            Email: <strong>${escapeHtml(user.email)}</strong><br>
            Senha: <strong style="font-family: monospace;">${escapeHtml(password)}</strong>
          </p>
          ${loginLink ? `<p><a href="${loginLink}">Entrar no CRM</a></p>` : ''}
          <p style="color: #666;">Não compartilhe esta senha com ninguém.</p>
        </div>`,
      });
      if (error) throw new Error(error.message);
      return true;
    } catch (err) {
      this.logger.error(`[AUTH] Falha ao enviar email de acesso para ${user.email}: ${err.message}`);
      return false;
    }
  }
}

function normalizeEmail(email: string) {
  return (email ?? '').trim().toLowerCase();
}

function toPublic(u: User) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt };
}

/** 10 caracteres sem ambíguos (0/O, 1/l/I) — fácil de digitar a partir do email. */
function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
