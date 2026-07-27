import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InstagramAutomationService } from './instagram-automation.service';
import type { IgConversationFilter } from './instagram-automation.service';

@Controller('ig-auto')
export class InstagramAutomationController {
  constructor(
    private service: InstagramAutomationService,
    private config: ConfigService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get(':id/profiles')
  getProfiles(@Param('id') id: string) {
    return this.service.findConversations(id);
  }

  @Get('media')
  getMedia(@Query('after') after?: string) {
    return this.service.getRecentMedia(after);
  }

  // ─── IA catch-all: DM direta sem vir de comentário/automação ────────────────

  @Get('catchall')
  getCatchall() {
    return this.service.getCatchallConfig();
  }

  @Put('catchall')
  setCatchall(@Body() body: { enabled?: boolean; prompt?: string; link?: string; buttonLabel?: string }) {
    return this.service.setCatchallConfig(body);
  }

  @Post('subscribe')
  subscribeWebhook() {
    return this.service.subscribeWebhook();
  }

  @Get('webhook')
  verifyWebhook(@Query() query: any, @Res() res: any) {
    const verifyToken = this.config.get('IG_WEBHOOK_VERIFY_TOKEN');
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
      return res.status(200).send(query['hub.challenge']);
    }
    return res.status(403).send('Forbidden');
  }

  @Post('webhook')
  handleWebhook(@Body() body: any) {
    this.service.handleWebhookEvent(body).catch(() => {});
    return { status: 'ok' };
  }

  // ─── Inbox de DM (mirror do /sms) ────────────────────────────────────────────

  @Get('stats')
  getStats() {
    return this.service.getStats();
  }

  @Get('conversations')
  listConversations(
    @Query('search') search?: string,
    @Query('filter') filter?: IgConversationFilter,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listConversations({
      search: search?.trim() || undefined,
      filter: filter || 'all',
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 30,
    });
  }

  @Get('conversations/:id')
  getConversation(@Param('id') id: string) {
    return this.service.getConversation(id);
  }

  @Get('conversations/:id/messages')
  async listMessages(@Param('id') id: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    await this.service.getConversation(id); // 404 se não existir
    return this.service.listMessages(id, { before, limit: limit ? parseInt(limit, 10) : 50 });
  }

  @Get('conversations/:id/comment-events')
  listCommentEvents(@Param('id') id: string) {
    return this.service.listCommentEvents(id);
  }

  @Post('conversations/:id/messages')
  async sendMessage(@Param('id') id: string, @Body() body: { text?: string }) {
    const text = (body?.text ?? '').trim();
    if (!text) throw new HttpException('Texto é obrigatório', HttpStatus.BAD_REQUEST);
    return this.service.sendOperatorMessage(id, text);
  }

  @Patch('conversations/:id/read')
  markRead(@Param('id') id: string) {
    return this.service.markRead(id);
  }

  @Patch('conversations/:id/ai')
  toggleAi(@Param('id') id: string, @Body() body: { paused?: boolean }) {
    if (typeof body?.paused !== 'boolean') {
      throw new HttpException('Campo "paused" (boolean) é obrigatório', HttpStatus.BAD_REQUEST);
    }
    return this.service.setAiPaused(id, body.paused);
  }

  @Post('conversations/:id/reset')
  resetContext(@Param('id') id: string) {
    return this.service.resetContext(id);
  }
}
