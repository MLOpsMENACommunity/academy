import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { recordingsQuerySchema, type PublicSpeakerDto, type RecordingsDto, type RecordingsQuery } from '@academy/shared';
import { Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ArchiveService } from './archive.service';

// Public reads aren't throttled: the Next server renders pages for every visitor from one IP.
@ApiTags('archive')
@Controller()
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  @Public()
  @SkipThrottle()
  @Get('recordings')
  @Header('Cache-Control', 'public, max-age=60')
  recordings(@Query(new ZodPipe(recordingsQuerySchema)) q: RecordingsQuery): Promise<RecordingsDto> {
    return this.archive.recordings(q);
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
