import { Body, Controller, Get, Header, HttpCode, NotFoundException, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { emailOptOutTokenSchema, type EmailOptOutDto } from '@academy/shared';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { EmailPreferenceLinks } from './email-links';

/** A bad, tampered or stale link: one answer for all of them. */
const invalid = () => new NotFoundException({ code: 'INVALID_LINK', message: 'This link is not valid' });

/**
 * The tokened per-course unsubscribe links in feedback emails and publish notices. No
 * sign-in: the signature is the authorisation, and it only ever turns emails off (or back
 * on) for the one student and course it names.
 */
@ApiTags('email')
@Controller('email/unsubscribe')
export class EmailPreferencesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: EmailPreferenceLinks,
  ) {}

  private async resolve(raw: unknown): Promise<{ kind: 'feedback' | 'reminders'; userId: string; course: EmailOptOutDto['course'] & { id: string } }> {
    const parsed = emailOptOutTokenSchema.safeParse({ token: raw });
    const t = parsed.success ? this.links.verify(parsed.data.token) : null;
    if (!t) throw invalid();
    const [user, course] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: t.userId }, select: { deletedAt: true } }),
      this.prisma.course.findUnique({ where: { id: t.courseId }, select: { id: true, slug: true, titleEn: true, titleAr: true } }),
    ]);
    if (!user || user.deletedAt || !course) throw invalid();
    return { kind: t.kind, userId: t.userId, course };
  }

  private async state(kind: 'feedback' | 'reminders', userId: string, course: EmailOptOutDto['course'] & { id: string }): Promise<EmailOptOutDto> {
    const pref = await this.prisma.reminderPreference.findUnique({ where: { userId_courseId: { userId, courseId: course.id } } });
    const subscribed = kind === 'feedback' ? (pref?.feedbackEmails ?? true) : (pref?.emailReminders ?? true);
    return { kind, course: { slug: course.slug, titleEn: course.titleEn, titleAr: course.titleAr }, subscribed };
  }

  private async set(raw: unknown, on: boolean): Promise<EmailOptOutDto> {
    const { kind, userId, course } = await this.resolve(raw);
    const field = kind === 'feedback' ? { feedbackEmails: on } : { emailReminders: on };
    await this.prisma.reminderPreference.upsert({
      where: { userId_courseId: { userId, courseId: course.id } },
      update: field,
      create: { userId, courseId: course.id, ...field },
    });
    return this.state(kind, userId, course);
  }

  /** What a link turns off, and whether it already is. Changes nothing: mail scanners open links. */
  @Public()
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async peek(@Query('token') token: unknown): Promise<EmailOptOutDto> {
    const { kind, userId, course } = await this.resolve(token);
    return this.state(kind, userId, course);
  }

  /**
   * Turns the emails off. Mail apps' one-click unsubscribe (RFC 8058) POSTs here with the token
   * in the query string and "List-Unsubscribe=One-Click" as a form body (not parsed); the page
   * sends `{ token }` as JSON.
   */
  @Public()
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  unsubscribe(@Query('token') qToken: unknown, @Body() body: unknown): Promise<EmailOptOutDto> {
    return this.set(qToken ?? (body as { token?: unknown } | undefined)?.token, false);
  }

  /** "Turn them back on", from the same page. */
  @Public()
  @Post('undo')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resubscribe(@Body() body: unknown): Promise<EmailOptOutDto> {
    return this.set((body as { token?: unknown } | undefined)?.token, true);
  }
}
