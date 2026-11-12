import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import OpenAI from 'openai';
import { IgAudit } from '../common/entities/ig-audit.entity';
import { SettingsService } from '../settings/settings.service';
import { ScrapeCreatorsClient, handleFromInput } from '../enrichment/scrape-creators.client';
import { AuditData, IgAuditCollector } from './ig-audit.collector';
import { DEFAULT_IG_AUDIT_PROMPT, IG_AUDIT_FORMAT, IG_AUDIT_PROMPT_KEY } from './ig-audit.prompt';

export const IG_AUDIT_STAGES = ['analisado', 'pdf-enviado', 'ligacao-feita', 'reuniao-marcada', 'sem-interesse'];

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? 'não disponível' : n.toLocaleString('pt-BR'));
const dateBr = (unix: number) => (unix ? new Date(unix * 1000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '?');

@Injectable()
export class IgAuditService implements OnModuleInit {
  private readonly logger = new Logger(IgAuditService.name);
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly collector: IgAuditCollector;
  private readonly scConfigured: boolean;

  constructor(
    @InjectRepository(IgAudit) private readonly repo: Repository<IgAudit>,
    private readonly settings: SettingsService,
    config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
    this.model = config.get('IG_AUDIT_MODEL') || 'gpt-5.4-mini';
    const sc = new ScrapeCreatorsClient(config.get('SCRAPECREATORS_API_KEY') || '', { reelsLimit: 15 });
    this.scConfigured = sc.configured;
    this.collector = new IgAuditCollector(sc);
  }

  /** Análise que estava rodando quando o servidor reiniciou nunca termina — marca como erro. */
  async onModuleInit() {
    try {
      await this.repo.update(
        { status: 'running', updatedAt: LessThan(new Date(Date.now() - 10 * 60 * 1000)) },
        { status: 'error', error: 'A análise foi interrompida (servidor reiniciou). Rode de novo.', progress: null },
      );
    } catch (err: any) {
      this.logger.warn(`Limpeza de auditorias presas falhou: ${err.message}`);
    }
  }

  async list() {
    // Leve: sem a foto em base64 nem o JSON inteiro da análise.
    return this.repo
      .createQueryBuilder('a')
      .select([
        'a.id AS id',
        'a.username AS username',
        'a.status AS status',
        'a.progress AS progress',
        'a.stage AS stage',
        'a.error AS error',
        'a.notes AS notes',
        'a.created_at AS "createdAt"',
        "a.data->'profile'->>'fullName' AS \"fullName\"",
        "a.data->'profile'->>'followers' AS followers",
        "a.analysis->>'notaGeral' AS \"notaGeral\"",
      ])
      .orderBy('a.created_at', 'DESC')
      .limit(300)
      .getRawMany();
  }

  async get(id: string) {
    const audit = await this.repo.findOne({ where: { id } });
    if (!audit) throw new NotFoundException('Análise não encontrada');
    return audit;
  }

  async start(input: string): Promise<IgAudit> {
    if (!this.scConfigured) throw new BadRequestException('SCRAPECREATORS_API_KEY não configurado no servidor');
    const raw = (input || '').trim();
    const handle = handleFromInput(raw);
    if (!handle) throw new BadRequestException('Cole o @ ou o link do Instagram (ex.: @studiomegahair)');
    const audit = await this.repo.save(this.repo.create({ username: handle, status: 'running', progress: 'Na fila' }));
    // Roda em segundo plano (~1 min); a tela acompanha pelo GET /ig-audits/:id.
    this.run(audit.id, handle).catch((err) => this.logger.error(`Auditoria ${audit.id}: ${err.message}`));
    return audit;
  }

  async rerun(id: string) {
    const audit = await this.get(id);
    return this.start(audit.username);
  }

  async update(id: string, body: { stage?: string; notes?: string | null }) {
    await this.get(id);
    const patch: Partial<IgAudit> = {};
    if (body.stage !== undefined) {
      if (!IG_AUDIT_STAGES.includes(body.stage)) throw new BadRequestException('Etapa inválida');
      patch.stage = body.stage;
    }
    if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).slice(0, 5000) : null;
    await this.repo.update(id, patch);
    return this.get(id);
  }

  async remove(id: string) {
    await this.repo.delete(id);
  }

  async getPrompt() {
    const value = await this.settings.get(IG_AUDIT_PROMPT_KEY);
    return { value: value ?? DEFAULT_IG_AUDIT_PROMPT, isCustom: value != null, default: DEFAULT_IG_AUDIT_PROMPT };
  }

  async setPrompt(value: string) {
    const v = (value || '').trim();
    await this.settings.set(IG_AUDIT_PROMPT_KEY, v || DEFAULT_IG_AUDIT_PROMPT);
    return this.getPrompt();
  }

  private async run(id: string, handle: string) {
    const progress = (step: string) => this.repo.update(id, { progress: step }).then(() => undefined);
    try {
      const data = await this.collector.collect(handle, progress);
      const { coverDataUrls, ...toSave } = data;
      await this.repo.update(id, { username: data.profile.username, data: toSave as any, progress: "Montando o diagnóstico" });

      const analysis = await this.analyze(data);
      await this.repo.update(id, { analysis, status: 'ok', progress: null, error: null });
      this.logger.log(`Auditoria @${data.profile.username} pronta — nota ${analysis.notaGeral}`);
    } catch (err: any) {
      this.logger.warn(`Auditoria @${handle} falhou: ${err.message}`);
      await this.repo.update(id, { status: 'error', error: err.message?.slice(0, 500) || 'Erro desconhecido', progress: null });
    }
  }

  private async analyze(data: AuditData) {
    const prompt = (await this.settings.get(IG_AUDIT_PROMPT_KEY)) || DEFAULT_IG_AUDIT_PROMPT;
    const images: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
    if (data.profile.picDataUrl) {
      images.push({ type: 'text', text: 'Foto de perfil:' });
      images.push({ type: 'image_url', image_url: { url: data.profile.picDataUrl, detail: 'low' } });
    }
    for (const c of data.coverDataUrls || []) {
      images.push({ type: 'text', text: `Capa do reel ${c.code} (${c.group === 'melhor' ? 'entre os MAIS vistos' : 'entre os MENOS vistos'}):` });
      images.push({ type: 'image_url', image_url: { url: c.dataUrl, detail: 'low' } });
    }

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: `${prompt}\n${IG_AUDIT_FORMAT}` },
        { role: 'user', content: [{ type: 'text', text: this.dataAsText(data) }, ...images] },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 12000,
    });
    const raw = response.choices[0]?.message?.content || '';
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('A IA devolveu uma resposta fora do formato. Rode de novo.');
    }
    if (typeof parsed?.notaGeral !== 'number' || !Array.isArray(parsed?.notas) || !parsed?.capa) {
      throw new Error('A IA devolveu a análise incompleta. Rode de novo.');
    }
    parsed.notaGeral = Math.max(0, Math.min(10, Math.round(parsed.notaGeral * 10) / 10));
    // Tráfego pago é fato medido, não opinião da IA.
    parsed.trafegoPago = data.ads.status;
    return parsed;
  }

  /** Os fatos em texto pra IA — sem base64, com números já calculados. */
  private dataAsText(d: AuditData): string {
    const p = d.profile;
    const s = d.stats;
    const lines: string[] = [];
    lines.push('# DADOS COLETADOS (fatos medidos pelo sistema)');
    lines.push(`Data da coleta: ${new Date(d.collectedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
    lines.push('');
    lines.push('## Perfil');
    lines.push(`@${p.username} — nome: ${p.fullName || '(sem nome)'}${p.isVerified ? ' (verificado)' : ''}`);
    lines.push(`Categoria: ${p.category || 'não informada'} | Conta profissional: ${p.isBusiness ? 'sim' : 'não'} | Cidade: ${p.city || 'não informada'}`);
    lines.push(`Seguidores: ${fmt(p.followers)} | Seguindo: ${fmt(p.following)} | Publicações: ${fmt(p.mediaCount)}`);
    lines.push(`Bio (texto exato): """${p.bio || '(vazia)'}"""`);
    lines.push(`Link na bio: ${p.externalUrl || 'nenhum'}${p.links.length > 1 ? ` | Outros links: ${p.links.map((l) => l.url).join(', ')}` : ''}`);
    lines.push(`Botão/telefone de contato comercial: ${p.businessPhone ? 'sim' : 'não'} | Algum caminho pro WhatsApp na bio/link: ${d.whatsappNaBio ? 'sim' : 'não'}`);
    lines.push('');
    lines.push('## Destaques');
    lines.push(d.highlights.available ? `${d.highlights.count} destaque(s): ${d.highlights.titles.join(' | ') || '(sem título)'}` : 'Não foi possível ler os destaques.');
    lines.push('');
    lines.push('## Frequência (feed + reels; stories: não disponível)');
    lines.push(`Publicações nos últimos 7 dias: ${s.postsUltimos7Dias} | nos últimos 30 dias: ${s.postsUltimos30Dias}`);
    lines.push(`Reels nos últimos 7 dias: ${s.reelsUltimos7Dias} | nos últimos 30 dias: ${s.reelsUltimos30Dias}`);
    lines.push(`Dias desde a última publicação: ${fmt(s.diasDesdeUltimaPublicacao)} | Maior intervalo sem publicar (no período lido): ${fmt(s.maiorIntervaloSemPostarDias)} dias | Média: ${fmt(s.mediaPostsPorSemana)} publicações por semana`);
    lines.push('');
    lines.push(`## Reels (últimos ${s.reelsAnalisados})`);
    lines.push(`Média de visualizações: ${fmt(s.mediaViews)} | Mediana: ${fmt(s.medianaViews)} | Média de views ÷ seguidores: ${s.viewsPorSeguidorPct ?? 'não disponível'}%`);
    for (const r of d.reels) {
      lines.push(`- ${r.code} (${dateBr(r.takenAt)}): ${fmt(r.plays)} views, ${fmt(r.likes)} curtidas, ${fmt(r.comments)} comentários${r.caption ? ` — legenda: "${r.caption.replace(/\s+/g, ' ').slice(0, 160)}"` : ''}`);
    }
    lines.push(`Mais vistos: ${s.melhores.map((r) => `${r.code} (${fmt(r.plays)})`).join(', ') || '-'} | Menos vistos: ${s.piores.map((r) => `${r.code} (${fmt(r.plays)})`).join(', ') || '-'}`);
    if (d.transcripts.length) {
      lines.push('Transcrição do áudio (o começo é o que importa pros 3 primeiros segundos). ATENÇÃO: pode ser só a letra da música de fundo (ex.: trecho em inglês de música) — nesse caso conclua que ela NÃO fala no vídeo:');
      for (const t of d.transcripts) lines.push(`- ${t.code} [${t.group === 'melhor' ? 'MAIS visto' : 'MENOS visto'}, ${fmt(t.plays)} views]: "${t.text}"`);
    }
    lines.push('');
    lines.push('## Feed (últimas publicações)');
    lines.push(`Taxa de interação média (curtidas+comentários ÷ seguidores): ${s.taxaEngajamentoPct ?? 'não disponível'}%`);
    for (const x of d.posts) {
      lines.push(`- ${x.kind} (${dateBr(x.takenAt)}): ${fmt(x.likes)} curtidas, ${fmt(x.comments)} comentários${x.plays !== null ? `, ${fmt(x.plays)} views` : ''} — "${x.caption.replace(/\s+/g, ' ').slice(0, 160)}"`);
    }
    lines.push('');
    lines.push('## Tráfego pago (Biblioteca de Anúncios da Meta)');
    lines.push(`Classificação medida: ${d.ads.status} — ${d.ads.note}`);
    for (const a of d.ads.samples) lines.push(`- Anúncio (desde ${a.startDate || '?'}, ${a.platforms.join('/') || '?'}, botão: ${a.cta || '?'}): "${a.body.slice(0, 200)}"`);
    lines.push('');
    lines.push('## Link da bio / site');
    if (!d.site.url) lines.push('Não tem link na bio.');
    else {
      lines.push(`Link: ${d.site.url} → abriu: ${d.site.reachable ? 'sim' : 'não'} (${d.site.finalUrl || '-'}) | tipo: ${d.site.kind}`);
      lines.push(`Título da página: ${d.site.title || '-'} | WhatsApp na página: ${d.site.hasWhatsapp ? 'sim' : 'não'} | Catálogo: ${d.site.hasCatalog ? 'sim' : 'não'} | Carrinho/compra direta: ${d.site.hasCart ? 'sim' : 'não'}`);
      if (d.site.links.length) lines.push(`Links na página: ${d.site.links.join(' , ')}`);
      if (d.site.textSnippet) lines.push(`Texto da página: "${d.site.textSnippet.slice(0, 500)}"`);
    }
    lines.push('');
    lines.push('## Stories');
    lines.push('Não disponível (a ferramenta não lê stories).');
    return lines.join('\n');
  }
}
