import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Inject, NotFoundException, Param, Post, Put, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import {
  courseTelegramGroupSchema,
  type AdminCourseTelegramDto,
  type CourseTelegramGroupInput,
  type LearnTelegramDto,
  type TelegramLinkDto,
  type TelegramStatusDto,
} from '@academy/shared';
import { AdminCan, CurrentUser, Public, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { TelegramService } from './telegram.service';

/**
 * Telegram's webhook. Not a browser endpoint: Telegram sends no Origin or Sec-Fetch-Site, so the
 * CSRF check lets it through, and like the jobs tick it is unthrottled behind a constant-time
 * secret (Telegram's servers share a few IPs). 404 when the bot isn't configured, 401 for a wrong
 * secret, otherwise always 200, whatever the update: Telegram retries anything else.
 */
@ApiTags('telegram')
@Controller('telegram')
export class TelegramWebhookController {
  constructor(
    private readonly telegram: TelegramService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() body: unknown): Promise<{ ok: true }> {
    const expected = this.env.TELEGRAM_BOT_TOKEN && this.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected) throw new NotFoundException();
    const a = Buffer.from(secret ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    await this.telegram.handle(body);
    return { ok: true };
  }
}

/** Profile → Community: connect and disconnect the student's Telegram account. */
@ApiTags('telegram')
@Controller('me/telegram')
export class MeTelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  status(@CurrentUser() user: AuthUser): Promise<TelegramStatusDto> {
    return this.telegram.status(user.id);
  }

  @Post('link')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  link(@CurrentUser() user: AuthUser): Promise<TelegramLinkDto> {
    return this.telegram.linkUrl(user.id);
  }

  @Delete()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  unlink(@CurrentUser() user: AuthUser): Promise<TelegramStatusDto> {
    return this.telegram.unlink(user.id);
  }
}

/** The learn page's "Join the course Telegram group" block. */
@ApiTags('telegram')
@Controller('learn')
export class LearnTelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get(':slug/telegram')
  @Header('Cache-Control', 'private, no-store')
  group(@CurrentUser() user: AuthUser, @Param('slug') slug: string): Promise<LearnTelegramDto> {
    return this.telegram.learn(user, slug);
  }
}

/** Admin → Courses → course → Details → Telegram group (ACADEMIC, like the rest of the course settings). */
@ApiTags('telegram')
@Roles('ADMIN')
@Controller('admin/courses')
export class AdminTelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @AdminCan('ACADEMIC')
  @Get(':id/telegram')
  get(@Param('id') id: string): Promise<AdminCourseTelegramDto> {
    return this.telegram.courseGroup(id);
  }

  @AdminCan('ACADEMIC')
  @Put(':id/telegram')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  set(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(courseTelegramGroupSchema)) body: CourseTelegramGroupInput,
  ): Promise<AdminCourseTelegramDto> {
    return this.telegram.setCourseGroup(id, body.chatId, user);
  }
}
