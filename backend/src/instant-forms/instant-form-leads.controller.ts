import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../common/entities/lead.entity';

// Fonte usada pra marcar leads vindos do formulário "ConvertHair50" (ver instant-forms.service.ts).
const FORM_SOURCE = 'formulario-instantaneo';

/** Endpoints de leitura pra tela de Formulário Instantâneo no CRM — separado do webhook (instant-forms.controller.ts). */
@Controller('instant-form-leads')
export class InstantFormLeadsController {
  constructor(@InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>) {}

  @Get()
  async list(@Query('mql30') mql30?: string) {
    const where: Record<string, unknown> = { utmSource: FORM_SOURCE };
    if (mql30 === 'true') where.formMql30 = true;
    if (mql30 === 'false') where.formMql30 = false;

    const leads = await this.leadsRepo.find({ where, order: { createdAt: 'DESC' } });
    return leads.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      email: l.email,
      status: l.status,
      formMql30: l.formMql30,
      formAnswers: l.formAnswers,
      createdAt: l.createdAt,
    }));
  }

  @Get('stats')
  async stats() {
    const [total, mql30] = await Promise.all([
      this.leadsRepo.count({ where: { utmSource: FORM_SOURCE } }),
      this.leadsRepo.count({ where: { utmSource: FORM_SOURCE, formMql30: true } }),
    ]);
    return { total, mql30, comum: total - mql30 };
  }
}
