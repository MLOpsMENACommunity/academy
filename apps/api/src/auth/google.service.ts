import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** Sign in with Google (OpenID Connect authorization-code flow). */
@Injectable()
export class GoogleService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET);
  }

  private client(): OAuth2Client {
    if (!this.enabled) throw new ServiceUnavailableException('Google sign-in is not configured');
    return new OAuth2Client({
      clientId: this.env.GOOGLE_CLIENT_ID,
      clientSecret: this.env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${this.env.WEB_URL}/api/auth/google/callback`,
    });
  }

  authUrl(state: string): string {
    return this.client().generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account',
      access_type: 'online',
    });
  }

  async exchange(code: string): Promise<GoogleIdentity> {
    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) throw new UnauthorizedException('Google did not return an ID token');
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: this.env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new UnauthorizedException('Google account has no email');
    return { sub: p.sub, email: p.email.toLowerCase(), emailVerified: Boolean(p.email_verified), name: p.name ?? null };
  }
}
