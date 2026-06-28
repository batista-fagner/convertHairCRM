import { Controller, Get, Put, Post, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SDR_PROMPT_KEY, DEFAULT_SDR_PROMPT, SDR_MODEL_KEY, SDR_DEFAULT_MODEL } from '../sdr/sdr.prompt';
import { FOLLOWUP_ENABLED_KEY, FOLLOWUP_DELAY_KEY, FOLLOWUP_MODE_KEY, FOLLOWUP_TEXT_KEY } from '../sdr/sdr-followup.service';

@Controller('settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get('sdr-prompt')
  async getSdrPrompt() {
    const value = await this.settingsService.get(SDR_PROMPT_KEY);
    return { value: value ?? DEFAULT_SDR_PROMPT, isCustom: value != null, default: DEFAULT_SDR_PROMPT };
  }

  @Put('sdr-prompt')
  async setSdrPrompt(@Body() body: { value: string }) {
    const value = (body.value ?? '').trim();
    const saved = await this.settingsService.set(SDR_PROMPT_KEY, value || DEFAULT_SDR_PROMPT);
    return { value: saved.value, isCustom: true };
  }

  @Get('sdr-model')
  async getSdrModel() {
    const value = await this.settingsService.get(SDR_MODEL_KEY);
    return { value: value ?? SDR_DEFAULT_MODEL };
  }

  @Put('sdr-model')
  async setSdrModel(@Body() body: { value: string }) {
    const allowed = ['gpt-5.4-mini', 'gpt-4.1-mini'];
    const model = allowed.includes(body.value) ? body.value : SDR_DEFAULT_MODEL;
    await this.settingsService.set(SDR_MODEL_KEY, model);
    return { value: model };
  }

  @Post('sdr-simulate')
  async simulate(@Body() body: { message: string; history: { role: 'user' | 'assistant'; content: string }[] }) {
    return this.settingsService.simulate(body.message ?? '', body.history ?? []);
  }

  @Get('sdr-followup')
  async getFollowup() {
    const [enabled, delayMinutes, mode, text] = await Promise.all([
      this.settingsService.get(FOLLOWUP_ENABLED_KEY),
      this.settingsService.get(FOLLOWUP_DELAY_KEY),
      this.settingsService.get(FOLLOWUP_MODE_KEY),
      this.settingsService.get(FOLLOWUP_TEXT_KEY),
    ]);
    return {
      enabled: enabled === 'true',
      delayMinutes: parseInt(delayMinutes || '60', 10),
      mode: mode || 'manual',
      text: text || '',
    };
  }

  @Put('sdr-followup')
  async setFollowup(@Body() body: { enabled: boolean; delayMinutes: number; mode: string; text: string }) {
    await Promise.all([
      this.settingsService.set(FOLLOWUP_ENABLED_KEY, body.enabled ? 'true' : 'false'),
      this.settingsService.set(FOLLOWUP_DELAY_KEY, String(Math.max(1, body.delayMinutes || 60))),
      this.settingsService.set(FOLLOWUP_MODE_KEY, body.mode === 'ai' ? 'ai' : 'manual'),
      this.settingsService.set(FOLLOWUP_TEXT_KEY, body.text || ''),
    ]);
    return { ok: true };
  }
}
