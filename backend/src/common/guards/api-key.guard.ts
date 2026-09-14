import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard simples de chave compartilhada (sem JWT/OAuth) — usado pelas rotas de
 * prospecção, chamadas tanto pela extensão ConvertIQ quanto pelo frontend do
 * CRM, ambos enviando a mesma PROSPECTING_API_KEY no header `x-api-key`.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const expected = this.config.get<string>('PROSPECTING_API_KEY');
    const provided = req.headers['x-api-key'];
    if (!expected || provided !== expected) {
      throw new UnauthorizedException('API key inválida');
    }
    return true;
  }
}
