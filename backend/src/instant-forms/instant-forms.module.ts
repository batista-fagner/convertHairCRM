import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../common/entities/lead.entity';
import { InstantFormsService } from './instant-forms.service';
import { InstantFormsController } from './instant-forms.controller';
import { FacebookModule } from '../facebook/facebook.module';

@Module({
  imports: [TypeOrmModule.forFeature([Lead]), FacebookModule],
  providers: [InstantFormsService],
  controllers: [InstantFormsController],
})
export class InstantFormsModule {}
