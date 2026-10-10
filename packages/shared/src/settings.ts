import { z } from 'zod';

export const DEFAULT_SESSION_TEAM_EMAILS = [
  'aya@mlopsmena.com',
  'mariam@mlopsmena.com',
  'omarkhalil@mlopsmena.com',
  'mahmoud@mlopsmena.com',
] as const;
export const SESSION_TEAM_EMAILS_MAX = 20;

/** The session team's addresses: valid, lowercased, no duplicates, at most 20. */
export const sessionTeamEmailsSchema = z
  .array(z.string().trim().toLowerCase().email('Enter a valid email address').max(254))
  .max(SESSION_TEAM_EMAILS_MAX, `At most ${SESSION_TEAM_EMAILS_MAX} addresses`)
  .refine((list) => new Set(list).size === list.length, 'Each address can be listed once');

/** Admin-editable platform settings (stored as one row per key in `Setting`). */
export const settingsSchema = z.object({
  /** Empty = not offered. A payment method is shown to students only once its details are set. */
  instapayHandle: z.string().trim().max(100).default(''),
  instapayName: z.string().trim().max(100).default(''),
  vodafoneCashNumber: z.string().trim().max(30).default(''),
  vodafoneCashName: z.string().trim().max(100).default(''),
  /**
   * The one human contact address, shown on the contact and policy pages and in payment help.
   * Empty = not shown (pages point to the community channels instead). Must be a real,
   * monitored inbox.
   */
  supportEmail: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(254)]).default(''),
  /** WhatsApp number for payment questions, e.g. +201001234567. Empty = not shown. */
  supportWhatsapp: z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9 ()-]{7,24}$/, 'Use an international number, e.g. +20 100 123 4567')]).default(''),
  /** Minutes before a session starts when the live link becomes visible. */
  liveLinkRevealMinutes: z.number().int().min(0).max(24 * 60).default(60),
  /** Payment screenshots and CVs older than this are deleted (records are kept). */
  screenshotRetentionDays: z.number().int().min(1).max(3650).default(180),
  /**
   * Who hears about speaker bookings and cancellations (one email each). Admin only:
   * never part of the public settings.
   */
  sessionTeamEmails: sessionTeamEmailsSchema.default([...DEFAULT_SESSION_TEAM_EMAILS]),
  /** How many upcoming booked slots one speaker can hold at a time. */
  speakerMaxOpenBookings: z.number().int().min(1).max(10).default(2),
  /** Speakers can cancel a booking until this many days before it starts. */
  speakerCancelDays: z.number().int().min(0).max(60).default(3),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});
export const settingsUpdateSchema = settingsSchema.partial();
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

/**
 * Values that must never reach a page: empty, an old "[PLACEHOLDER]" default, or an
 * academy address known to have no inbox (older defaults; a saved settings form may
 * still hold them).
 */
const DEAD_EMAILS = ['academy@mlopsmena.com', 'admin@mlopsmena.com'];
export function realValue(v: string | null | undefined): string {
  const s = (v ?? '').trim();
  if (!s || s.includes('[PLACEHOLDER]') || DEAD_EMAILS.includes(s.toLowerCase())) return '';
  return s;
}

/** The public support contacts, with unset or placeholder values removed. */
export interface PublicContactDto {
  supportEmail: string;
  supportWhatsapp: string;
}
export function publicContact(s: Pick<Settings, 'supportEmail' | 'supportWhatsapp'>): PublicContactDto {
  return { supportEmail: realValue(s.supportEmail), supportWhatsapp: realValue(s.supportWhatsapp) };
}

/** wa.me link for a WhatsApp number in any common format. */
export function whatsappUrl(number: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}`;
}
