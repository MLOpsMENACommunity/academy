import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
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
    if (error) throw new Error(`Resend error: ${error.name}`);
  }
}

/** Development fallback: logs the subject only (never addresses or bodies). */
export class LogTransport extends EmailTransport {
  private readonly logger = new Logger('Email');

  async send(m: EmailMessage): Promise<void> {
    this.logger.log(`[log transport] would send "${m.subject}"`);
  }
}
