import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';
import { User, UserRole } from './user.entity';

// Quanto tempo o guard confia no estado (ativo/papel) lido do banco antes de
// reler. Desativar alguém ou trocar o papel vale em no máximo esse intervalo.
const USER_CACHE_MS = 60_000;
const userCache = new Map<string, { active: boolean; role: UserRole; at: number }>();

/** Chamado ao alterar um usuário (desativar/trocar papel) — vale na hora, sem esperar o cache. */
export function invalidateUserCache(id: string) {
  userCache.delete(id);
}

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
}

/**
 * Guard global (APP_GUARD): toda rota exige JWT, exceto as marcadas com
 * @Public(). O token vem no header `Authorization: Bearer ...` ou, só em GET,
 * no query `?token=` — necessário pros links abertos por navegação (download
 * de vídeo, conectar Google Calendar), que não conseguem mandar header.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private reflector: Reflector,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest();
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException('Login necessário.');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }
    // O JWT continua válido até expirar mesmo se o usuário for desativado —
    // por isso o estado atual vem do banco (com cache curto).
    const current = await this.currentUser(payload.sub);
    if (!current?.active) throw new UnauthorizedException('Usuário desativado.');
    payload = { ...payload, role: current.role };
    req.user = payload;

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(payload.role)) {
      throw new ForbiddenException('Sem permissão.');
    }
    return true;
  }

  private async currentUser(id: string) {
    const cached = userCache.get(id);
    if (cached && Date.now() - cached.at < USER_CACHE_MS) return cached;
    const user = await this.users.findOne({ where: { id }, select: { id: true, active: true, role: true } });
    if (!user) {
      userCache.delete(id);
      return null;
    }
    const entry = { active: user.active, role: user.role, at: Date.now() };
    userCache.set(id, entry);
    return entry;
  }
}

function extractToken(req: any): string | null {
  const header: string | undefined = req.headers?.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.method === 'GET' && typeof req.query?.token === 'string') return req.query.token;
  return null;
}
