import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Locks every live super admin's row (in id order, so concurrent callers never deadlock) and
 * returns their ids. Run inside a transaction before anything that could remove the SUPER
 * preset from someone: a second change waits for the first and then sees its result.
 */
export async function lockSupers(tx: Prisma.TransactionClient): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User"
    WHERE "role" = 'ADMIN' AND 'SUPER' = ANY("adminPermissions") AND "deletedAt" IS NULL
    ORDER BY "id"
    FOR UPDATE`;
  return rows.map((r) => r.id);
}

/** Throws LAST_SUPER when `userId` is the only live super admin (under the row locks). */
export async function assertNotLastSuper(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const supers = await lockSupers(tx);
  if (supers.includes(userId) && supers.length <= 1) {
    throw new ConflictException({ code: 'LAST_SUPER', message: 'There must always be at least one super admin' });
  }
}
