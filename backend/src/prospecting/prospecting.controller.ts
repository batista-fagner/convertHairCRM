import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ProspectingService } from './prospecting.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Controller('prospecting')
@UseGuards(ApiKeyGuard)
export class ProspectingController {
  constructor(
    private readonly prospecting: ProspectingService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Post('prospects')
  async createProspect(
    @Body() body: { username: string; fullName?: string; message: string; sentAt: string; seedUsername?: string },
  ) {
    if (!body?.username || !body?.message || !body?.sentAt) {
      throw new HttpException('username, message e sentAt são obrigatórios', HttpStatus.BAD_REQUEST);
    }
    const prospect = await this.prospecting.create(body);
    this.realtime.emitProspectCreated(prospect);
    return prospect;
  }

  @Get('prospects')
  async listProspects(@Query('responded') responded?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const filters: { responded?: boolean; from?: string; to?: string } = {};
    if (responded === 'true') filters.responded = true;
    if (responded === 'false') filters.responded = false;
    if (from) filters.from = from;
    if (to) filters.to = to;
    return this.prospecting.list(filters);
  }

  @Patch('prospects/:id/respond')
  async markResponded(@Param('id') id: string, @Body() body: { responded: boolean }) {
    const prospect = await this.prospecting.markResponded(id, !!body.responded);
    this.realtime.emitProspectUpdated(prospect);
    return prospect;
  }

  @Get('current-seed')
  async getCurrentSeed() {
    const username = await this.prospecting.getCurrentSeed();
    return { username };
  }

  @Post('current-seed')
  async setCurrentSeed(@Body() body: { username: string }) {
    if (!body?.username) {
      throw new HttpException('username é obrigatório', HttpStatus.BAD_REQUEST);
    }
    await this.prospecting.setCurrentSeed(body.username.trim());
    this.realtime.emitProspectSeedChanged(body.username.trim());
    return { username: body.username.trim() };
  }

  @Post('generate-message')
  async generateMessage(@Body() body: { username: string; fullName?: string }) {
    if (!body?.username) {
      throw new HttpException('username é obrigatório', HttpStatus.BAD_REQUEST);
    }
    const message = await this.prospecting.resolveMessage(body.username, body.fullName);
    return { message };
  }

  @Get('message-config')
  async getMessageConfig() {
    return this.prospecting.getMessageConfig();
  }

  @Patch('message-config')
  async setMessageConfig(@Body() body: { mode?: 'ai' | 'fixed'; fixedMessage?: string; aiPrompt?: string }) {
    return this.prospecting.setMessageConfig(body);
  }
}
