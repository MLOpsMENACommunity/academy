/**
 * The Telegram updates the bot acts on, read defensively from the webhook's JSON: anything
 * unexpected becomes `ignored`, never an error (Telegram retries failed deliveries).
 */

export interface TelegramUser {
  id: number;
  username: string | null;
  languageCode: string | null;
}

export type TelegramUpdate =
  /** "/start <payload>" in a private chat with the bot (the deep link from Profile → Community). */
  | { kind: 'start'; chatId: number; from: TelegramUser; payload: string | null }
  /** Any other private message to the bot. */
  | { kind: 'private'; chatId: number; from: TelegramUser }
  /** The bot was added to a group, promoted, restricted or removed. */
  | { kind: 'botMember'; chat: { id: number; title: string }; isAdmin: boolean; canInvite: boolean }
  /** Someone asked to join a group through a join-request link; `userChatId` may be messaged for 5 minutes. */
  | { kind: 'joinRequest'; chatId: number; from: TelegramUser; userChatId: number }
  | { kind: 'ignored' };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function user(v: unknown): TelegramUser | null {
  const u = obj(v);
  const id = int(u?.id);
  if (!u || id === null || u.is_bot === true) return null;
  return { id, username: str(u.username), languageCode: str(u.language_code) };
}

const START = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/;

export function parseUpdate(raw: unknown): TelegramUpdate {
  const update = obj(raw);
  if (!update) return { kind: 'ignored' };

  const message = obj(update.message);
  if (message) {
    const chat = obj(message.chat);
    const from = user(message.from);
    const chatId = int(chat?.id);
    if (chat?.type !== 'private' || !from || chatId === null) return { kind: 'ignored' };
    const m = START.exec(str(message.text)?.trim() ?? '');
    return m ? { kind: 'start', chatId, from, payload: m[1] ?? null } : { kind: 'private', chatId, from };
  }

  const member = obj(update.my_chat_member);
  if (member) {
    const chat = obj(member.chat);
    const id = int(chat?.id);
    if (id === null || (chat?.type !== 'group' && chat?.type !== 'supergroup')) return { kind: 'ignored' };
    const now = obj(member.new_chat_member);
    const isAdmin = now?.status === 'administrator';
    return { kind: 'botMember', chat: { id, title: str(chat.title) ?? '' }, isAdmin, canInvite: isAdmin && now?.can_invite_users === true };
  }

  const request = obj(update.chat_join_request);
  if (request) {
    const chatId = int(obj(request.chat)?.id);
    const from = user(request.from);
    const userChatId = int(request.user_chat_id);
    if (chatId === null || !from || userChatId === null) return { kind: 'ignored' };
    return { kind: 'joinRequest', chatId, from, userChatId };
  }

  return { kind: 'ignored' };
}
