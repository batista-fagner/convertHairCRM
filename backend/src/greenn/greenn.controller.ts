import { Body, Controller, ForbiddenException, Logger, Param, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GreennService } from './greenn.service';

/**
 * Webhook da Greenn (checkout do quiz "5fornecedores") — venda paga dispara
 * Purchase no CAPI, carrinho abandonado dispara WhatsApp automático de
 * recuperação. A Greenn não oferece header de assinatura/token na
 * configuração do webhook — só um campo de URL simples — então o segredo
 * mora no próprio path, comparado contra GREENN_WEBHOOK_SECRET. Sem esse env
 * configurado, o endpoint recusa tudo.
 */
@Controller('webhooks/greenn')
export class GreennController {
  private readonly logger = new Logger(GreennController.name);

  constructor(
    private readonly greennService: GreennService,
    private readonly config: ConfigService,
  ) {}

  @Post(':secret')
  async receive(@Param('secret') secret: string, @Body() body: any) {
    const expected = this.config.get('GREENN_WEBHOOK_SECRET');
    if (!expected || secret !== expected) {
      throw new ForbiddenException();
    }
    // Nunca deixa o handler estourar — Greenn pode reagir a 5xx com retry
    // agressivo, e um erro nosso não pode virar spam de webhook.
    await this.greennService.processWebhook(body).catch((err: any) => {
      this.logger.error(`Erro processando webhook da Greenn: ${err?.message}`);
    });
    return { ok: true };
  }
}
