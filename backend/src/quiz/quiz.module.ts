import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Quiz } from '../common/entities/quiz.entity';
import { QuizSubmission } from '../common/entities/quiz-submission.entity';
import { QuizProgress } from '../common/entities/quiz-progress.entity';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { FacebookModule } from '../facebook/facebook.module';
import { TrackingModule } from '../tracking/tracking.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { Lead } from '../common/entities/lead.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Quiz, QuizSubmission, QuizProgress, Lead]), FacebookModule, TrackingModule, HttpModule, RealtimeModule],
  providers: [QuizService],
  controllers: [QuizController],
  exports: [QuizService],
})
export class QuizModule {}
