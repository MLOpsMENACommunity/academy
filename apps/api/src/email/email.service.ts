import { Inject, Injectable, Logger } from '@nestjs/common';
import { render } from '@react-email/render';
import type { Locale } from '@academy/shared';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailTransport } from './email.transport';
import { buildEmail, type EmailTemplate } from './templates/catalog';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly transport: EmailTransport,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Absolute link into the web app, e.g. url('en', '/dashboard'). */
  url(locale: Locale, path: string): string {
    return `${this.env.WEB_URL}/${locale}${path}`;
  }

  /**
   * Renders and sends a template. Delivery failures are logged (template name
   * only, never the address or content) and never break the calling request.
   */
  async send(to: string, locale: Locale, template: EmailTemplate): Promise<boolean> {
    try {
      const { subject, element } = buildEmail(template, locale);
      const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
      await this.transport.send({ to, subject, html, text });
      return true;
    } catch (err) {
      this.logger.error(`Failed to send "${template.name}" email: ${(err as Error).message}`);
      return false;
    }
  }
}
