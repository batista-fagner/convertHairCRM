import { Module } from '@nestjs/common';
import { GreennController } from './greenn.controller';
import { GreennService } from './greenn.service';
import { FacebookModule } from '../facebook/facebook.module';
import { QuizModule } from '../quiz/quiz.module';
import { LeadsModule } from '../leads/leads.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [FacebookModule, QuizModule, LeadsModule, RealtimeModule],
  controllers: [GreennController],
  providers: [GreennService],
})
export class GreennModule {}
