import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SmsContact } from './entities/sms-contact.entity';
import { SmsMessage } from './entities/sms-message.entity';
import { SmsService } from './sms.service';
import { SmsInboundService } from './sms-inbound.service';
import { SmsController } from './sms.controller';
import { SmsWebhookController } from './sms-webhook.controller';
import { SMS_PROVIDER } from './providers/sms-provider.interface';
import { MockSmsProvider } from './providers/mock-sms.provider';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([SmsContact, SmsMessage]), RealtimeModule],
  controllers: [SmsController, SmsWebhookController],
  providers: [
    SmsService,
    SmsInboundService,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const name = (config.get<string>('SMS_PROVIDER') ?? 'mock').toLowerCase();
        switch (name) {
          // 'twilio' entra aqui quando o número for contratado — nenhuma regra
          // de negócio muda, só esta linha.
          default:
            return new MockSmsProvider(config);
        }
      },
    },
  ],
  exports: [SmsService],
})
export class SmsModule {}
