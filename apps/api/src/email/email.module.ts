import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailService } from './email.service';
import { EmailTransport, GuardedTransport, LogTransport, ResendTransport, SmtpTransport } from './email.transport';

function providerTransport(env: Env): EmailTransport {
  switch (env.EMAIL_PROVIDER) {
    case 'resend':
      if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
      return new ResendTransport(env.RESEND_API_KEY, env.EMAIL_FROM);
    case 'smtp':
      return new SmtpTransport(env.SMTP_HOST, env.SMTP_PORT, env.EMAIL_FROM);
    case 'log':
      return new LogTransport();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: EmailTransport,
      inject: [ENV],
      useFactory: (env: Env): EmailTransport => {
        const transport = providerTransport(env);
        // Staging sets EMAIL_REDIRECT_TO / EMAIL_ALLOWLIST so it never emails real students.
        const guard = { allowlist: env.EMAIL_ALLOWLIST, redirectTo: env.EMAIL_REDIRECT_TO };
        return GuardedTransport.enabled(guard) ? new GuardedTransport(transport, guard) : transport;
      },
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
