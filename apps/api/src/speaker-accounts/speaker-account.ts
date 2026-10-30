import type { SpeakerAccountDto } from '@academy/shared';
import type { Prisma } from '@prisma/client';

/** The account behind a speaker profile, as Admin → Speakers shows it. */
export const SPEAKER_ACCOUNT_SELECT = { id: true, email: true, role: true, lastLoginAt: true } as const satisfies Prisma.UserSelect;

export function toSpeakerAccount(u: Prisma.UserGetPayload<{ select: typeof SPEAKER_ACCOUNT_SELECT }>): SpeakerAccountDto {
  return { id: u.id, email: u.email, role: u.role, pending: !u.lastLoginAt };
}
