import { Inject, Injectable } from '@nestjs/common';
import type { Locale } from '@academy/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from '../email/email.service';

/**
 * Signed "leave the waiting list" links: `<entry id>.<HMAC>`. No account or expiry
 * needed, so the link in an old email keeps working. The key is derived from the
 * server secret for this purpose only, so these can never be used as session tokens.
 */
@Injectable()
export class WaitlistLinks {
  private readonly key: Buffer;

  constructor(
    private readonly email: EmailService,
    @Inject(ENV) env: Env,
  ) {
    this.key = createHmac('sha256', env.JWT_ACCESS_SECRET).update('waitlist-leave-v1').digest();
  }

  private sign(id: string): string {
    return createHmac('sha256', this.key).update(id).digest('base64url');
  }

  token(id: string): string {
    return `${id}.${this.sign(id)}`;
  }

  /** The entry id from a valid token, or null. */
  verify(token: string): string | null {
    const [id, sig, extra] = token.split('.');
    if (!id || !sig || extra !== undefined) return null;
    const expected = Buffer.from(this.sign(id));
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
  }

  leaveUrl(locale: Locale, id: string): string {
    return this.email.url(locale, `/waitlist/leave?token=${encodeURIComponent(this.token(id))}`);
  }
}
