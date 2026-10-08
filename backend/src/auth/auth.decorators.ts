import { SetMetadata } from '@nestjs/common';
import { UserRole } from './user.entity';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/**
 * Libera a rota do login. Use SÓ em quem é chamado de fora do CRM:
 * webhooks (WhatsApp/Meta/Greenn/SMS), páginas públicas do ConvertHairPage
 * (quiz, formulário, rastreamento) e páginas legais.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restringe a rota a determinados papéis (ex.: só `socio` gerencia usuários). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
