import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { clientFunnelEventSchema, type ClientFunnelEvent } from '@academy/shared';
import { Public, type AuthedRequest } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { FunnelService } from './funnel.service';

/**
 * Top-of-funnel events only the browser can see (page views, clicks). Later
 * steps (application submitted, shortlisted, paid, enrolled) are recorded by
 * the server when they happen.
 */
@ApiTags('funnel')
@Controller('funnel')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class FunnelController {
  constructor(private readonly funnel: FunnelService) {}

  @Public()
  @Post('events')
  @HttpCode(204)
  async record(
    @Body(new ZodPipe(clientFunnelEventSchema)) body: ClientFunnelEvent,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    await this.funnel.record({ slug: body.courseSlug }, body.event, {
      userId: req.user?.id ?? null,
      anonymousId: body.anonymousId ?? null,
    });
  }
}
