import { Inject, Injectable, Logger } from '@nestjs/common';
import { JWT } from 'google-auth-library';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

const API = 'https://www.googleapis.com/drive/v3';

/** Why sharing failed, as shown to admins (translated in the web app). */
export type DriveShareError = 'not_google_account' | 'no_folder_access' | 'failed';

export class DriveShareFailed extends Error {
  constructor(readonly code: DriveShareError, message: string) {
    super(message);
  }
}

/** The folder id in a drive.google.com folder link, or null for any other link. */
export function driveFolderId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https:\/\/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|open\?id=)([\w-]{10,})/.exec(url);
  return m?.[1] ?? null;
}

/** The service account key from GOOGLE_DRIVE_SERVICE_ACCOUNT: the JSON key file, as is or base64. */
export function parseServiceAccount(raw: string | undefined): { clientEmail: string; privateKey: string } | null {
  if (!raw?.trim()) return null;
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  try {
    const key = JSON.parse(text) as { client_email?: unknown; private_key?: unknown };
    if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') return null;
    return { clientEmail: key.client_email, privateKey: key.private_key };
  } catch {
    return null;
  }
}

/** What the academy needs from Google Drive; e2e tests provide a fake under DRIVE_API. */
export interface DriveApi {
  /** The service account's address (admins share each course folder with it), or null when not set up. */
  account(): string | null;
  /** The folder's name and whether the service account may share it. */
  folder(folderId: string): Promise<{ name: string; canShare: boolean }>;
  /** Gives the address Viewer access to the folder (no email from Google). */
  share(folderId: string, email: string): Promise<void>;
  /** Removes the address from the folder; false when it had no access. */
  unshare(folderId: string, email: string): Promise<boolean>;
}

export const DRIVE_API = Symbol('DRIVE_API');

/**
 * Google Drive through a service account (GOOGLE_DRIVE_SERVICE_ACCOUNT). It sees only the
 * folders shared with it, so each paid course's folder is shared with its address as Editor.
 */
@Injectable()
export class GoogleDriveApi implements DriveApi {
  private readonly logger = new Logger(GoogleDriveApi.name);
  private readonly client: JWT | null;
  private readonly email: string | null;

  constructor(@Inject(ENV) env: Env) {
    const key = parseServiceAccount(env.GOOGLE_DRIVE_SERVICE_ACCOUNT);
    if (env.GOOGLE_DRIVE_SERVICE_ACCOUNT && !key) this.logger.warn('GOOGLE_DRIVE_SERVICE_ACCOUNT is not a service account key: Drive sharing stays manual');
    this.email = key?.clientEmail ?? null;
    this.client = key ? new JWT({ email: key.clientEmail, key: key.privateKey, scopes: ['https://www.googleapis.com/auth/drive'] }) : null;
  }

  account(): string | null {
    return this.email;
  }

  private async call<T>(opts: { url: string; method?: 'GET' | 'POST' | 'DELETE'; params?: Record<string, unknown>; data?: unknown }): Promise<T> {
    if (!this.client) throw new DriveShareFailed('failed', 'Drive is not configured');
    try {
      const res = await this.client.request<T>({ ...opts, params: { supportsAllDrives: true, ...opts.params }, timeout: 10_000 });
      return res.data;
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { error?: { errors?: { reason?: string }[]; message?: string } } }; message?: string };
      const status = e.response?.status;
      const reason = e.response?.data?.error?.errors?.[0]?.reason ?? '';
      const message = e.response?.data?.error?.message ?? e.message ?? 'Drive request failed';
      // Sharing without Google's email works only with Google accounts.
      if (status === 400 && /invalidSharingRequest|invalid/i.test(reason)) throw new DriveShareFailed('not_google_account', message);
      if (status === 403 || status === 404) throw new DriveShareFailed('no_folder_access', message);
      throw new DriveShareFailed('failed', message);
    }
  }

  async folder(folderId: string): Promise<{ name: string; canShare: boolean }> {
    const f = await this.call<{ name: string; capabilities?: { canShare?: boolean } }>({
      url: `${API}/files/${encodeURIComponent(folderId)}`,
      params: { fields: 'name,capabilities(canShare)' },
    });
    return { name: f.name, canShare: Boolean(f.capabilities?.canShare) };
  }

  async share(folderId: string, email: string): Promise<void> {
    await this.call({
      url: `${API}/files/${encodeURIComponent(folderId)}/permissions`,
      method: 'POST',
      params: { sendNotificationEmail: false },
      data: { type: 'user', role: 'reader', emailAddress: email },
    });
  }

  async unshare(folderId: string, email: string): Promise<boolean> {
    const wanted = email.toLowerCase();
    let pageToken: string | undefined;
    do {
      const page = await this.call<{ permissions?: { id: string; emailAddress?: string; role?: string }[]; nextPageToken?: string }>({
        url: `${API}/files/${encodeURIComponent(folderId)}/permissions`,
        params: { fields: 'nextPageToken,permissions(id,emailAddress,role)', pageSize: 100, ...(pageToken ? { pageToken } : {}) },
      });
      // Only a reader or commenter: an address that owns or edits the folder is the team's, never removed here.
      const p = page.permissions?.find((x) => x.emailAddress?.toLowerCase() === wanted && (x.role === 'reader' || x.role === 'commenter'));
      if (p) {
        await this.call({ url: `${API}/files/${encodeURIComponent(folderId)}/permissions/${encodeURIComponent(p.id)}`, method: 'DELETE' });
        return true;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return false;
  }
}
