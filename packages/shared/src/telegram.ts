import { z } from 'zod';

/**
 * Telegram course groups: students connect their Telegram account through the academy's bot
 * (Profile → Community), and the bot lets enrolled students into their course's group through a
 * join-request link. Nobody is ever removed or declined automatically.
 */

/** How long a "Connect Telegram" link works. */
export const TELEGRAM_LINK_TTL_MIN = 15;
/** Telegram's limit for a deep-link start parameter (letters, digits, _ and -). */
export const TELEGRAM_START_PARAM_MAX = 64;
/** Telegram's limit for an invite link's name. */
export const TELEGRAM_INVITE_NAME_MAX = 32;
/** The updates the webhook asks Telegram for. */
export const TELEGRAM_ALLOWED_UPDATES = ['message', 'my_chat_member', 'chat_join_request'] as const;
/** Where students connect their Telegram account (the bot's messages link here). */
export const TELEGRAM_CONNECT_PATH = '/profile?tab=community';

/** The name of a course's invite link (shown to the group's admins in Telegram): the slug, cut to fit. */
export function telegramInviteName(slug: string): string {
  return slug.slice(0, TELEGRAM_INVITE_NAME_MAX);
}

/** Telegram chat and user ids travel as decimal strings (they can exceed 2^53 in principle, and JSON has no BigInt). */
export const telegramIdSchema = z.string().regex(/^-?\d{1,20}$/, 'Invalid Telegram id');

/** Admin → course → Details → Telegram group: pick a group, or null to clear it. */
export const courseTelegramGroupSchema = z.object({ chatId: telegramIdSchema.nullable() });
export type CourseTelegramGroupInput = z.infer<typeof courseTelegramGroupSchema>;

/** GET /api/me/telegram: whether the feature is on and the student's connection. */
export interface TelegramStatusDto {
  /** False when the academy has no bot configured: every Telegram block is hidden. */
  enabled: boolean;
  botUsername: string | null;
  linked: boolean;
  linkedAt: string | null;
}

/** POST /api/me/telegram/link: open this to connect (https://t.me/<bot>?start=<token>). */
export interface TelegramLinkDto {
  url: string;
  expiresAt: string;
}

/** GET /api/learn/:slug/telegram: the learn page's "Join the course Telegram group" block. */
export interface LearnTelegramDto {
  enabled: boolean;
  /** The course has a group and the viewer is enrolled. */
  hasGroup: boolean;
  linked: boolean;
  /** Only for enrolled students of a course with a group. */
  inviteLink: string | null;
}

export interface TelegramChatDto {
  id: string;
  title: string;
}

/** GET /api/admin/courses/:id/telegram (ACADEMIC). */
export interface AdminCourseTelegramDto {
  enabled: boolean;
  botUsername: string | null;
  /** The course's group, if one is picked. */
  chat: TelegramChatDto | null;
  inviteLink: string | null;
  /** Groups where the bot is an admin that may invite users: the ones that can be picked. */
  chats: TelegramChatDto[];
}
