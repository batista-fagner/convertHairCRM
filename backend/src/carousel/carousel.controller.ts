import { Controller, Get, Post, Patch, Delete, Param, Body, HttpCode } from '@nestjs/common';
import { CarouselService } from './carousel.service';
import { SlideData } from './carousel.entity';

@Controller('carousel')
export class CarouselController {
  constructor(private readonly service: CarouselService) {}

  // Antes de :id — senão "options" cai na rota de detalhe e vira "não encontrado".
  @Get('options')
  options() {
    return this.service.listOptions();
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body()
    body: {
      topic: string;
      angle: string;
      tone: string;
      audience?: string;
      slideCount: number;
      instagramHandle?: string;
    },
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { slides?: SlideData[]; caption?: string }) {
    return this.service.update(id, body);
  }

  @Post(':id/regenerate/:slideIndex')
  regenerateSlide(@Param('id') id: string, @Param('slideIndex') slideIndex: string) {
    return this.service.regenerateSlide(id, Number(slideIndex));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
