import { Controller, Get, Header, HttpCode, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle, ThrottlerException } from '@nestjs/throttler';
import type { CalendarFeedDto } from '@academy/shared';
import type { Request, Response } from 'express';
import { sha256 } from '../common/crypto';
import { CurrentUser, Public, type AuthUser } from '../common/decorators';
import { CalendarFeedService, isFeedToken } from './calendar-feed.service';
import { WindowLimiter } from './window-limiter';

/**
 * Feed polls are limited per token, not per IP: Google, iCloud and Outlook.com
 * fetch every subscriber's feed from a few shared addresses. 20 a minute is far
 * above any real client. Only failures (malformed, unknown or revoked tokens)
 * count against the caller's IP, more strictly.
 */
export const FEED_POLLS_PER_MIN = 20;
export const FEED_MISSES_PER_MIN = 30;

@ApiTags('calendar')
@Controller()
export class CalendarFeedController {
  private readonly polls = new WindowLimiter(FEED_POLLS_PER_MIN, 60_000);
  private readonly misses = new WindowLimiter(FEED_MISSES_PER_MIN, 60_000);

  constructor(private readonly feeds: CalendarFeedService) {}

  /** Whether the student has a calendar link, and the link itself (it can be shown again). */
  @Get('me/calendar-feed')
  @Header('Cache-Control', 'private, no-store')
  status(@CurrentUser() user: AuthUser): Promise<CalendarFeedDto> {
    return this.feeds.status(user.id);
  }

  /** Creates the link (idempotent), or resets it with `?rotate=1`. */
  @Post('me/calendar-feed')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CurrentUser() user: AuthUser, @Query('rotate') rotate?: string): Promise<CalendarFeedDto> {
    return this.feeds.create(user.id, rotate === '1' || rotate === 'true');
  }

  /**
   * The subscription feed calendar apps poll (no cookies; the token is the credential).
   * Google and Apple refresh on their own schedule; 15 minutes of private caching keeps
   * repeated polls from one client cheap.
   */
  @Public()
  @Get('calendar/:file')
  @SkipThrottle()
  async feed(@Param('file') file: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const ipKey = `ip:${String(req.ip)}`;
    if (this.misses.exhausted(ipKey)) throw new ThrottlerException();
    const token = file.endsWith('.ics') ? file.slice(0, -4) : '';
    const miss = () => {
      this.misses.hit(ipKey);
      return new NotFoundException('Calendar not found');
    };
    if (!isFeedToken(token)) throw miss();
    if (!this.polls.hit(`feed:${sha256(token).slice(0, 16)}`)) throw new ThrottlerException();
    let body: string;
    try {
      body = await this.feeds.render(token);
    } catch (err) {
      throw err instanceof NotFoundException ? miss() : err;
    }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="mlops-mena-academy.ics"');
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(body);
  }
}
