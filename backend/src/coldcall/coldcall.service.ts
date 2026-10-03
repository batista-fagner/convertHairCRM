import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ColdCallLead } from '../common/entities/coldcall-lead.entity';
import { ColdCallStage } from '../common/entities/coldcall-stage.entity';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';

/** Teto de cards carregados POR RAIA no Kanban — mesmo raciocínio do Kanban de leads. */
const KANBAN_PER_STAGE_LIMIT = 200;

// Colunas esperadas no CSV (ver lote_03_dedetizadoras_b2b_50.csv): company_name,
// city, state, phone_e164, email, website, source_url, b2b_evidence.
// Opcionais de enriquecimento: nota_google, avaliacoes_google, bairro.
const CSV_COLUMNS = ['company_name', 'city', 'state', 'phone_e164', 'email', 'website', 'source_url', 'b2b_evidence'] as const;

// Nomes alternativos (em português) aceitos no cabeçalho → nome canônico.
const HEADER_ALIASES: Record<string, string> = {
  nome: 'company_name',
  cidade: 'city',
  estado: 'state',
  telefone_e164: 'phone_e164',
  google_rating: 'nota_google',
  google_reviews: 'avaliacoes_google',
  neighborhood: 'bairro',
};

/** "5,0" / "4.8" → número; vazio ou inválido → null. */
function parseNumber(value?: string): number | null {
  const n = parseFloat((value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Parser simples de CSV (aspas + vírgula) — arquivo pequeno (dezenas de linhas), não justifica dependência nova. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current);
    return fields.map((f) => f.trim());
  };

  // BOM do Excel ("﻿") grudaria no nome da 1ª coluna e ela nunca casaria.
  const header = parseLine(lines[0].replace(/^﻿/, '')).map((h) => {
    const key = h.toLowerCase();
    return HEADER_ALIASES[key] ?? key;
  });
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    header.forEach((col, idx) => {
      row[col] = values[idx] ?? '';
    });
    return row;
  });
}

@Injectable()
export class ColdCallService {
  constructor(
    @InjectRepository(ColdCallLead) private readonly repo: Repository<ColdCallLead>,
    @InjectRepository(ColdCallStage) private readonly stageRepo: Repository<ColdCallStage>,
    private readonly calendar: GoogleCalendarService,
  ) {}

  /**
   * Importa um lote CSV. Dedup por telefone (quando presente) — evita
   * duplicar o mesmo prospect se o mesmo arquivo (ou um lote sobreposto) for
   * subido de novo. Linhas sem telefone sempre entram (não dá pra deduplicar
   * com segurança só por nome da empresa).
   */
  async importCsv(fileContent: string, listName?: string): Promise<{ imported: number; skipped: number; enriched: number; total: number; listName: string | null }> {
    const rows = parseCsv(fileContent);
    const list = listName?.trim() || null;
    const existingByPhone = new Map(
      (await this.repo.find({ select: ['id', 'phone', 'googleRating', 'googleReviews', 'neighborhood'] }))
        .filter((l) => !!l.phone)
        .map((l) => [l.phone as string, l]),
    );
    const insertedPhones = new Set<string>();

    let imported = 0;
    let skipped = 0;
    let enriched = 0;
    const toInsert: Partial<ColdCallLead>[] = [];

    for (const row of rows) {
      const companyName = row['company_name']?.trim();
      if (!companyName) {
        skipped++;
        continue;
      }
      const phone = row['phone_e164']?.trim() || null;
      const enrichment = {
        googleRating: parseNumber(row['nota_google']),
        googleReviews: parseNumber(row['avaliacoes_google']),
        neighborhood: row['bairro']?.trim() || null,
      };

      // Já existe: não duplica, mas completa o enriquecimento que estiver vazio
      // (reimportar uma lista com nota/avaliações/bairro atualiza os cards).
      const existing = phone ? existingByPhone.get(phone) : undefined;
      if (existing) {
        const patch: Partial<ColdCallLead> = {};
        if (existing.googleRating == null && enrichment.googleRating != null) patch.googleRating = enrichment.googleRating;
        if (existing.googleReviews == null && enrichment.googleReviews != null) patch.googleReviews = Math.round(enrichment.googleReviews);
        if (!existing.neighborhood && enrichment.neighborhood) patch.neighborhood = enrichment.neighborhood;
        if (Object.keys(patch).length > 0) {
          await this.repo.update(existing.id, patch);
          enriched++;
        }
        skipped++;
        continue;
      }
      if (phone && insertedPhones.has(phone)) {
        skipped++;
        continue;
      }
      if (phone) insertedPhones.add(phone);

      toInsert.push({
        companyName,
        city: row['city']?.trim() || null,
        state: row['state']?.trim() || null,
        phone,
        email: row['email']?.trim() || null,
        website: row['website']?.trim() || null,
        sourceUrl: row['source_url']?.trim() || null,
        b2bEvidence: row['b2b_evidence']?.trim() || null,
        googleRating: enrichment.googleRating,
        googleReviews: enrichment.googleReviews != null ? Math.round(enrichment.googleReviews) : null,
        neighborhood: enrichment.neighborhood,
        kanbanStage: 'novo',
        listName: list,
      });
      imported++;
    }

    if (toInsert.length > 0) {
      await this.repo.insert(toInsert);
    }

    return { imported, skipped, enriched, total: rows.length, listName: list };
  }

  /** Listas importadas (nome + quantos prospects), pro filtro do Kanban. */
  async getLists(): Promise<{ name: string; count: number }[]> {
    const rows = await this.repo
      .createQueryBuilder('l')
      .select('l.list_name', 'name')
      .addSelect('COUNT(*)', 'count')
      .where('l.list_name IS NOT NULL')
      .groupBy('l.list_name')
      .orderBy('l.list_name', 'ASC')
      .getRawMany<{ name: string; count: string }>();
    return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
  }

  async findKanban(listName?: string): Promise<Record<string, ColdCallLead[]>> {
    // getCustomStages() já traz TODAS as raias (as 6 originais seedadas na
    // migração + as criadas depois) — não existe mais lista fixa separada.
    const allStages: string[] = (await this.getCustomStages()).map((s) => s.stageKey);

    const perStage = await Promise.all(
      allStages.map(async (stage) => {
        const list = listName ? { listName } : {};
        const where = stage === 'novo'
          ? [{ kanbanStage: 'novo', ...list }, { kanbanStage: IsNull(), ...list }]
          : { kanbanStage: stage, ...list };
        const leads = await this.repo.find({
          where: where as any,
          order: { updatedAt: 'DESC' },
          take: KANBAN_PER_STAGE_LIMIT,
        });
        return [stage, leads] as const;
      }),
    );

    return Object.fromEntries(perStage);
  }

  async update(id: string, dto: Partial<ColdCallLead>): Promise<ColdCallLead> {
    await this.repo.update(id, dto);
    const lead = await this.repo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException(`Prospect ${id} não encontrado`);
    return lead;
  }

  /**
   * Agenda / remarca / desmarca a reunião do prospect e espelha no Google
   * Agenda (30 min, lembrete por e-mail). meetingAt=null desmarca e apaga o evento.
   */
  async setMeeting(
    id: string,
    opts: { meetingAt: Date | null; withMeet: boolean; inviteProspect: boolean },
  ): Promise<ColdCallLead> {
    const lead = await this.repo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException(`Prospect ${id} não encontrado`);

    if (!opts.meetingAt) {
      if (lead.meetingEventId) await this.calendar.deleteEvent(lead.meetingEventId, lead.meetingInvited);
      return this.update(id, { meetingAt: null, meetingEventId: null, meetingLink: null, meetingInvited: false });
    }

    const attendeeEmail = opts.inviteProspect && lead.email ? lead.email : null;
    const description = [
      lead.phone ? `Telefone: ${lead.phone}` : null,
      lead.phone ? `WhatsApp: https://wa.me/${lead.phone.replace(/\D/g, '')}` : null,
      [lead.neighborhood, lead.city, lead.state].filter(Boolean).join(' - ') || null,
      lead.listName ? `Lista: ${lead.listName}` : null,
      'Agendado pelo Cold Call (CRM ConvertHair)',
    ].filter(Boolean).join('\n');
    const input = {
      summary: `Reunião — ${lead.companyName}`,
      description,
      start: opts.meetingAt,
      durationMinutes: 30,
      withMeet: opts.withMeet,
      attendeeEmail,
    };

    const result = lead.meetingEventId
      ? await this.calendar.updateEvent(lead.meetingEventId, input, !!lead.meetingLink)
      : await this.calendar.createEvent(input);

    return this.update(id, {
      meetingAt: opts.meetingAt,
      meetingEventId: result.eventId,
      meetingLink: opts.withMeet ? result.meetLink : null,
      meetingInvited: !!attendeeEmail,
    });
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  /**
   * TODAS as raias do board — as 6 originais (seedadas uma vez via script de
   * migração direto na tabela, ver memória do módulo) e as criadas depois
   * pelo botão "Nova raia", sem distinção: todas editáveis, excluíveis e
   * reordenáveis a partir daqui. Ordenadas por `position`; raias muito
   * antigas sem position (não deveria mais existir após a migração) caem
   * pro fim via NULLS LAST.
   */
  async getCustomStages(): Promise<ColdCallStage[]> {
    return this.stageRepo
      .createQueryBuilder('s')
      .orderBy('s.position', 'ASC', 'NULLS LAST')
      .addOrderBy('s.createdAt', 'ASC')
      .getMany();
  }

  async createCustomStage(title: string): Promise<ColdCallStage> {
    const trimmed = title.trim();
    if (!trimmed) throw new ConflictException('Nome da raia não pode ser vazio');

    const existing = await this.getCustomStages();
    const existingKeys = new Set<string>(existing.map((s) => s.stageKey));
    const base =
      trimmed
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'raia';
    let stageKey = base;
    let suffix = 2;
    while (existingKeys.has(stageKey)) {
      stageKey = `${base}-${suffix++}`;
    }

    const maxPosition = existing.reduce((max, s) => Math.max(max, s.position ?? -1), -1);
    const stage = this.stageRepo.create({ stageKey, title: trimmed, position: maxPosition + 1 });
    return this.stageRepo.save(stage);
  }

  async renameCustomStage(id: string, title: string): Promise<ColdCallStage> {
    const trimmed = title.trim();
    if (!trimmed) throw new ConflictException('Nome da raia não pode ser vazio');
    await this.stageRepo.update(id, { title: trimmed });
    const stage = await this.stageRepo.findOne({ where: { id } });
    if (!stage) throw new NotFoundException(`Raia ${id} não encontrada`);
    return stage;
  }

  async deleteCustomStage(id: string): Promise<void> {
    const stage = await this.stageRepo.findOne({ where: { id } });
    if (!stage) throw new NotFoundException(`Raia ${id} não encontrada`);
    // 'novo' é o fallback de prospect sem raia (ver findKanban) — conta os
    // dois casos pra não deixar prospect "órfão" apontando pra raia excluída.
    const where = stage.stageKey === 'novo' ? [{ kanbanStage: 'novo' }, { kanbanStage: IsNull() }] : { kanbanStage: stage.stageKey };
    const inStage = await this.repo.count({ where: where as any });
    if (inStage > 0) {
      throw new ConflictException(`Mova os ${inStage} prospect(s) dessa raia antes de excluí-la.`);
    }
    await this.stageRepo.delete(id);
  }

  /**
   * Troca de posição com o vizinho imediato — nunca recalcula o board
   * inteiro, só troca os dois `position` envolvidos. Todas as posições são
   * inteiros distintos (seed inicial 0-5, próxima raia = max+1), então o
   * swap não tem risco de colisão/drift de float.
   */
  async moveStage(id: string, direction: 'left' | 'right'): Promise<ColdCallStage[]> {
    const stages = await this.getCustomStages();
    const idx = stages.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Raia ${id} não encontrada`);
    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= stages.length) return stages;

    const a = stages[idx];
    const b = stages[targetIdx];
    const posA = a.position ?? idx;
    const posB = b.position ?? targetIdx;
    await this.stageRepo.update(a.id, { position: posB });
    await this.stageRepo.update(b.id, { position: posA });
    return this.getCustomStages();
  }
}
