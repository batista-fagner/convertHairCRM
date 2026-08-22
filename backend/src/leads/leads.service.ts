import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Lead, LeadClassification, KanbanStage, KANBAN_STAGES } from '../common/entities/lead.entity';

/** Valor de filtro usado pelo frontend pra pedir só os leads sem campanha atribuída (orgânicos). */
export const ORPHAN_CAMPAIGN_FILTER = 'orfao';

/** Teto de cards carregados POR RAIA no Kanban (ver findKanban). */
const KANBAN_PER_STAGE_LIMIT = 300;

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(Lead)
    private leadsRepo: Repository<Lead>,
  ) {}

  async create(dto: Partial<Lead>): Promise<Lead> {
    const lead = this.leadsRepo.create(dto);
    const saved = await this.leadsRepo.save(lead);
    this.logger.log(`Lead criado: ${saved.id} - ${saved.name} (${saved.phone})`);
    return saved;
  }

  async findById(id: string): Promise<Lead> {
    const lead = await this.leadsRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException(`Lead ${id} não encontrado`);
    return lead;
  }

  async findByPhone(phone: string): Promise<Lead | null> {
    return this.leadsRepo.findOne({ where: { phone } });
  }

  async findAll(opts?: { campaignId?: string; page?: number; limit?: number; source?: 'all' | 'ig_dm' | 'paid'; search?: string }): Promise<{ data: Lead[]; total: number; page: number; totalPages: number }> {
    const page = opts?.page || 1;
    const limit = opts?.limit || 6;
    const source = opts?.source || 'all';
    const skip = (page - 1) * limit;

    const query = this.leadsRepo.createQueryBuilder('lead');

    if (opts?.campaignId) query.where('lead.campaign_id = :campaignId', { campaignId: opts.campaignId });

    if (source === 'ig_dm') {
      query.andWhere('lead.utm_source = :utmSource', { utmSource: 'instagram' });
      query.andWhere('lead.utm_medium = :utmMedium', { utmMedium: 'dm-automation' });
    } else if (source === 'paid') {
      query.andWhere('(lead.fbclid IS NOT NULL OR lead.ctwa_clid IS NOT NULL OR lead.utm_source IN (:...sources))', { sources: ['facebook', 'leadscomia', 'ctwa'] });
    }

    const search = opts?.search?.trim();
    if (search) {
      const digits = search.replace(/\D/g, '');
      query.andWhere(
        '(lead.name ILIKE :search OR lead.email ILIKE :search OR lead.instagram ILIKE :search' +
          (digits ? ' OR lead.phone ILIKE :digits' : '') +
          ')',
        { search: `%${search}%`, ...(digits ? { digits: `%${digits}%` } : {}) },
      );
    }

    const total = await query.getCount();
    const data = await query.orderBy('lead.created_at', 'DESC').skip(skip).take(limit).getMany();
    const totalPages = Math.ceil(total / limit);

    return { data, total, page, totalPages };
  }

  async update(id: string, dto: Partial<Lead>): Promise<Lead> {
    await this.leadsRepo.update(id, dto);
    return this.findById(id);
  }

  async updateScore(id: string, score: number): Promise<Lead> {
    const classification = this.classifyScore(score);
    return this.update(id, { score, classification });
  }

  async findByPhones(phones: string[]): Promise<Map<string, string>> {
    const leads = await this.leadsRepo.find({
      where: phones.map(phone => ({ phone })),
    });
    return new Map(leads.map(l => [l.phone, l.name]));
  }

  /**
   * Agregados via SQL (COUNT/GROUP BY) em vez de `find()` da tabela inteira —
   * esse endpoint é pollado a cada 60s pelo header em TODA página do CRM (ver
   * Layout.jsx), então hidratar todo lead a cada chamada era o maior
   * consumidor de egress do projeto. `todayCount` é novo: antes o frontend
   * derivava "leads hoje" filtrando o array `recent` (só 5 itens), o que
   * travava a contagem em 5 mesmo com mais leads no dia — agora é um COUNT real.
   */
  async getStats(): Promise<{
    total: number;
    totalMql: number;
    todayCount: number;
    byStatus: Record<string, number>;
    byWaStage: Record<string, number>;
    conversionRate: number;
    recent: Lead[];
  }> {
    const [[totals], byStatusRows, byWaStageRows, recent] = await Promise.all([
      this.leadsRepo.query(`
        SELECT
          COUNT(*)::int AS "total",
          COUNT(*) FILTER (WHERE is_mql)::int AS "totalMql",
          COUNT(*) FILTER (WHERE status = 'convertido')::int AS "convertido",
          -- "Hoje" em horário de Brasília, não UTC (o servidor roda em UTC sem
          -- TZ setada) — senão o corte do dia fica 3h adiantado, igual ao bug
          -- já documentado em appendDateFilter() logo abaixo neste arquivo.
          COUNT(*) FILTER (
            WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
          )::int AS "todayCount"
        FROM leads
      `),
      this.leadsRepo.query(`SELECT status AS "status", COUNT(*)::int AS "count" FROM leads GROUP BY status`),
      this.leadsRepo.query(`SELECT wa_stage AS "waStage", COUNT(*)::int AS "count" FROM leads WHERE wa_stage IS NOT NULL GROUP BY wa_stage`),
      this.leadsRepo.find({ order: { createdAt: 'DESC' }, take: 5 }),
    ]);

    const byStatus: Record<string, number> = Object.fromEntries(byStatusRows.map((r: any) => [r.status, r.count]));
    const byWaStage: Record<string, number> = Object.fromEntries(byWaStageRows.map((r: any) => [r.waStage, r.count]));
    const conversionRate = totals.total > 0 ? Math.round((totals.convertido / totals.total) * 1000) / 10 : 0;

    return {
      total: totals.total,
      totalMql: totals.totalMql,
      todayCount: totals.todayCount,
      byStatus,
      byWaStage,
      conversionRate,
      recent,
    };
  }

  /**
   * O limite é POR RAIA, não global. Com um `take` global (era 400) ordenado por
   * updatedAt DESC, as raias terminais (vendeu, perdido, em-negociacao...) iam
   * sumindo silenciosamente conforme a base crescia: leads fechados há tempo têm
   * updatedAt antigo, então caíam fora do corte e o card simplesmente não
   * aparecia — sem erro, sem aviso. Chegou a esconder 8 leads com 408 na base.
   * Por raia, cada coluna carrega os seus mais recentes de forma independente e
   * uma raia movimentada (novo/qualificado) nunca "come" a cota das outras.
   */
  async findKanban(campaign?: string): Promise<Record<KanbanStage, Lead[]>> {
    const where: { agentMode: 'sdr'; utmCampaign?: any; kanbanStage?: any } = { agentMode: 'sdr' };
    if (campaign === ORPHAN_CAMPAIGN_FILTER) {
      where.utmCampaign = IsNull();
    } else if (campaign) {
      where.utmCampaign = campaign;
    }

    const perStage = await Promise.all(
      KANBAN_STAGES.map(async (stage) => {
        // 'novo' também recolhe quem está com kanban_stage nulo/vazio (base
        // antiga) — mesma regra do agrupamento anterior, que caía no board.novo.
        const stageWhere =
          stage === 'novo'
            ? [{ ...where, kanbanStage: 'novo' }, { ...where, kanbanStage: IsNull() }]
            : { ...where, kanbanStage: stage };
        const leads = await this.leadsRepo.find({
          where: stageWhere as any,
          order: { updatedAt: 'DESC' },
          take: KANBAN_PER_STAGE_LIMIT,
        });
        return [stage, leads] as const;
      }),
    );

    return Object.fromEntries(perStage) as Record<KanbanStage, Lead[]>;
  }

  /**
   * Lista as campanhas distintas presentes nos leads do SDR (nome real vindo da
   * Meta Ads API via `utm_campaign`), pro dropdown de filtro do Kanban. Ordena
   * pela atividade mais recente (não pela contagem) pra que a campanha "ativa"
   * no momento apareça primeiro — é o candidato natural a filtro padrão.
   * `campaign: null` = grupo "Órfão" (leads sem atribuição, ex.: tráfego orgânico).
   */
  async listCampaigns(): Promise<{ campaign: string | null; count: number; lastLeadAt: Date }[]> {
    return this.leadsRepo.query(`
      SELECT
        utm_campaign AS "campaign",
        COUNT(*)::int AS "count",
        MAX(created_at) AS "lastLeadAt"
      FROM leads
      WHERE agent_mode = 'sdr'
      GROUP BY utm_campaign
      ORDER BY "lastLeadAt" DESC NULLS LAST
    `);
  }

  async moveKanban(id: string, kanbanStage: KanbanStage): Promise<Lead> {
    return this.update(id, { kanbanStage, kanbanStageManual: true });
  }

  async markAsConverted(id: string): Promise<Lead> {
    return this.update(id, { status: 'convertido' });
  }

  async delete(id: string): Promise<void> {
    await this.leadsRepo.delete(id);
  }

  /**
   * created_at é salvo como timestamp naive em UTC (timezone: 'Z' no TypeORM),
   * mas as datas from/to que chegam do frontend representam dias no horário de
   * Brasília. Comparar a string de data direto (ex.: '2026-07-15') contra a
   * coluna UTC sem ajuste faz o corte do dia ficar 3h adiantado — inclui leads
   * das ~21h-23h59 do dia anterior (horário local) no filtro "hoje". A
   * conversão abaixo interpreta o parâmetro como data em America/Sao_Paulo e
   * converte pro equivalente naive-UTC antes de comparar.
   */
  private appendDateFilter(params: string[], from: string | undefined, to: string | undefined): string {
    let dateFilter = '';
    if (from) {
      params.push(from);
      dateFilter += ` AND created_at >= ($${params.length}::timestamp AT TIME ZONE 'America/Sao_Paulo' AT TIME ZONE 'UTC')`;
    }
    if (to) {
      params.push(to);
      dateFilter += ` AND created_at < ($${params.length}::timestamp AT TIME ZONE 'America/Sao_Paulo' AT TIME ZONE 'UTC')`;
    }
    return dateFilter;
  }

  /**
   * Agrega leads do SDR por anúncio (utm_content = Ad ID), pra relatório de
   * performance de campanha. Só considera leads com attribution real (já
   * enriquecidos via Marketing API) — leads antigos sem utm_content ficam de fora.
   */
  async getAdPerformance(from?: string, to?: string): Promise<
    {
      adId: string;
      adName: string | null;
      adsetName: string | null;
      campaignName: string | null;
      total: number;
      leadEventCount: number;
      qualifiedCount: number;
      disqualifiedCount: number;
      premiumCount: number;
      avgSecondsToQualify: number | null;
    }[]
  > {
    const params: string[] = [];
    const dateFilter = this.appendDateFilter(params, from, to);

    return this.leadsRepo.query(
      `
      SELECT
        utm_content AS "adId",
        MAX(ctwa_ad_title) AS "adName",
        MAX(utm_medium) AS "adsetName",
        MAX(utm_campaign) AS "campaignName",
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE lead_event_sent)::int AS "leadEventCount",
        COUNT(*) FILTER (WHERE is_mql)::int AS "qualifiedCount",
        COUNT(*) FILTER (WHERE vende_cabelo = false)::int AS "disqualifiedCount",
        COUNT(*) FILTER (WHERE tags @> '["mql_premium"]'::jsonb)::int AS "premiumCount",
        AVG(EXTRACT(EPOCH FROM (qualified_at - created_at))) FILTER (WHERE qualified_at IS NOT NULL) AS "avgSecondsToQualify"
      FROM leads
      WHERE agent_mode = 'sdr' AND utm_content IS NOT NULL${dateFilter}
      GROUP BY utm_content
      ORDER BY total DESC
    `,
      params,
    );
  }

  /**
   * Lista individual de leads de um anúncio (drill-down do relatório de
   * performance), com nome, status do evento Lead, qualificação e premium.
   */
  async getLeadsByAd(adId: string, from?: string, to?: string): Promise<
    {
      id: string;
      name: string;
      phone: string;
      createdAt: Date;
      leadEventSent: boolean;
      isMql: boolean;
      vendeCabelo: boolean | null;
      isPremium: boolean;
      kanbanStage: string;
    }[]
  > {
    const params: (string)[] = [adId];
    const dateFilter = this.appendDateFilter(params, from, to);

    return this.leadsRepo.query(
      `
      SELECT
        id,
        name,
        phone,
        created_at AS "createdAt",
        lead_event_sent AS "leadEventSent",
        is_mql AS "isMql",
        vende_cabelo AS "vendeCabelo",
        (tags @> '["mql_premium"]'::jsonb) AS "isPremium",
        kanban_stage AS "kanbanStage"
      FROM leads
      WHERE agent_mode = 'sdr' AND utm_content = $1${dateFilter}
      ORDER BY created_at DESC
    `,
      params,
    );
  }

  /**
   * Distribuição de leads por hora do dia (0-23, horário de Brasília), pra
   * identificar picos de chegada e decidir em que horário aumentar o tráfego
   * pago. created_at é salvo em UTC (naive) — converte pra America/Sao_Paulo
   * antes de extrair a hora.
   */
  async getLeadsByHour(from?: string, to?: string): Promise<{ hour: number; count: number }[]> {
    const params: string[] = [];
    const dateFilter = this.appendDateFilter(params, from, to);

    const rows = await this.leadsRepo.query(
      `
      SELECT
        EXTRACT(HOUR FROM (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'))::int AS "hour",
        COUNT(*)::int AS "count"
      FROM leads
      WHERE 1=1${dateFilter}
      GROUP BY hour
      ORDER BY hour
    `,
      params,
    );

    const byHour = new Map<number, number>(rows.map((r: { hour: number; count: number }) => [r.hour, r.count]));
    return Array.from({ length: 24 }, (_, hour) => ({ hour, count: byHour.get(hour) || 0 }));
  }

  async clearAll(): Promise<{ deleted: number }> {
    const result = await this.leadsRepo.createQueryBuilder().delete().from(Lead).execute();
    this.logger.warn(`Todos os ${result.affected} leads foram deletados`);
    return { deleted: result.affected || 0 };
  }

  private classifyScore(score: number): LeadClassification {
    if (score >= 100) return 'otimo';
    if (score >= 60) return 'bom';
    return 'frio';
  }
}
