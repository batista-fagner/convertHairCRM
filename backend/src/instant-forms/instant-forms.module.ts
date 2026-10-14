import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../common/entities/lead.entity';
import { InstantFormsService } from './instant-forms.service';
import { InstantFormsController } from './instant-forms.controller';
import { InstantFormLeadsController } from './instant-form-leads.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Lead])],
  providers: [InstantFormsService],
  controllers: [InstantFormsController, InstantFormLeadsController],
})
export class InstantFormsModule {}
