import { Controller, Get, Header } from '@nestjs/common';
import { PRIVACY_TEXT, TERMS_TEXT } from './legal-texts';
import { Public } from '../auth/auth.decorators';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Texto simples → HTML: 1ª linha = título, "N. ..." = seção, "* ..." = item de lista. */
function render(text: string, fallbackTitle: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = lines.shift() ?? fallbackTitle;
  let body = '';
  let inList = false;
  for (const line of lines) {
    const item = line.match(/^[*•-]\s+(.*)$/);
    if (item) {
      if (!inList) { body += '<ul>'; inList = true; }
      body += `<li>${escape(item[1])}</li>`;
      continue;
    }
    if (inList) { body += '</ul>'; inList = false; }
    body += /^\d+\.\s/.test(line) ? `<h2>${escape(line)}</h2>` : `<p>${escape(line)}</p>`;
  }
  if (inList) body += '</ul>';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} — ConvertHair CRM</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:32px 16px;line-height:1.6}main{max-width:720px;margin:0 auto}h1{font-size:26px}h2{font-size:18px;margin-top:28px}p,li{color:#334155}</style>
</head><body><main><h1>${escape(title)}</h1>${body}</main></body></html>`;
}

@Public()
@Controller()
export class LegalController {
  @Get('privacidade')
  @Header('Content-Type', 'text/html; charset=utf-8')
  privacy() {
    return render(PRIVACY_TEXT, 'Política de Privacidade');
  }

  @Get('termos')
  @Header('Content-Type', 'text/html; charset=utf-8')
  terms() {
    return render(TERMS_TEXT, 'Termos de Uso');
  }

  /** Página inicial do app (exigida na tela de consentimento do Google). */
  @Get('sobre')
  @Header('Content-Type', 'text/html; charset=utf-8')
  about() {
    return render(
      'ConvertHair CRM\nCRM da Convert Hair AI para gestão de leads e prospecção comercial. A integração com o Google Agenda é usada apenas para criar, remarcar e cancelar reuniões agendadas pelo próprio usuário.\nPolítica de Privacidade: /api/privacidade\nTermos de Uso: /api/termos',
      'ConvertHair CRM',
    );
  }
}
