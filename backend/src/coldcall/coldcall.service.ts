import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ColdCallLead } from '../common/entities/coldcall-lead.entity';
import { ColdCallStage } from '../common/entities/coldcall-stage.entity';

/** Teto de cards carregados POR RAIA no Kanban — mesmo raciocínio do Kanban de leads. */
const KANBAN_PER_STAGE_LIMIT = 200;

// Colunas esperadas no CSV (ver lote_03_dedetizadoras_b2b_50.csv): company_name,
// city, state, phone_e164, email, website, source_url, b2b_evidence.
const CSV_COLUMNS = ['company_name', 'city', 'state', 'phone_e164', 'email', 'website', 'source_url', 'b2b_evidence'] as const;

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

  const header = parseLine(lines[0]).map((h) => h.toLowerCase());
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
  ) {}

  /**
   * Importa um lote CSV. Dedup por telefone (quando presente) — evita
   * duplicar o mesmo prospect se o mesmo arquivo (ou um lote sobreposto) for
   * subido de novo. Linhas sem telefone sempre entram (não dá pra deduplicar
   * com segurança só por nome da empresa).
   */
  async importCsv(fileContent: string): Promise<{ imported: number; skipped: number; total: number }> {
    const rows = parseCsv(fileContent);
    const existingPhones = new Set(
      (await this.repo.find({ select: ['phone'] })).map((l) => l.phone).filter((p): p is string => !!p),
    );

    let imported = 0;
    let skipped = 0;
    const toInsert: Partial<ColdCallLead>[] = [];

    for (const row of rows) {
      const companyName = row['company_name']?.trim();
      if (!companyName) {
        skipped++;
        continue;
      }
      const phone = row['phone_e164']?.trim() || null;
      if (phone && existingPhones.has(phone)) {
        skipped++;
        continue;
      }
      if (phone) existingPhones.add(phone);

      toInsert.push({
        companyName,
        city: row['city']?.trim() || null,
        state: row['state']?.trim() || null,
        phone,
        email: row['email']?.trim() || null,
        website: row['website']?.trim() || null,
        sourceUrl: row['source_url']?.trim() || null,
        b2bEvidence: row['b2b_evidence']?.trim() || null,
        kanbanStage: 'novo',
      });
      imported++;
    }

    if (toInsert.length > 0) {
      await this.repo.insert(toInsert);
    }

    return { imported, skipped, total: rows.length };
  }

  async findKanban(): Promise<Record<string, ColdCallLead[]>> {
    // getCustomStages() já traz TODAS as raias (as 6 originais seedadas na
    // migração + as criadas depois) — não existe mais lista fixa separada.
    const allStages: string[] = (await this.getCustomStages()).map((s) => s.stageKey);

    const perStage = await Promise.all(
      allStages.map(async (stage) => {
        const where = stage === 'novo' ? [{ kanbanStage: 'novo' }, { kanbanStage: IsNull() }] : { kanbanStage: stage };
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
