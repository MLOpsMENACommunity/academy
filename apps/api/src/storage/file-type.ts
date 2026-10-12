/**
 * Detects a file's real type from its first bytes. Uploads are validated with
 * this, never by the extension or the client-supplied Content-Type.
 */
export type DetectedType = 'image/jpeg' | 'image/png' | 'application/pdf';

export function detectFileType(buf: Buffer): DetectedType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * An uploaded image's real type (JPG, PNG or WebP) from its first bytes, or null. Separate from
 * detectFileType so payment screenshots, CVs and submissions keep accepting exactly what they did.
 */
export function detectImageType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const t = detectFileType(buf);
  if (t === 'image/jpeg' || t === 'image/png') return t;
  // RIFF....WEBP
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
