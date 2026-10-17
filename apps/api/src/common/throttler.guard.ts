import { Injectable, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import type { AuthedRequest } from './decorators';

const SKIP_THROTTLE_WITHOUT = 'academy:skipThrottleWithout';

/**
 * Test stacks only (docker compose for the browser tests): every limit is multiplied by this,
 * because one suite signs up and logs in far more often from one IP than any real visitor.
 * Validated in config/env.ts (1-100, default 1). The Cloudflare Worker passes the API an
 * explicit list of variables that doesn't include it, so production always runs at 1.
 */
const LIMIT_MULTIPLIER = Math.min(100, Math.max(1, Math.trunc(Number(process.env.THROTTLE_LIMIT_MULTIPLIER ?? 1)) || 1));

/**
 * Unthrottled unless the request has this query parameter. For public reads that the web
 * server makes for every visitor from one IP (never with the parameter), but that browsers
 * may also call with it (e.g. a text search): those calls are throttled per IP as usual.
 */
export const SkipThrottleWithoutQuery = (param: string) => SetMetadata(SKIP_THROTTLE_WITHOUT, param);

/**
 * Signed-in users are limited per account, everyone else per IP. Many students
 * share one carrier-grade NAT address on mobile data, so per-IP limits alone
 * would throttle a whole classroom. Runs after AuthGuard (see AppModule), so
 * `req.user` is already set for valid sessions.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = (req as unknown as AuthedRequest).user;
    return user ? `user:${user.id}` : `ip:${String(req.ip)}`;
  }

  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    return super.handleRequest(LIMIT_MULTIPLIER === 1 ? props : { ...props, limit: props.limit * LIMIT_MULTIPLIER });
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const param = this.reflector.getAllAndOverride<string | undefined>(SKIP_THROTTLE_WITHOUT, [context.getHandler(), context.getClass()]);
    if (param) {
      const query = (context.switchToHttp().getRequest<{ query?: Record<string, unknown> }>().query ?? {}) as Record<string, unknown>;
      if (!query[param]) return true;
    }
    return super.shouldSkip(context);
  }
}
