import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

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
    return this.statusCode === 429 && this.code !== 'daily_quota_exceeded';
  }
}

/**
 * Delivery adapter. Swapping provider (e.g. to Amazon SES) means adding one
 * class here and one case in email.module.ts; nothing else changes.
 */
export abstract class EmailTransport {
  abstract send(message: EmailMessage): Promise<void>;
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
    await this.transporter.sendMail({ from: this.from, to: m.to, subject: m.subject, html: m.html, text: m.text });
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

  async send(m: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
    if (error) throw new EmailSendError(error.name, (error as { statusCode?: number }).statusCode ?? undefined);
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

  async send(m: EmailMessage): Promise<void> {
    if (this.allows(m.to)) return this.inner.send(m);
    if (!this.redirectTo) {
      // Never log the address itself.
      this.logger.warn(`[email guard] dropped "${m.subject}": recipient not on EMAIL_ALLOWLIST`);
      return;
    }
    await this.inner.send({ ...m, to: this.redirectTo, subject: `[to ${m.to}] ${m.subject}` });
  }
}

/** Development fallback: logs the subject only (never addresses or bodies). */
export class LogTransport extends EmailTransport {
  private readonly logger = new Logger('Email');

  async send(m: EmailMessage): Promise<void> {
    this.logger.log(`[log transport] would send "${m.subject}"`);
  }
}
