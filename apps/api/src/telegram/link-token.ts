import { createHmac, timingSafeEqual } from 'node:crypto';
import { TELEGRAM_LINK_TTL_MIN, TELEGRAM_START_PARAM_MAX } from '@academy/shared';

/**
 * The "Connect Telegram" token, carried in the bot's deep link (t.me/<bot>?start=<token>), so it
 * must fit Telegram's start parameter: at most 64 of [A-Za-z0-9_-]. It is the account id, the
 * expiry (Unix seconds, base 36) and a truncated HMAC (128 bits), joined by "_": neither the id
 * (a cuid) nor the expiry contain one, so the signature, which may, is simply the rest.
 */
const SIG_LENGTH = 22;
const TOKEN = /^([A-Za-z0-9]+)_([0-9a-z]+)_([\w-]{22})$/;

function sign(key: Buffer, userId: string, exp: string): string {
  return createHmac('sha256', key).update(`telegram-link:${userId}.${exp}`).digest('base64url').slice(0, SIG_LENGTH);
}

/** A token for `userId` that works for TELEGRAM_LINK_TTL_MIN minutes from `now`. */
export function signLinkToken(key: Buffer, userId: string, now = Date.now()): { token: string; expiresAt: Date } {
  if (!/^[A-Za-z0-9]+$/.test(userId)) throw new Error('Unexpected account id format');
  const expSec = Math.floor(now / 1000) + TELEGRAM_LINK_TTL_MIN * 60;
  const exp = expSec.toString(36);
  const token = `${userId}_${exp}_${sign(key, userId, exp)}`;
  if (token.length > TELEGRAM_START_PARAM_MAX) throw new Error('Account id too long for a Telegram link');
  return { token, expiresAt: new Date(expSec * 1000) };
}

/**
 * The account a token was made for and when it was made, or null when it is malformed, forged
 * or expired. The caller also refuses a token made before the account's last link, which makes
 * each token single-use.
 */
export function verifyLinkToken(key: Buffer, token: string, now = Date.now()): { userId: string; issuedAt: Date } | null {
  const m = TOKEN.exec(token);
  if (!m) return null;
  const [, userId, exp, sig] = m as unknown as [string, string, string, string];
  const expected = Buffer.from(sign(key, userId, exp));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expMs = parseInt(exp, 36) * 1000;
  if (!Number.isFinite(expMs) || expMs < now) return null;
  return { userId, issuedAt: new Date(expMs - TELEGRAM_LINK_TTL_MIN * 60_000) };
}
