import 'server-only';
import { normalizeSerial, type PublicCertificateDto } from '@academy/shared';
import { headers } from 'next/headers';
import { cache } from 'react';
import { forwardedIp, RateLimitedError, serverGetFresh } from '@/lib/server-api';

export type Lookup = { kind: 'found'; cert: PublicCertificateDto } | { kind: 'missing' } | { kind: 'limited' };

/** One lookup per request (the page, its metadata and its social card share it), never cached. */
export const lookupCertificate = cache(async (raw: string): Promise<Lookup> => {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // malformed escape: not a serial
  }
  const serial = normalizeSerial(decoded);
  if (!serial) return { kind: 'missing' };
  try {
    const cert = await serverGetFresh<PublicCertificateDto>(`/certificates/${serial}`, forwardedIp(await headers()));
    return cert ? { kind: 'found', cert } : { kind: 'missing' };
  } catch (err) {
    if (err instanceof RateLimitedError) return { kind: 'limited' };
    throw err;
  }
});
