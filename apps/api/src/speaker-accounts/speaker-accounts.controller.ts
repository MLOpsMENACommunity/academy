import { Body, Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { speakerAccountSchema, type SpeakerAccountInput } from '@academy/shared';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { SpeakerAccountsService } from './speaker-accounts.service';

/** Admin → Speakers → {speaker} → Account: invite or link the account that signs in as this speaker. */
@ApiTags('admin')
@Roles('ADMIN')
@AdminCan('SPEAKERS')
@Controller('admin/instructors/:id/account')
export class SpeakerAccountsController {
  constructor(private readonly speakers: SpeakerAccountsService) {}

  // A new address is emailed: keep the loop short.
  @Post()
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  invite(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(speakerAccountSchema)) body: SpeakerAccountInput) {
    return this.speakers.invite(id, body, user.id);
  }

  @Delete()
  @HttpCode(204)
  async unlink(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.speakers.unlink(id, user.id);
  }
}
