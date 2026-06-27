import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './setting.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting)
    private settingsRepo: Repository<Setting>,
  ) {}

  async get(key: string): Promise<string | null> {
    const row = await this.settingsRepo.findOne({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<Setting> {
    await this.settingsRepo.upsert({ key, value }, ['key']);
    return this.settingsRepo.findOneOrFail({ where: { key } });
  }
}
