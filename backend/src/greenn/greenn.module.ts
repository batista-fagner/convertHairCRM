import { Module } from '@nestjs/common';
import { GreennController } from './greenn.controller';
import { GreennService } from './greenn.service';
import { FacebookModule } from '../facebook/facebook.module';
import { QuizModule } from '../quiz/quiz.module';

@Module({
  imports: [FacebookModule, QuizModule],
  controllers: [GreennController],
  providers: [GreennService],
})
export class GreennModule {}
