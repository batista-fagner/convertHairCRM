import { Controller, Get } from '@nestjs/common';
import { SdrFollowupService } from './sdr-followup.service';

@Controller('followup')
export class FollowupController {
  constructor(private readonly followupService: SdrFollowupService) {}

  @Get('status')
  async status() {
    return this.followupService.getStatus();
  }
}
