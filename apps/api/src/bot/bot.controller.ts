import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { botActivityQuerySchema, type BotActivityQuery, type BotActivityResponse } from '@academy/shared';
import { Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { BotTokenGuard } from './bot-token.guard';
import { BotService } from './bot.service';

/**
 * Read-only feed for the community bot. It runs outside Cloudflare, so unlike /api/internal/*
 * (which the Worker never forwards) this route is reachable, with its own secret. Public() only
 * skips the student session check; BotTokenGuard is what protects it. The default rate limit applies.
 */
@ApiExcludeController()
@Controller('bot/v1')
export class BotController {
  constructor(private readonly bot: BotService) {}

  @Public()
  @UseGuards(BotTokenGuard)
  @Get('activity')
  @Header('Cache-Control', 'no-store')
  activity(@Query(new ZodPipe(botActivityQuerySchema)) query: BotActivityQuery): Promise<BotActivityResponse> {
    return this.bot.activity(query);
  }
}
