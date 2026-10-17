import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Locale } from '@academy/shared';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { classifySendError, EmailSendError, EmailTransport, type SendErrorKind } from './email.transport';
import type { EmailTemplate } from './templates/catalog';

/**
 * The templates and their renderer (React Email: ~2.6 s of module loading on a ¼ vCPU) are
 * loaded on first use, not at boot, so a container start isn't slowed by them (main.ts warms
 * them shortly after the API listens).
 */
let renderer: Promise<{ buildEmail: typeof import('./templates/catalog').buildEmail; render: typeof import('@react-email/render').render }> | null = null;
export function loadEmailRenderer(): NonNullable<typeof renderer> {
  renderer ??= Promise.all([import('./templates/catalog'), import('@react-email/render')]).then(
    ([catalog, r]) => ({ buildEmail: catalog.buildEmail, render: r.render }),
    (err: unknown) => {
      renderer = null; // a failed load is retried on the next email, not kept
      throw err;
    },
  );
  return renderer;
}

interface Job {
  run: () => Promise<void>;
  resolve: (result: SendResult) => void;
  label: string;
}

/** How a send ended. `kind` says what a failure means for a retry (see classifySendError). */
export type SendResult = { ok: true } | { ok: false; kind: SendErrorKind; code: string };

export interface SendOpts {
  bulk?: boolean;
  /** Passed to the provider, which then sends at most once per key (outbox rows). */
  idempotencyKey?: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

const RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * All outgoing email goes through one paced queue so the provider's rate limit
 * (Resend: about 2 requests a second per account) is never exceeded by bulk mail
 * competing with sign-up emails. Two lanes: transactional mail (verification,
 * password reset, status changes) always goes before bulk mail (announcements,
 * reminders).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly lanes: { high: Job[]; bulk: Job[] } = { high: [], bulk: [] };
  private pumping = false;
  private lastSentAt = 0;
  private readonly minIntervalMs: number;

  constructor(
    private readonly transport: EmailTransport,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.minIntervalMs = env.EMAIL_MIN_INTERVAL_MS ?? (env.EMAIL_PROVIDER === 'resend' ? 550 : 0);
  }

  /** Absolute link into the web app, e.g. url('en', '/dashboard'). */
  url(locale: Locale, path: string): string {
    return `${this.env.WEB_URL}/${locale}${path}`;
  }

  /** Emails waiting to be sent, for monitoring. */
  get queued(): number {
    return this.lanes.high.length + this.lanes.bulk.length;
  }

  /**
   * Renders and sends a template. Delivery failures are logged (template name and
   * provider error code only, never the address or content) and never break the
   * calling request. Resolves once the email was handed to the provider (true) or
   * finally failed (false).
   */
  async send(to: string, locale: Locale, template: EmailTemplate, opts: SendOpts = {}): Promise<boolean> {
    return (await this.deliver(to, locale, template, opts)).ok;
  }

  /**
   * Like send(), but says why a send failed, so a durable caller (the outbox) can decide
   * between retrying later, waiting for tomorrow's quota and giving up.
   */
  async deliver(to: string, locale: Locale, template: EmailTemplate, opts: SendOpts = {}): Promise<SendResult> {
    let render: Awaited<ReturnType<typeof loadEmailRenderer>>;
    try {
      render = await loadEmailRenderer();
    } catch (err) {
      this.logger.error(`Failed to load the email templates: ${(err as Error).name}`);
      return { ok: false, kind: 'retryable', code: 'renderer_unavailable' };
    }
    let message: { subject: string; html: string; text: string };
    try {
      const { subject, element } = render.buildEmail(template, locale);
      const [html, text] = await Promise.all([render.render(element), render.render(element, { plainText: true })]);
      message = { subject, html, text };
    } catch (err) {
      // The same template data fails the same way next time.
      this.logger.error(`Failed to render "${template.name}" email: ${(err as Error).name}`);
      return { ok: false, kind: 'permanent', code: 'render_failed' };
    }
    const sendOptions = opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined;
    return new Promise<SendResult>((resolve) => {
      const job: Job = {
        run: () => this.transport.send({ to, ...message, ...(opts.headers ? { headers: opts.headers } : {}) }, sendOptions),
        resolve,
        label: template.name,
      };
      (opts.bulk ? this.lanes.bulk : this.lanes.high).push(job);
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let job = this.next(); job; job = this.next()) {
        job.resolve(await this.attempt(job));
      }
    } finally {
      this.pumping = false;
    }
  }

  private next(): Job | undefined {
    return this.lanes.high.shift() ?? this.lanes.bulk.shift();
  }

  private async attempt(job: Job): Promise<SendResult> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastSentAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastSentAt = Date.now();
      try {
        await job.run();
        return { ok: true };
      } catch (err) {
        const retry = err instanceof EmailSendError && err.retryable && attempt < RETRY_DELAYS_MS.length;
        if (retry) {
          await sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        // Provider messages often contain the recipient address: log only the error type/code.
        const e = err as { name?: string; code?: string | number; statusCode?: number; responseCode?: number };
        this.logger.error(
          `Failed to send "${job.label}" email: ${e.name ?? 'Error'} ${e.code ?? ''} ${e.statusCode ?? e.responseCode ?? ''}`.replace(/\s+/g, ' ').trim(),
        );
        return { ok: false, kind: classifySendError(err), code: String(e.code ?? e.statusCode ?? e.responseCode ?? e.name ?? 'error').slice(0, 64) };
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
