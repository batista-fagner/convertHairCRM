import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstagramAutomation } from './instagram-automation.entity';
import { IgConversation } from './ig-conversation.entity';
import { IgMessage } from './ig-message.entity';
import { IgCommentEvent } from './ig-comment-event.entity';
import { Lead } from '../common/entities/lead.entity';
import { InstagramAutomationService } from './instagram-automation.service';
import { InstagramAutomationController } from './instagram-automation.controller';
import { SettingsModule } from '../settings/settings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { IgTokenModule } from '../ig-token/ig-token.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InstagramAutomation, IgConversation, IgMessage, IgCommentEvent, Lead]),
    SettingsModule,
    RealtimeModule,
    IgTokenModule,
  ],
  providers: [InstagramAutomationService],
  controllers: [InstagramAutomationController],
  exports: [InstagramAutomationService],
})
export class InstagramAutomationModule {}
