import { createHash, randomBytes } from 'node:crypto';

/** URL-safe random token (256 bits by default). Only its hash is stored. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
