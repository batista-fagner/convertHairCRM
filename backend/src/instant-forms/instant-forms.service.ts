import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Lead } from '../common/entities/lead.entity';
import { FacebookService } from '../facebook/facebook.service';

// Respostas da Q2 do formulário "ConvertHair50" que caracterizam alto volume
// de mensagens no WhatsApp — desviam o fluxo pro caminho Q3→Q4 (em vez de Q5),
// e são o único sinal que diferencia um lead "MQL+30" de um lead comum nesse
// formulário (ambos chegam no mesmo Q6/telefone e página de confirmação).
const MQL_30_ANSWERS = ['entre 30 e 40', 'acima de 50'];
const CRM_EVENT_NAME = 'MQL+30';

interface LeadgenFieldData {
  name: string;
  values: string[];
}

@Injectable()
export class InstantFormsService {
  private readonly logger = new Logger(InstantFormsService.name);

  constructor(
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    private readonly config: ConfigService,
    private readonly facebookService: FacebookService,
  ) {}

  /** Processa 1 evento de leadgen recebido no webhook: busca os dados completos, salva o lead e — se qualificado — avisa o Meta. */
  async processLeadgenEvent(leadgenId: string): Promise<void> {
    const token = this.config.get('FB_LEADS_TOKEN');
    if (!token) {
      this.logger.warn('FB_LEADS_TOKEN não configurado — não é possível buscar os dados do lead');
      return;
    }

    let fieldData: LeadgenFieldData[];
    try {
      const res = await axios.get(`https://graph.facebook.com/v21.0/${leadgenId}`, {
        params: { access_token: token, fields: 'id,form_id,field_data,created_time' },
      });
      fieldData = res.data.field_data || [];
    } catch (err: any) {
      this.logger.error(`Erro ao buscar dados do lead ${leadgenId}: ${err.response?.data?.error?.message || err.message}`);
      return;
    }

    const getAnswer = (matcher: (name: string) => boolean): string | undefined => {
      const field = fieldData.find((f) => matcher(f.name.toLowerCase()));
      return field?.values?.[0];
    };

    // Nomes de campo custom do Meta variam (texto da pergunta, slug, etc.) —
    // por isso o match é por substring, não chave exata, já que não temos como
    // testar o formato real antes do 1º lead de verdade chegar.
    const fullName = getAnswer((n) => n.includes('full_name') || n === 'name' || n.includes('nome')) || 'Lead sem nome';
    const email = getAnswer((n) => n.includes('email'));
    const phoneRaw = getAnswer((n) => n.includes('número') || n.includes('numero') || n.includes('phone') || n.includes('telefone'));
    const phone = (phoneRaw || '').replace(/\D/g, '');
    const volumeAnswer = getAnswer((n) => n.includes('mensagens') && n.includes('dia'));

    if (!phone) {
      this.logger.warn(`Lead ${leadgenId} sem telefone reconhecível nos campos: ${JSON.stringify(fieldData.map((f) => f.name))}`);
    }

    const isMql30 = Boolean(volumeAnswer && MQL_30_ANSWERS.includes(volumeAnswer.trim().toLowerCase()));

    const answersSummary = fieldData.map((f) => `${f.name}: ${f.values?.[0] ?? ''}`).join('\n');

    const existing = phone ? await this.leadsRepo.findOne({ where: { phone } }) : null;
    const lead = existing
      ? await this.leadsRepo.save({
          ...existing,
          name: fullName,
          email: email || existing.email,
          formAnswers: fieldData,
          formMql30: isMql30,
          notes: `[Formulário Instantâneo — ${leadgenId}]\n${answersSummary}`,
        })
      : await this.leadsRepo.save(
          this.leadsRepo.create({
            name: fullName,
            phone: phone || `sem-telefone-${leadgenId}`,
            email: email || undefined,
            status: 'novo',
            utmSource: 'formulario-instantaneo',
            formAnswers: fieldData,
            formMql30: isMql30,
            notes: `[Formulário Instantâneo — ${leadgenId}]\n${answersSummary}`,
          }),
        );

    this.logger.log(`[InstantForms] Lead ${lead.id} (${phone || 'sem telefone'}) capturado do formulário — MQL+30: ${isMql30}`);

    if (isMql30) {
      await this.facebookService.sendCrmLeadEvent(leadgenId, phone, CRM_EVENT_NAME).catch((err) =>
        this.logger.error(`[InstantForms] Erro ao enviar evento ${CRM_EVENT_NAME} ao Meta: ${err.message}`),
      );
    }
  }
}
