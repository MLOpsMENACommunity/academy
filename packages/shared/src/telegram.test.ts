import { describe, expect, it } from 'vitest';
import { courseTelegramGroupSchema, TELEGRAM_INVITE_NAME_MAX, telegramInviteName } from './telegram';

describe('Telegram course groups', () => {
  it('names the invite link after the slug, within Telegram’s 32 characters', () => {
    expect(telegramInviteName('mlops-101')).toBe('mlops-101');
    expect(telegramInviteName('a'.repeat(40))).toHaveLength(TELEGRAM_INVITE_NAME_MAX);
  });

  it('takes a group id as a decimal string, or null to clear it', () => {
    expect(courseTelegramGroupSchema.parse({ chatId: '-1001234567890' })).toEqual({ chatId: '-1001234567890' });
    expect(courseTelegramGroupSchema.parse({ chatId: null })).toEqual({ chatId: null });
    for (const bad of ['', 'abc', '12.5', '1e9', '-', '1'.repeat(21)]) expect(courseTelegramGroupSchema.safeParse({ chatId: bad }).success).toBe(false);
  });
});
