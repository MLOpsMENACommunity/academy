import { Inject, Injectable } from '@nestjs/common';
import type { Locale } from '@academy/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** What an unsubscribe link turns off, for one course: feedback emails or course reminders. */
export type OptOutKind = 'feedback' | 'reminders';
const KIND_CODE: Record<OptOutKind, string> = { feedback: 'f', reminders: 'r' };
const CODE_KIND: Record<string, OptOutKind> = { f: 'feedback', r: 'reminders' };

/**
 * Signed one-click unsubscribe links: `<kind>.<userId>.<courseId>.<HMAC>`. They work without
 * signing in and never expire, so the link in an old email keeps working. The key is
 * derived from the server secret for this purpose only (like waitlist leave links).
 */
@Injectable()
export class EmailPreferenceLinks {
  private readonly key: Buffer;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = createHmac('sha256', env.JWT_ACCESS_SECRET).update('email-opt-out-v1').digest();
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }

  token(kind: OptOutKind, userId: string, courseId: string): string {
    const payload = `${KIND_CODE[kind]}.${userId}.${courseId}`;
    return `${payload}.${this.sign(payload)}`;
  }

  verify(token: string): { kind: OptOutKind; userId: string; courseId: string } | null {
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [code, userId, courseId, sig] = parts as [string, string, string, string];
    const kind = CODE_KIND[code];
    if (!kind || !userId || !courseId || !sig) return null;
    const expected = Buffer.from(this.sign(`${code}.${userId}.${courseId}`));
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected) ? { kind, userId, courseId } : null;
  }

  /** The page in the email footer: says what it turns off and takes a click. */
  pageUrl(locale: Locale, kind: OptOutKind, userId: string, courseId: string): string {
    return `${this.env.WEB_URL}/${locale}/unsubscribe?token=${encodeURIComponent(this.token(kind, userId, courseId))}`;
  }

  /**
   * RFC 8058 one-click headers: mail apps show "Unsubscribe" and POST to the URL
   * (body "List-Unsubscribe=One-Click"); the API endpoint takes the token from the query.
   */
  headers(kind: OptOutKind, userId: string, courseId: string): Record<string, string> {
    const url = `${this.env.WEB_URL}/api/email/unsubscribe?token=${encodeURIComponent(this.token(kind, userId, courseId))}`;
    return { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  }
}
