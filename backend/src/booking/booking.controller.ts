import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
import { BookingService } from './booking.service';

// Rotas públicas: chamadas pela página de agendamento do ConvertHairPage.
@Controller('booking')
export class BookingController {
  constructor(private readonly booking: BookingService) {}

  @Public()
  @Get('slots')
  slots() {
    return this.booking.slots();
  }

  @Public()
  @Get('current')
  current(@Query('leadId') leadId: string) {
    return this.booking.current(leadId);
  }

  @Public()
  @Post()
  book(@Body() body: { leadId?: string; name?: string; phone?: string; at?: string }) {
    return this.booking.book(body || {});
  }
}
