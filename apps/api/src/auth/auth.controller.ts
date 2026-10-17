import { Body, Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  forgotPasswordSchema,
  homePath,
  isLocaleValue,
  isStudentOnlyPath,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  safeReturnTo,
  SIGNUP_ROLES,
  signupRoleSchema,
  verifyEmailSchema,
  type LoginInput,
  type MeResponse,
  type RegisterInput,
} from '@academy/shared';
import type { User } from '@prisma/client';
import type { Request, Response } from 'express';
import { randomToken } from '../common/crypto';
import { CurrentUser, Public, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthService } from './auth.service';
import {
  clearAuthCookies,
  clearOAuthStateCookie,
  OAUTH_STATE_COOKIE,
  REFRESH_COOKIE,
  setAuthCookies,
  setOAuthStateCookie,
} from './cookies';
import { GoogleService } from './google.service';
import { TokensService, type SessionInfo } from './tokens.service';
import { z } from 'zod';

const oauthStateSchema = z.object({
  nonce: z.string(),
  returnTo: z.string(),
  locale: z.enum(['en', 'ar']),
  /** "I'm a student / I'm a speaker": used only if Google sign-in creates the account. Never ADMIN. */
  role: z.enum(SIGNUP_ROLES).default('STUDENT'),
});

@ApiTags('auth')
@Controller('auth')
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    private readonly google: GoogleService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async startSession(res: Response, user: User, req: Request, amr: SessionInfo['amr']): Promise<void> {
    // Signing in (or up) over an existing session replaces its cookies: end that session on the
    // server too, or its refresh token would stay valid for 30 days with nobody holding it.
    const previous: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof previous === 'string' && previous) await this.tokens.revoke(previous);
    const session: SessionInfo = { amr, authTime: new Date() };
    const access = await this.tokens.signAccess(user, session);
    const refresh = await this.tokens.issueRefresh(user.id, req.headers['user-agent'], session);
    setAuthCookies(res, this.env, access, refresh);
  }

  @Public()
  @Post('register')
  // Per IP. Generous because many students share carrier-grade NAT addresses on mobile data.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(
    @Body(new ZodPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const user = await this.auth.register(body);
    await this.startSession(res, user, req, 'pwd');
    return this.auth.me(user.id);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const user = await this.auth.login(body);
    await this.startSession(res, user, req, 'pwd');
    return this.auth.me(user.id);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true } | { ok: false; reason: string }> {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== 'string' || !token) {
      clearAuthCookies(res, this.env);
      res.status(401);
      return { ok: false, reason: 'missing' };
    }
    const result = await this.tokens.rotate(token, req.headers['user-agent']);
    if (!result.ok) {
      // Another tab already rotated this token; its new cookies are in the jar, so don't clear them.
      if (result.reason === 'concurrent') {
        res.status(409);
        return { ok: false, reason: 'concurrent' };
      }
      clearAuthCookies(res, this.env);
      res.status(401);
      return { ok: false, reason: result.reason };
    }
    setAuthCookies(res, this.env, await this.tokens.signAccess(result.user, result.session), result.refreshToken);
    return { ok: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token === 'string' && token) await this.tokens.revoke(token);
    clearAuthCookies(res, this.env);
    return { ok: true };
  }

  @Get('me')
  @SkipThrottle()
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user.id);
  }

  /**
   * Requires being signed in to the same account: otherwise someone who
   * pre-registered your address could get you to "verify" their account just by
   * clicking the email we send you.
   */
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(verifyEmailSchema)) body: { token: string },
  ): Promise<{ ok: true; returnTo: string | null }> {
    const { returnTo } = await this.auth.verifyEmail(body.token, user.id);
    return { ok: true, returnTo };
  }

  @Post('resend-verification')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resend(@CurrentUser() user: AuthUser): Promise<{ ok: true }> {
    await this.auth.resendVerification(user.id);
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgot(
    @Body(new ZodPipe(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>,
  ): Promise<{ ok: true }> {
    await this.auth.forgotPassword(body.email, body.locale);
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async reset(
    @Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.auth.resetPassword(body.token, body.password);
    clearAuthCookies(res, this.env);
    return { ok: true };
  }

  // ------------------------------------------------------------------ Google

  @Public()
  @SkipThrottle()
  @Get('google/enabled')
  googleEnabled(): { enabled: boolean } {
    return { enabled: this.google.enabled };
  }

  /** Browser navigates here; we bounce to Google with a CSRF nonce bound to a cookie. */
  @Public()
  @SkipThrottle()
  @Get('google')
  googleStart(
    @Query('returnTo') returnTo: string | undefined,
    @Query('locale') locale: string | undefined,
    @Query('as') as: string | undefined,
    @Res() res: Response,
  ): void {
    const lang = isLocaleValue(locale) ? locale : 'en';
    // Anything but a valid sign-up role (e.g. ADMIN) falls back to student.
    const role = signupRoleSchema.catch('STUDENT').parse(as?.toUpperCase());
    if (!this.google.enabled) {
      res.redirect(`${this.env.WEB_URL}/${lang}/login?error=google_unavailable`);
      return;
    }
    const nonce = randomToken(16);
    const state = { nonce, returnTo: safeReturnTo(returnTo, homePath(role, lang)), locale: lang, role };
    setOAuthStateCookie(res, this.env, Buffer.from(JSON.stringify(state)).toString('base64url'));
    res.redirect(this.google.authUrl(nonce));
  }

  @Public()
  @SkipThrottle()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') stateParam: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const raw: unknown = req.cookies?.[OAUTH_STATE_COOKIE];
    clearOAuthStateCookie(res, this.env);
    let state: z.infer<typeof oauthStateSchema> | null = null;
    try {
      state = oauthStateSchema.parse(JSON.parse(Buffer.from(String(raw), 'base64url').toString()));
    } catch {
      state = null;
    }
    const lang = state?.locale ?? 'en';
    const fail = (reason: string) => res.redirect(`${this.env.WEB_URL}/${lang}/login?error=${reason}`);
    if (!state || !code || stateParam !== state.nonce) return fail('google_state');

    try {
      const identity = await this.google.exchange(code);
      const { user } = await this.auth.loginWithGoogle(identity, lang, state.role);
      await this.startSession(res, user, req, 'google');
      let to = safeReturnTo(state.returnTo, homePath(user.role, lang));
      // Speakers skip the student pages (onboarding, dashboard, applying): their home is the portal.
      if (user.role === 'SPEAKER' && isStudentOnlyPath(to, lang)) to = homePath('SPEAKER', lang);
      res.redirect(`${this.env.WEB_URL}${to}`);
    } catch (err) {
      const e = err as Error;
      // Error type and Google's error string only; never the code, tokens or email.
      this.logger.warn(`Google sign-in failed: ${e.name} ${e.message.slice(0, 80)}`);
      const code = (err as { getResponse?: () => unknown }).getResponse?.();
      fail(code && typeof code === 'object' && (code as { code?: unknown }).code === 'ACCOUNT_DELETED' ? 'account_deleted' : 'google_failed');
    }
  }
}
