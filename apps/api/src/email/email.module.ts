import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from './email.service';
import { EmailTransport, LogTransport, ResendTransport, SmtpTransport } from './email.transport';

@Global()
@Module({
  providers: [
    {
      provide: EmailTransport,
      inject: [ENV],
      useFactory: (env: Env): EmailTransport => {
        switch (env.EMAIL_PROVIDER) {
          case 'resend':
            if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
            return new ResendTransport(env.RESEND_API_KEY, env.EMAIL_FROM);
          case 'smtp':
            return new SmtpTransport(env.SMTP_HOST, env.SMTP_PORT, env.EMAIL_FROM);
          case 'log':
            return new LogTransport();
        }
      },
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
