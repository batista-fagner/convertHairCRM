import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from './common/entities/lead.entity';
import { Campaign } from './common/entities/campaign.entity';
import { Form } from './common/entities/form.entity';
import { InstagramAutomation } from './instagram-automation/instagram-automation.entity';
import { IgConversation } from './instagram-automation/ig-conversation.entity';
import { Carousel } from './carousel/carousel.entity';
import { Setting } from './settings/setting.entity';
import { LeadsModule } from './leads/leads.module';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { FormsModule } from './forms/forms.module';
import { FacebookModule } from './facebook/facebook.module';
import { InstagramAutomationModule } from './instagram-automation/instagram-automation.module';
import { EfraimModule } from './efraim/efraim.module';
import { CarouselModule } from './carousel/carousel.module';
import { TrackingModule } from './tracking/tracking.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SdrModule } from './sdr/sdr.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL') || config.get('SUPABASE_DATABASE_URL'),
        ssl: { rejectUnauthorized: false },
        entities: [Lead, Campaign, Form, InstagramAutomation, IgConversation, Carousel, Setting],
        synchronize: true,
        logging: false,
      }),
    }),
    LeadsModule,
    EnrichmentModule,
    FormsModule,
    FacebookModule,
    InstagramAutomationModule,
    EfraimModule,
    CarouselModule,
    TrackingModule,
    RealtimeModule,
    SdrModule,
    SettingsModule,
  ],
})
export class AppModule {}
