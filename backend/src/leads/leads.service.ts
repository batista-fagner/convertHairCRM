import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead, LeadClassification, KanbanStage } from '../common/entities/lead.entity';

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

  async findAll(opts?: { campaignId?: string; page?: number; limit?: number; source?: 'all' | 'ig_dm' | 'paid' }): Promise<{ data: Lead[]; total: number; page: number; totalPages: number }> {
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

  async getStats(): Promise<{
    total: number;
    totalMql: number;
    byStatus: Record<string, number>;
    byWaStage: Record<string, number>;
    conversionRate: number;
    recent: Lead[];
  }> {
    const all = await this.leadsRepo.find({ order: { createdAt: 'DESC' } });
    const total = all.length;
    const totalMql = all.filter(l => l.isMql).length;

    const byStatus: Record<string, number> = {};
    const byWaStage: Record<string, number> = {};
    for (const lead of all) {
      byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
      if (lead.waStage) byWaStage[lead.waStage] = (byWaStage[lead.waStage] || 0) + 1;
    }

    const convertido = byStatus['convertido'] || 0;
    const conversionRate = total > 0 ? Math.round((convertido / total) * 1000) / 10 : 0;
    const recent = all.slice(0, 5);

    return { total, totalMql, byStatus, byWaStage, conversionRate, recent };
  }

  async findKanban(): Promise<Record<KanbanStage, Lead[]>> {
    const leads = await this.leadsRepo.find({
      where: { agentMode: 'sdr' },
      order: { updatedAt: 'DESC' },
      take: 400,
    });
    const board: Record<KanbanStage, Lead[]> = { novo: [], atendimento: [], 'nao-qualificado': [], qualificado: [], contactado: [], 'ja-fez-prompt': [], 'ja-apresentado': [], 'em-negociacao': [], vendeu: [], perdido: [] };
    for (const lead of leads) {
      const stage = (lead.kanbanStage as KanbanStage) || 'novo';
      (board[stage] || board.novo).push(lead);
    }
    return board;
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
   * Agrega leads do SDR por anúncio (utm_content = Ad ID), pra relatório de
   * performance de campanha. Só considera leads com attribution real (já
   * enriquecidos via Marketing API) — leads antigos sem utm_content ficam de fora.
   */
  async getAdPerformance(): Promise<
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
    return this.leadsRepo.query(`
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
      WHERE agent_mode = 'sdr' AND utm_content IS NOT NULL
      GROUP BY utm_content
      ORDER BY total DESC
    `);
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
