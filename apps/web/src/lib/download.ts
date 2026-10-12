'use client';

import { api } from './api';

/**
 * Downloads a file from the API through api(), so an expired access token is
 * refreshed first (a plain <a download> would save a 401 response instead).
 */
export async function downloadViaApi(path: string, filename: string): Promise<void> {
  const blob = await api<Blob>(path, { headers: { Accept: 'application/octet-stream' } });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves a file made in the browser (e.g. a template). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
