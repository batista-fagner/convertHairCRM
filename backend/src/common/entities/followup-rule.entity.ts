import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { KanbanStage } from './lead.entity';

export type FollowupMode = 'manual' | 'ai';

/**
 * Um toque da cadência de follow-up. A regra vira uma sequência de N toques
 * (ex.: 7 dias, 1 mensagem por dia), cada um com objetivo próprio.
 *
 * - `delayMinutes`: espera desde a ÚLTIMA mensagem nossa até este toque (não é
 *   tempo absoluto desde o início) — 1440 = 1 dia depois do toque anterior.
 * - `objective`: o que este toque específico precisa fazer (quebrar o gelo,
 *   trazer prova social, provocar a dor, última chamada...). É o que muda de um
 *   dia pro outro.
 * - `text`: no modo manual é a mensagem enviada literalmente; no modo IA é o
 *   TEXTO BASE que a IA usa como referência pra escrever a mensagem do dia.
 */
export interface CadenceStep {
  delayMinutes: number;
  objective: string;
  text?: string | null;
}

// kanbanStage/utmCampaign nulos = curinga (casa com qualquer raia/campanha).
// O matching escolhe a regra mais específica pra cada lead (ver sdr-followup.service.ts).
@Entity('followup_rules')
export class FollowupRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'kanban_stage', type: 'varchar', nullable: true })
  kanbanStage?: KanbanStage | null;

  @Column({ name: 'utm_campaign', type: 'varchar', nullable: true })
  utmCampaign?: string | null;

  // Título do anúncio (ctwa_ad_title) — filtra por criativo específico. Nulo = qualquer criativo.
  @Column({ name: 'ad_title', type: 'varchar', nullable: true })
  adTitle?: string | null;

  // Só casa com leads criados a partir desta data/hora. Nulo = sem filtro de data.
  // Usado pra restringir uma regra aos leads que estão chegando agora (ex: "hoje"),
  // sem afetar leads antigos já parados na mesma raia.
  @Column({ name: 'created_after', type: 'timestamp', nullable: true })
  createdAfter?: Date | null;

  @Column({ name: 'delay_minutes', type: 'int', default: 60 })
  delayMinutes: number;

  // Cadência multi-toque: quando preenchido, a regra deixa de mandar 1 mensagem
  // só e passa a percorrer esta sequência (1 toque por vez, na ordem, cada um
  // esperando o próprio delayMinutes desde o toque anterior). Nulo/vazio =
  // comportamento antigo de disparo único usando delayMinutes/text/promptOverride.
  // O progresso de cada lead fica em lead.followupStep / lead.followupNextAt.
  @Column({ name: 'cadence_steps', type: 'jsonb', nullable: true })
  cadenceSteps?: CadenceStep[] | null;

  // Horário preferido de disparo (fuso America/Sao_Paulo). Nulo = sem restrição,
  // dispara assim que o prazo de inatividade vencer (comportamento padrão).
  // Preenchido = só dispara na próxima ocorrência desse horário (hoje se ainda
  // não passou, amanhã se já passou) — mesmo que o prazo já tenha vencido antes.
  @Column({ name: 'send_at_hour', type: 'int', nullable: true })
  sendAtHour?: number | null;

  @Column({ name: 'send_at_minute', type: 'int', default: 0 })
  sendAtMinute: number;

  @Column({ name: 'mode', type: 'varchar', default: 'manual' })
  mode: FollowupMode;

  @Column({ name: 'text', type: 'text', nullable: true })
  text?: string | null;

  // Modo 'ai': se preenchido, substitui o prompt padrão da Sofia (DEFAULT_SDR_PROMPT)
  // só nesta regra — usado pra campanhas de reativação com objetivo diferente da
  // qualificação normal (ex.: puxar de volta quem já foi marcado como qualificado).
  // O histórico da conversa (lead.aiContext) continua sendo passado normalmente.
  @Column({ name: 'prompt_override', type: 'text', nullable: true })
  promptOverride?: string | null;

  // Por padrão o cron só considera leads com ai_paused=false (a Sofia "desligada"
  // manualmente ou por handoff não recebe follow-up automático). Raias como
  // "qualificado" pausam a IA no handoff pro operador (ver sdr.controller.ts) —
  // marcar true permite que esta regra dispare mesmo assim, sem reativar a Sofia
  // pro fluxo normal de qualificação.
  @Column({ name: 'ignore_ai_paused', type: 'boolean', default: false })
  ignoreAiPaused: boolean;

  // Se preenchido, a regra manda esse vídeo (com legenda) em vez de texto —
  // o mode/text passam a ser ignorados. FK lógica pro FollowupVideo.
  @Column({ name: 'video_id', type: 'uuid', nullable: true })
  videoId?: string | null;

  // Legenda específica desta regra; se null, usa a caption padrão do vídeo.
  @Column({ name: 'video_caption_override', type: 'text', nullable: true })
  videoCaptionOverride?: string | null;

  // Botão de link (opcional) — quando preenchido (com buttonUrl), a regra manda a
  // mensagem como botão interativo (uazapi /send/menu, type=button) em vez de texto
  // puro. Uso típico: campanha de disparo em massa com botão "Entrar no grupo".
  // Não combina com vídeo/cadência — só se aplica ao disparo único de texto/IA.
  @Column({ name: 'button_label', type: 'varchar', nullable: true })
  buttonLabel?: string | null;

  @Column({ name: 'button_url', type: 'text', nullable: true })
  buttonUrl?: string | null;

  // Desempate manual quando duas regras têm a mesma especificidade pro mesmo lead (menor = prioridade maior).
  @Column({ name: 'priority', type: 'int', default: 0 })
  priority: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
