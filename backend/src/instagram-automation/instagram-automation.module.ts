import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstagramAutomation } from './instagram-automation.entity';
import { IgConversation } from './ig-conversation.entity';
import { Lead } from '../common/entities/lead.entity';
import { InstagramAutomationService } from './instagram-automation.service';
import { InstagramAutomationController } from './instagram-automation.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [TypeOrmModule.forFeature([InstagramAutomation, IgConversation, Lead]), SettingsModule],
  providers: [InstagramAutomationService],
  controllers: [InstagramAutomationController],
})
export class InstagramAutomationModule {}
