import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthedRequest } from './decorators';

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
}
