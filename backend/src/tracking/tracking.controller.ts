import { Controller, Post, Body } from '@nestjs/common';
import { TrackingService } from './tracking.service';

@Controller('track')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post('click')
  async registerClick(@Body() body: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    fbclid?: string;
    fbc?: string;
    fbp?: string;
    clickId?: string;
  }) {
    await this.trackingService.registerClick(body);
    return { ok: true };
  }
}
