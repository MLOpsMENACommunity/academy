import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** Read busy times (free/busy only, never event details) and add, move and remove the calls' own events. */
export const GOOGLE_CALENDAR_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.freebusy', 'https://www.googleapis.com/auth/calendar.events'];
const CONNECT_LINK_TTL_MS = 10 * 60_000;
const API = 'https://www.googleapis.com/calendar/v3';

/** The expert's connection no longer works (revoked, or expired: Google ends unverified apps' tokens after 7 days). */
export class GoogleCalendarExpired extends Error {}

export interface CalendarEventInput {
  /** Our booking id: Google uses it to make the Meet link once even if the call is retried. */
  requestId: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  attendeeEmail: string;
}

/**
 * The experts' Google Calendars, through the same OAuth client as Google sign-in (offline access:
 * a refresh token per expert, stored encrypted with a key derived from JWT_ACCESS_SECRET; rotating
 * that secret means experts connect again). Every call is outside our database transactions.
 */
@Injectable()
export class GoogleCalendar {
  private readonly logger = new Logger(GoogleCalendar.name);
  private readonly key: Buffer;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = createHmac('sha256', env.JWT_ACCESS_SECRET).update('google-calendar-v1').digest();
  }

  isEnabled(): boolean {
    return Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET);
  }

  redirectUri(): string {
    return `${this.env.WEB_URL}/api/consultations/google/callback`;
  }

  private client(refreshToken?: string): OAuth2Client {
    const c = new OAuth2Client({ clientId: this.env.GOOGLE_CLIENT_ID, clientSecret: this.env.GOOGLE_CLIENT_SECRET, redirectUri: this.redirectUri() });
    if (refreshToken) c.setCredentials({ refresh_token: refreshToken });
    return c;
  }

  // ------------------------------------------------------------------ connecting

  /** A signed, short-lived state naming who asked, so the callback can't attach a calendar to someone else. */
  connectUrl(userId: string, now = Date.now()): string {
    const payload = `${userId}.${now + CONNECT_LINK_TTL_MS}`;
    const state = `${payload}.${this.sign(payload)}`;
    return this.client().generateAuthUrl({ scope: GOOGLE_CALENDAR_SCOPES, state, access_type: 'offline', prompt: 'consent', include_granted_scopes: true });
  }

  /** The user id a state was made for, or null when it is forged or older than 10 minutes. */
  stateUser(state: string, now = Date.now()): string | null {
    const [userId, exp, sig] = state.split('.');
    if (!userId || !exp || !sig) return null;
    const expected = Buffer.from(this.sign(`${userId}.${exp}`));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return Number(exp) >= now ? userId : null;
  }

  async exchange(code: string): Promise<{ refreshToken: string; email: string | null; scopes: string[] }> {
    const c = this.client();
    const { tokens } = await c.getToken(code);
    if (!tokens.refresh_token) throw new Error('Google returned no refresh token');
    let email: string | null = null;
    if (tokens.id_token) {
      const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: this.env.GOOGLE_CLIENT_ID });
      email = ticket.getPayload()?.email?.toLowerCase() ?? null;
    }
    return { refreshToken: tokens.refresh_token, email, scopes: (tokens.scope ?? '').split(' ') };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.client().revokeToken(refreshToken).catch(() => undefined);
  }

  // ------------------------------------------------------------------ calendar

  private async call<T>(refreshToken: string, opts: { url: string; method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; params?: Record<string, unknown>; data?: unknown }): Promise<T> {
    try {
      const res = await this.client(refreshToken).request<T>({ ...opts, timeout: 10_000 });
      return res.data;
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { error?: unknown } }; message?: string };
      const code = typeof e.response?.data?.error === 'string' ? e.response.data.error : '';
      if (code === 'invalid_grant' || e.response?.status === 401 || /invalid_grant/.test(e.message ?? '')) throw new GoogleCalendarExpired();
      throw err;
    }
  }

  /** Busy times in the expert's primary calendar (no titles or details: free/busy only). */
  async busy(refreshToken: string, from: Date, to: Date): Promise<{ startsAt: Date; endsAt: Date }[]> {
    const r = await this.call<{ calendars?: { primary?: { busy?: { start: string; end: string }[] } } }>(refreshToken, {
      url: `${API}/freeBusy`,
      method: 'POST',
      data: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] },
    });
    return (r.calendars?.primary?.busy ?? []).map((b) => ({ startsAt: new Date(b.start), endsAt: new Date(b.end) }));
  }

  /** Adds the call to the expert's calendar with a new Meet link, and invites the student (Google emails them). */
  async createEvent(refreshToken: string, e: CalendarEventInput): Promise<{ eventId: string; meetUrl: string | null }> {
    const r = await this.call<{ id: string; hangoutLink?: string }>(refreshToken, {
      url: `${API}/calendars/primary/events`,
      method: 'POST',
      params: { conferenceDataVersion: 1, sendUpdates: 'all' },
      data: {
        summary: e.summary,
        description: e.description,
        start: { dateTime: e.start.toISOString() },
        end: { dateTime: e.end.toISOString() },
        attendees: [{ email: e.attendeeEmail }],
        conferenceData: { createRequest: { requestId: e.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
        reminders: { useDefault: true },
      },
    });
    return { eventId: r.id, meetUrl: r.hangoutLink ?? null };
  }

  /** Moves the event (same Meet link); the student gets Google's update. */
  async moveEvent(refreshToken: string, eventId: string, start: Date, end: Date): Promise<void> {
    await this.call(refreshToken, {
      url: `${API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
      method: 'PATCH',
      params: { sendUpdates: 'all' },
      data: { start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } },
    });
  }

  /** Removes the event; the student gets Google's cancellation. */
  async deleteEvent(refreshToken: string, eventId: string): Promise<void> {
    await this.call(refreshToken, { url: `${API}/calendars/primary/events/${encodeURIComponent(eventId)}`, method: 'DELETE', params: { sendUpdates: 'all' } });
  }

  // ------------------------------------------------------------------ token storage

  encrypt(token: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(token, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
  }

  /** The stored token, or null when it can't be read (a rotated secret): the expert connects again. */
  decrypt(stored: string): string | null {
    try {
      const [v, iv, tag, body] = stored.split('.');
      if (v !== 'v1' || !iv || !tag || !body) return null;
      const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
    } catch {
      this.logger.warn('A stored Google Calendar token could not be decrypted');
      return null;
    }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(`state:${payload}`).digest('base64url');
  }
}
