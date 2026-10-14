import { Controller, Get } from '@nestjs/common';
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
  async list() {
    const leads = await this.leadsRepo.find({ where: { utmSource: FORM_SOURCE }, order: { createdAt: 'DESC' } });
    return leads.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      email: l.email,
      campaign: l.utmCampaign,
      adset: l.utmTerm,
      ad: l.utmContent,
      platform: l.utmMedium,
      status: l.status,
      formAnswers: l.formAnswers,
      createdAt: l.createdAt,
    }));
  }

  @Get('stats')
  async stats() {
    const total = await this.leadsRepo.count({ where: { utmSource: FORM_SOURCE } });
    return { total };
  }
}
