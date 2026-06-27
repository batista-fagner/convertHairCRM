import { Controller, Get, Put, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SDR_PROMPT_KEY, DEFAULT_SDR_PROMPT } from '../sdr/sdr.prompt';

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
}
