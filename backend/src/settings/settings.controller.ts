import { Controller, Get, Put, Post, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SDR_PROMPT_KEY, DEFAULT_SDR_PROMPT, SDR_MODEL_KEY, SDR_DEFAULT_MODEL } from '../sdr/sdr.prompt';

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
}
