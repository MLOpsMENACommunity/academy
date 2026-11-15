import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe on bulk mail. */
  headers?: Record<string, string>;
}

/** Per-send options a provider may honour. */
export interface SendOptions {
  /**
   * The provider sends at most one email per key (Resend keeps keys for 24 hours), so a
   * retry after a crash can't send the same outbox row twice. SMTP and log ignore it.
   */
  idempotencyKey?: string;
}

/** What a failed send means for the next try (see OutboxProcessor). */
export type SendErrorKind = 'retryable' | 'permanent' | 'quota';

/** A provider rejection with enough detail to decide whether to retry (no addresses in it). */
export class EmailSendError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode?: number,
  ) {
    super(`Email provider error: ${code}${statusCode ? ` (${statusCode})` : ''}`);
    this.name = 'EmailSendError';
  }

  /** Too many requests right now: worth retrying shortly. A daily quota is not. */
  get retryable(): boolean {
    return this.statusCode === 429 && !isQuotaCode(this.code);
  }
}

function isQuotaCode(code: string): boolean {
  return code === 'daily_quota_exceeded' || code === 'monthly_quota_exceeded';
}

/**
 * Sorts a send failure into what to do next:
 * - quota: the provider's daily (or monthly) limit; try again tomorrow, it isn't the email's fault.
 * - permanent: the provider rejected this email (invalid address, validation, a 5xx SMTP reply);
 *   retrying sends the same bad request again.
 * - retryable: rate limits, provider outages, network errors and anything unrecognised.
 */
export function classifySendError(err: unknown): SendErrorKind {
  if (err instanceof EmailSendError) {
    if (isQuotaCode(err.code)) return 'quota';
    // 429: rate limited. 409: the same idempotency key is still being processed.
    if (err.statusCode === 429 || err.statusCode === 409) return 'retryable';
    if (err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500) return 'permanent';
    return 'retryable';
  }
  // nodemailer: responseCode is the SMTP reply (5xx = permanent rejection, 4xx = try later).
  const smtp = (err as { responseCode?: number } | null)?.responseCode;
  if (typeof smtp === 'number' && smtp >= 500) return 'permanent';
  return 'retryable';
}

/**
 * Delivery adapter. Swapping provider (e.g. to Amazon SES) means adding one
 * class here and one case in email.module.ts; nothing else changes.
 */
export abstract class EmailTransport {
  abstract send(message: EmailMessage, options?: SendOptions): Promise<void>;
}

export class SmtpTransport extends EmailTransport {
  private readonly transporter: Transporter;

  constructor(
    host: string,
    port: number,
    private readonly from: string,
  ) {
    super();
    this.transporter = nodemailer.createTransport({ host, port, secure: false });
  }

  async send(m: EmailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers });
  }
}

export class ResendTransport extends EmailTransport {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    super();
    this.client = new Resend(apiKey);
  }

  async send(m: EmailMessage, options: SendOptions = {}): Promise<void> {
    const { error } = await this.client.emails.send(
      {
        from: this.from,
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
        ...(m.headers ? { headers: m.headers } : {}),
      },
      options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
    );
    if (error) throw new EmailSendError(error.name, (error as { statusCode?: number }).statusCode ?? undefined);
  }
}

/** Splits "Name <address>" (EMAIL_FROM) into its parts; a bare address has no name. */
export function parseFrom(from: string): { address: string; name?: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!m) return { address: from.trim() };
  const name = m[1]!.replace(/^"|"$/g, '').trim();
  return name ? { address: m[2]!.trim(), name } : { address: m[2]!.trim() };
}

/** Cloudflare API error codes (email/sending/send) that mean "this account can't send right now". */
const CLOUDFLARE_PAUSED = new Set([10105, 10203, 10207]);

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Cloudflare Email Service (Email Sending), through its REST API: one POST per email, no SDK.
 * Needs the sending domain onboarded in the account (DEPLOY.md, "Email") and an account API
 * token with Email Sending: Edit. Cloudflare has no idempotency keys, so a crash between the
 * send and the outbox update can send a row twice (the outbox's lease keeps that rare).
 *
 * Errors become EmailSendError so the outbox decides as it does for Resend:
 *   - the daily quota of a new account ("daily" in the message) waits for tomorrow,
 *   - 429 (10004, throttled) is retried shortly,
 *   - sending disabled or the account paused (10105, 10203, 10207) is retried later: it isn't
 *     the email's fault, and failing every queued row for it would lose them,
 *   - other 4xx (an invalid or suppressed address, a rejected header) and a permanent bounce
 *     reported in the response fail that one email.
 */
export class CloudflareTransport extends EmailTransport {
  private readonly url: string;
  private readonly from: { address: string; name?: string };

  constructor(
    accountId: string,
    private readonly apiToken: string,
    from: string,
    private readonly fetchFn: Fetch = (url, init) => fetch(url, init),
  ) {
    super();
    this.url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`;
    this.from = parseFrom(from);
  }

  async send(m: EmailMessage): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: this.from,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          text: m.text,
          ...(m.headers ? { headers: m.headers } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new EmailSendError(`network_${(err as Error).name}`);
    }
    const body = (await res.json().catch(() => null)) as {
      success?: boolean;
      errors?: { code?: number; message?: string }[];
      result?: { permanent_bounces?: unknown[] } | null;
    } | null;
    if (res.ok && body?.success) {
      if (body.result?.permanent_bounces?.length) throw new EmailSendError('permanent_bounce', 400);
      return;
    }
    const first = body?.errors?.[0];
    const code = first?.code;
    if (/daily/i.test(first?.message ?? '')) throw new EmailSendError('daily_quota_exceeded', 429);
    if (code !== undefined && CLOUDFLARE_PAUSED.has(code)) throw new EmailSendError(`cloudflare_${code}`, 503);
    throw new EmailSendError(code !== undefined ? `cloudflare_${code}` : 'cloudflare_error', res.status);
  }
}

export interface EmailGuardOptions {
  /** Comma-separated addresses or "@domain" entries that receive their own mail. */
  allowlist: string;
  /** Where everyone else's mail goes; without it, their mail is dropped. */
  redirectTo?: string;
}

/**
 * Wraps the real transport outside production (staging) so it never emails arbitrary
 * people: allowlisted recipients get their mail, everyone else's is redirected to one
 * address with the original recipient in the subject, or dropped if there is no redirect.
 */
export class GuardedTransport extends EmailTransport {
  private readonly logger = new Logger('Email');
  private readonly addresses = new Set<string>();
  private readonly domains = new Set<string>();
  private readonly redirectTo?: string;

  constructor(
    private readonly inner: EmailTransport,
    opts: EmailGuardOptions,
  ) {
    super();
    for (const raw of opts.allowlist.split(',')) {
      const entry = raw.trim().toLowerCase();
      if (!entry) continue;
      if (entry.startsWith('@')) this.domains.add(entry.slice(1));
      else this.addresses.add(entry);
    }
    this.redirectTo = opts.redirectTo?.trim() || undefined;
    if (this.redirectTo) this.addresses.add(this.redirectTo.toLowerCase());
  }

  /** True when either option is set, i.e. the guard should be installed. */
  static enabled(opts: EmailGuardOptions): boolean {
    return Boolean(opts.allowlist.trim() || opts.redirectTo?.trim());
  }

  allows(to: string): boolean {
    const address = to.trim().toLowerCase();
    return this.addresses.has(address) || this.domains.has(address.slice(address.lastIndexOf('@') + 1));
  }

  async send(m: EmailMessage, options?: SendOptions): Promise<void> {
    if (this.allows(m.to)) return this.inner.send(m, options);
    if (!this.redirectTo) {
      // Never log the address itself.
      this.logger.warn(`[email guard] dropped "${m.subject}": recipient not on EMAIL_ALLOWLIST`);
      return;
    }
    await this.inner.send({ ...m, to: this.redirectTo, subject: `[to ${m.to}] ${m.subject}` }, options);
  }
}

/** Development fallback: logs the subject only (never addresses or bodies). */
export class LogTransport extends EmailTransport {
  private readonly logger = new Logger('Email');

  async send(m: EmailMessage): Promise<void> {
    this.logger.log(`[log transport] would send "${m.subject}"`);
  }
}
