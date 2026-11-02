import { BadRequestException, Body, Controller, Get, Post, Put } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { EfraimQuizService } from './efraim-quiz.service';
import { DEFAULT_EFRAIM_PROMPT, EFRAIM_ENABLED_KEY, EFRAIM_FOLLOWUP_KEY, EFRAIM_PROMPT_KEY, EFRAIM_QUIZ_SLUGS_KEY } from './efraim-quiz.prompt';

/** Configurações → Efraim (agente do funil do quiz): prompt, liga/desliga, quizzes e simulador. */
@Controller('efraim')
export class EfraimQuizController {
  constructor(
    private readonly efraim: EfraimQuizService,
    private readonly settings: SettingsService,
  ) {}

  @Get('prompt')
  async getPrompt() {
    const value = await this.settings.get(EFRAIM_PROMPT_KEY);
    return { value: value ?? DEFAULT_EFRAIM_PROMPT, isCustom: value != null, default: DEFAULT_EFRAIM_PROMPT };
  }

  @Put('prompt')
  async setPrompt(@Body() body: { value: string }) {
    const value = (body.value ?? '').trim();
    const saved = await this.settings.set(EFRAIM_PROMPT_KEY, value || DEFAULT_EFRAIM_PROMPT);
    return { value: saved.value, isCustom: true };
  }

  @Get('config')
  async getConfig() {
    return this.efraim.getConfig();
  }

  @Put('config')
  async setConfig(@Body() body: { enabled?: boolean; quizSlugs?: string[]; followupEnabled?: boolean }) {
    if (typeof body.enabled === 'boolean') await this.settings.set(EFRAIM_ENABLED_KEY, String(body.enabled));
    if (typeof body.followupEnabled === 'boolean') await this.settings.set(EFRAIM_FOLLOWUP_KEY, String(body.followupEnabled));
    if (Array.isArray(body.quizSlugs)) {
      const slugs = Array.from(new Set(body.quizSlugs.map((s) => String(s || '').trim()).filter(Boolean)));
      await this.settings.set(EFRAIM_QUIZ_SLUGS_KEY, slugs.join(','));
    }
    return this.efraim.getConfig();
  }

  @Get('sample')
  async getSample() {
    return this.efraim.getSample();
  }

  @Post('simulate')
  async simulate(
    @Body() body: { message?: string; history?: { role: 'user' | 'assistant'; content: string }[]; name?: string; quizResponses?: { question: string; answer: string }[]; slots?: string[] },
  ) {
    try {
      return await this.efraim.simulate(body ?? {});
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }
}
