import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** The community bot's shared secret. A guard, so it runs before the query is even validated. */
@Injectable()
export class BotTokenGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.env.BOT_API_TOKEN) throw new NotFoundException();
    const given = context.switchToHttp().getRequest<Request>().header('x-bot-token');
    const a = Buffer.from(given ?? '');
    const b = Buffer.from(this.env.BOT_API_TOKEN);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}
