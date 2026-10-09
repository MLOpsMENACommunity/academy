import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { recordingsQuerySchema, type PublicSpeakerDto, type RecordingSearchDto, type RecordingsDto, type RecordingsQuery } from '@academy/shared';
import { Public } from '../common/decorators';
import { SkipThrottleWithoutQuery } from '../common/throttler.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ArchiveService } from './archive.service';

/** Browsers searching the library: per IP (or account), on top of the global limit. */
const SEARCH_LIMIT = { default: { limit: 60, ttl: 60_000 } };

// Public reads aren't throttled: the Next server renders pages for every visitor from one IP.
// Text searches come from browsers (the recordings page is static), so those are throttled.
@ApiTags('archive')
@Controller()
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  @Public()
  @SkipThrottleWithoutQuery('q')
  @Throttle(SEARCH_LIMIT)
  @Get('recordings')
  @Header('Cache-Control', 'public, max-age=60')
  recordings(@Query(new ZodPipe(recordingsQuerySchema)) q: RecordingsQuery): Promise<RecordingsDto> {
    return this.archive.recordings(q);
  }

  /** Ids of the recordings matching a text search (and topic): all the static recordings page needs. */
  @Public()
  @Throttle(SEARCH_LIMIT)
  @Get('recordings/search')
  @Header('Cache-Control', 'public, max-age=60')
  async search(@Query(new ZodPipe(recordingsQuerySchema)) q: RecordingsQuery): Promise<RecordingSearchDto> {
    return { ids: (await this.archive.recordings(q)).items.map((i) => i.id) };
  }

  @Public()
  @SkipThrottle()
  @Get('speakers')
  speakers(): Promise<{ slug: string; updatedAt: Date }[]> {
    return this.archive.speakerSlugs();
  }

  @Public()
  @SkipThrottle()
  @Get('speakers/:slug')
  @Header('Cache-Control', 'public, max-age=60')
  speaker(@Param('slug') slug: string): Promise<PublicSpeakerDto> {
    return this.archive.speaker(slug);
  }
}
