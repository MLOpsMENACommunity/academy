import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** The HTTP client the bot uses: `fetch`, replaced by a fake in tests (test/telegram.e2e-spec.ts). */
export const TELEGRAM_FETCH = Symbol('TELEGRAM_FETCH');
export type TelegramFetch = typeof fetch;

const API = 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;

/** Telegram answered `ok: false` (or not at all). The message is Telegram's description, never the URL (it holds the token). */
export class TelegramError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
  ) {
    super(`Telegram error ${code}: ${description}`);
  }
}

/** Telegram ids are at most 52 bits (Telegram's own guarantee), so a JS number holds them exactly. */
const id = (v: bigint | number): number => Number(v);

/**
 * The academy's Telegram bot (Bot API over HTTPS). On when both TELEGRAM_BOT_TOKEN and
 * TELEGRAM_WEBHOOK_SECRET are set; everything Telegram-related is hidden otherwise. Calls are
 * made outside database transactions and time out after 10 s.
 */
@Injectable()
export class TelegramApi {
  private readonly logger = new Logger(TelegramApi.name);
  private username: Promise<string | null> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(TELEGRAM_FETCH) private readonly fetcher: TelegramFetch,
  ) {}

  isEnabled(): boolean {
    return Boolean(this.env.TELEGRAM_BOT_TOKEN && this.env.TELEGRAM_WEBHOOK_SECRET);
  }

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.env.TELEGRAM_BOT_TOKEN) throw new TelegramError(0, 'not configured');
    let body: { ok?: boolean; result?: T; error_code?: number; description?: string };
    try {
      const res = await this.fetcher(`${API}/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      body = (await res.json()) as typeof body;
    } catch (err) {
      // A network failure or a timeout: the error's name only (a message could carry the URL).
      throw new TelegramError(0, (err as Error).name);
    }
    if (!body.ok) throw new TelegramError(body.error_code ?? 0, body.description ?? 'unknown');
    return body.result as T;
  }

  /** The bot's @username (from getMe, asked once and kept; asked again after a failure). */
  botUsername(): Promise<string | null> {
    if (!this.isEnabled()) return Promise.resolve(null);
    this.username ??= this.call<{ username?: string }>('getMe')
      .then((me) => me.username ?? null)
      .catch((err: unknown) => {
        this.logger.warn(`getMe failed: ${(err as TelegramError).description ?? (err as Error).name}`);
        this.username = null;
        return null;
      });
    return this.username;
  }

  async sendMessage(chatId: bigint | number, text: string): Promise<void> {
    await this.call('sendMessage', { chat_id: id(chatId), text, link_preview_options: { is_disabled: true } });
  }

  async approveJoinRequest(chatId: bigint | number, userId: bigint | number): Promise<void> {
    await this.call('approveChatJoinRequest', { chat_id: id(chatId), user_id: id(userId) });
  }

  /** A link whose joiners ask first (the bot approves enrolled students); returns the link. */
  async createJoinRequestLink(chatId: bigint | number, name: string): Promise<string> {
    const r = await this.call<{ invite_link: string }>('createChatInviteLink', { chat_id: id(chatId), name, creates_join_request: true });
    return r.invite_link;
  }

  async revokeInviteLink(chatId: bigint | number, link: string): Promise<void> {
    await this.call('revokeChatInviteLink', { chat_id: id(chatId), invite_link: link });
  }

  async setWebhook(url: string, allowedUpdates: readonly string[]): Promise<void> {
    await this.call('setWebhook', { url, secret_token: this.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: allowedUpdates });
  }
}
