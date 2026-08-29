import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Lead } from './common/entities/lead.entity';
import { Campaign } from './common/entities/campaign.entity';
import { Form } from './common/entities/form.entity';
import { InstagramAutomation } from './instagram-automation/instagram-automation.entity';
import { IgConversation } from './instagram-automation/ig-conversation.entity';
import { IgMessage } from './instagram-automation/ig-message.entity';
import { IgCommentEvent } from './instagram-automation/ig-comment-event.entity';
import { Setting } from './settings/setting.entity';
import { FollowupRule } from './common/entities/followup-rule.entity';
import { FollowupVideo } from './common/entities/followup-video.entity';
import { SmsContact } from './sms/entities/sms-contact.entity';
import { SmsMessage } from './sms/entities/sms-message.entity';
import { IgPost } from './ig-posts/ig-post.entity';
import { Quiz } from './common/entities/quiz.entity';
import { LeadsModule } from './leads/leads.module';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { FormsModule } from './forms/forms.module';
import { FacebookModule } from './facebook/facebook.module';
import { InstagramAutomationModule } from './instagram-automation/instagram-automation.module';
import { EfraimModule } from './efraim/efraim.module';
import { TrackingModule } from './tracking/tracking.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SdrModule } from './sdr/sdr.module';
import { SettingsModule } from './settings/settings.module';
import { SmsModule } from './sms/sms.module';
import { IgPostsModule } from './ig-posts/ig-posts.module';
import { InstantFormsModule } from './instant-forms/instant-forms.module';
import { QueueModule } from './queue/queue.module';
import { QuizModule } from './quiz/quiz.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    QueueModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL') || config.get('SUPABASE_DATABASE_URL'),
        // Supabase exige SSL; `DATABASE_SSL=false` permite apontar para um
        // Postgres local descartável ao testar sem tocar em produção.
        ssl: config.get('DATABASE_SSL') === 'false' ? false : { rejectUnauthorized: false },
        entities: [Lead, Campaign, Form, InstagramAutomation, IgConversation, IgMessage, IgCommentEvent, Setting, FollowupRule, FollowupVideo, SmsContact, SmsMessage, IgPost, Quiz],
        synchronize: true,
        logging: false,
        timezone: 'Z',
      }),
    }),
    LeadsModule,
    EnrichmentModule,
    FormsModule,
    FacebookModule,
    InstagramAutomationModule,
    EfraimModule,
    TrackingModule,
    RealtimeModule,
    SdrModule,
    SettingsModule,
    SmsModule,
    IgPostsModule,
    InstantFormsModule,
    QuizModule,
  ],
})
export class AppModule {}
