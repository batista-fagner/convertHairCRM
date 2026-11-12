import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { IgAudit } from '../common/entities/ig-audit.entity';
import { SettingsModule } from '../settings/settings.module';
import { IgAuditService } from './ig-audit.service';
import { IgAuditController } from './ig-audit.controller';

@Module({
  imports: [TypeOrmModule.forFeature([IgAudit]), SettingsModule, ConfigModule],
  providers: [IgAuditService],
  controllers: [IgAuditController],
})
export class IgAuditModule {}
