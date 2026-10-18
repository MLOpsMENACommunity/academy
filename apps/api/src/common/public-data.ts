import { Global, Injectable, Module } from '@nestjs/common';
import { SEAT_HOLDING_STATUSES, type ApplicationStatus } from '@academy/shared';
import { PublicCache } from './public-cache';
import { PublicRevalidator } from './revalidate';
import { SignedInCache } from './signed-in-cache';

/**
 * Whether a status change moves the public numbers of a course: its enrolled count
 * (into or out of ENROLLED) or its seats left (into or out of a seat-holding status).
 */
export function changesPublicCounts(from: ApplicationStatus | null, to: ApplicationStatus | null): boolean {
  const holds = (s: ApplicationStatus | null) => s !== null && SEAT_HOLDING_STATUSES.includes(s);
  return holds(from) !== holds(to) || (from === 'ENROLLED') !== (to === 'ENROLLED');
}

/**
 * Public data changed outside an admin request (the PublicCacheInterceptor handles those):
 * a student enrolling or withdrawing, an invite being claimed at sign-in, an account being
 * deleted. Clears the API's in-process public cache at once and asks the site to revalidate
 * its pages (debounced and coalesced by PublicRevalidator), so a course's "N students
 * enrolled" and "X seats left" are current within seconds. Call it after the commit.
 */
@Injectable()
export class PublicDataChanges {
  constructor(
    private readonly cache: PublicCache,
    private readonly revalidator: PublicRevalidator,
  ) {}

  changed(): void {
    this.cache.clear();
    this.revalidator.changed();
  }

  /** `changed()` when an application's status change moves a course's public counts. */
  statusChanged(from: ApplicationStatus | null, to: ApplicationStatus | null): void {
    if (changesPublicCounts(from, to)) this.changed();
  }
}

/** The public cache, the site revalidator, PublicDataChanges and the signed-in cache, for every module. */
@Global()
@Module({
  providers: [PublicCache, PublicRevalidator, PublicDataChanges, SignedInCache],
  exports: [PublicCache, PublicRevalidator, PublicDataChanges, SignedInCache],
})
export class PublicDataModule {}
