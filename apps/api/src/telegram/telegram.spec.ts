import { createHmac } from 'node:crypto';
import { TELEGRAM_LINK_TTL_MIN, TELEGRAM_START_PARAM_MAX } from '@academy/shared';
import { signLinkToken, verifyLinkToken } from './link-token';
import { parseUpdate } from './updates';

const key = createHmac('sha256', 'test-secret').update('telegram-link-v1').digest();
const NOW = Date.parse('2026-11-10T10:00:00Z');
const USER = 'cmh2x0q1k0000abcd1234efgh';

describe('Telegram connect token', () => {
  it('fits a Telegram start parameter and names the account', () => {
    const { token, expiresAt } = signLinkToken(key, USER, NOW);
    expect(token.length).toBeLessThanOrEqual(TELEGRAM_START_PARAM_MAX);
    expect(token).toMatch(/^[\w-]+$/);
    expect(expiresAt.getTime()).toBe(NOW + TELEGRAM_LINK_TTL_MIN * 60_000);
    expect(verifyLinkToken(key, token, NOW)).toEqual({ userId: USER, issuedAt: new Date(NOW) });
  });

  it('works for 15 minutes', () => {
    const { token } = signLinkToken(key, USER, NOW);
    expect(verifyLinkToken(key, token, NOW + 15 * 60_000)).not.toBeNull();
    expect(verifyLinkToken(key, token, NOW + 15 * 60_000 + 1_000)).toBeNull();
  });

  it('refuses forged, altered and malformed tokens', () => {
    const { token } = signLinkToken(key, USER, NOW);
    const other = createHmac('sha256', 'another-secret').update('telegram-link-v1').digest();
    expect(verifyLinkToken(other, token, NOW)).toBeNull();
    // Someone else's id with this signature.
    expect(verifyLinkToken(key, token.replace(USER, 'cmh2x0q1k0000abcd1234zzzz'), NOW)).toBeNull();
    // A later expiry with this signature.
    const [id, , sig] = token.split('_');
    expect(verifyLinkToken(key, `${id}_${(Math.floor(NOW / 1000) + 86_400).toString(36)}_${token.slice(token.length - 22)}`, NOW)).toBeNull();
    for (const bad of ['', 'abc', `${USER}_x`, `${USER}__${sig}`, token + 'a', token.slice(0, -1)]) expect(verifyLinkToken(key, bad, NOW)).toBeNull();
  });

  it('refuses account ids that could break the format', () => {
    expect(() => signLinkToken(key, 'a_b', NOW)).toThrow();
    expect(() => signLinkToken(key, 'x'.repeat(40), NOW)).toThrow();
  });
});

describe('Telegram updates', () => {
  const from = { id: 42, is_bot: false, first_name: 'Layla', username: 'layla_ml', language_code: 'ar' };

  it('reads /start with and without a token in a private chat', () => {
    expect(parseUpdate({ update_id: 1, message: { chat: { id: 42, type: 'private' }, from, text: '/start abc_DEF-1' } })).toEqual({
      kind: 'start',
      chatId: 42,
      from: { id: 42, username: 'layla_ml', languageCode: 'ar' },
      payload: 'abc_DEF-1',
    });
    expect(parseUpdate({ message: { chat: { id: 42, type: 'private' }, from, text: '/start' } })).toMatchObject({ kind: 'start', payload: null });
    expect(parseUpdate({ message: { chat: { id: 42, type: 'private' }, from, text: 'hello' } })).toMatchObject({ kind: 'private', chatId: 42 });
  });

  it('ignores group messages, bots and messages without a sender', () => {
    expect(parseUpdate({ message: { chat: { id: -100, type: 'supergroup' }, from, text: '/start x' } })).toEqual({ kind: 'ignored' });
    expect(parseUpdate({ message: { chat: { id: 7, type: 'private' }, from: { ...from, is_bot: true }, text: '/start x' } })).toEqual({ kind: 'ignored' });
    expect(parseUpdate({ message: { chat: { id: 7, type: 'private' }, text: '/start x' } })).toEqual({ kind: 'ignored' });
  });

  it('reads the bot being made an admin of a group, and losing it', () => {
    const chat = { id: -1001234567890, type: 'supergroup', title: 'MLOps 101' };
    expect(parseUpdate({ my_chat_member: { chat, new_chat_member: { status: 'administrator', can_invite_users: true } } })).toEqual({
      kind: 'botMember',
      chat: { id: -1001234567890, title: 'MLOps 101' },
      isAdmin: true,
      canInvite: true,
    });
    expect(parseUpdate({ my_chat_member: { chat, new_chat_member: { status: 'administrator', can_invite_users: false } } })).toMatchObject({ isAdmin: true, canInvite: false });
    expect(parseUpdate({ my_chat_member: { chat, new_chat_member: { status: 'left' } } })).toMatchObject({ isAdmin: false, canInvite: false });
    // Private chats (someone blocking the bot) and channels are not groups.
    expect(parseUpdate({ my_chat_member: { chat: { id: 42, type: 'private' }, new_chat_member: { status: 'kicked' } } })).toEqual({ kind: 'ignored' });
    expect(parseUpdate({ my_chat_member: { chat: { id: -100, type: 'channel' }, new_chat_member: { status: 'administrator' } } })).toEqual({ kind: 'ignored' });
  });

  it('reads a join request', () => {
    expect(parseUpdate({ chat_join_request: { chat: { id: -100555, type: 'supergroup' }, from, user_chat_id: 42, date: 1 } })).toEqual({
      kind: 'joinRequest',
      chatId: -100555,
      from: { id: 42, username: 'layla_ml', languageCode: 'ar' },
      userChatId: 42,
    });
    expect(parseUpdate({ chat_join_request: { chat: { id: -100555 }, from } })).toEqual({ kind: 'ignored' });
  });

  it('never throws on anything else', () => {
    for (const raw of [null, undefined, 1, 'x', [], {}, { edited_message: {} }, { message: 'x' }, { message: { chat: { id: '42', type: 'private' }, from } }]) {
      expect(parseUpdate(raw)).toEqual({ kind: 'ignored' });
    }
  });
});
