import { z } from 'zod';

/** Admin-editable platform settings (stored as one row per key in `Setting`). */
export const settingsSchema = z.object({
  instapayHandle: z.string().max(100).default('[PLACEHOLDER]@instapay'),
  instapayName: z.string().max(100).default('[PLACEHOLDER] Account holder name'),
  vodafoneCashNumber: z.string().max(30).default('[PLACEHOLDER] 010xxxxxxxx'),
  vodafoneCashName: z.string().max(100).default('[PLACEHOLDER] Wallet holder name'),
  supportEmail: z.string().email().default('academy@mlopsmena.com'),
  supportWhatsapp: z.string().max(30).default('[PLACEHOLDER] +20 1xx xxx xxxx'),
  /** Minutes before a session starts when the live link becomes visible. */
  liveLinkRevealMinutes: z.number().int().min(0).max(24 * 60).default(60),
  /** Payment screenshots and CVs older than this are deleted (records are kept). */
  screenshotRetentionDays: z.number().int().min(1).max(3650).default(180),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});
export const settingsUpdateSchema = settingsSchema.partial();
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
