import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quiz } from '../common/entities/quiz.entity';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { FacebookModule } from '../facebook/facebook.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [TypeOrmModule.forFeature([Quiz]), FacebookModule, TrackingModule],
  providers: [QuizService],
  controllers: [QuizController],
  exports: [QuizService],
})
export class QuizModule {}
