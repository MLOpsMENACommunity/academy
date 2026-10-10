import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import {
  certificateRuleSchema,
  issueCertificatesSchema,
  reissueCertificateSchema,
  revokeCertificateSchema,
  type CertificateRuleInput,
  type IssueCertificatesInput,
  type RevokeCertificateInput,
} from '@academy/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, Public, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CertificatesService } from './certificates.service';

/** Streams a PDF: never cached by browsers or the edge (a revocation must take effect at once). */
function sendPdf(res: Response, pdf: { filename: string; body: Buffer }): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
  res.setHeader('Content-Length', String(pdf.body.length));
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf.body);
}

/** Students and the public: my certificates, the learn page card, verification and downloads. */
@ApiTags('certificates')
@Controller()
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get('me/certificates')
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: AuthUser) {
    return this.certificates.mine(user.id);
  }

  @Get('me/certificates/:serial/pdf')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async myPdf(@CurrentUser() user: AuthUser, @Param('serial') serial: string, @Res() res: Response): Promise<void> {
    sendPdf(res, await this.certificates.myPdf(user.id, serial));
  }

  @Get('learn/:slug/certificate')
  @Header('Cache-Control', 'private, no-store')
  learn(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.certificates.forLearner(user, slug);
  }

  /**
   * The public verification page's data. Not edge-cached (not in PUBLIC_CACHE_ROUTES) and
   * no-store, so a revocation shows at once. Serials are unguessable; lookups are rate-limited.
   */
  @Public()
  @Get('certificates/:serial')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  view(@Param('serial') serial: string) {
    return this.certificates.publicView(serial);
  }

  @Public()
  @Get('certificates/:serial/pdf')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async publicPdf(@Param('serial') serial: string, @Res() res: Response): Promise<void> {
    sendPdf(res, await this.certificates.publicPdf(serial));
  }
}

/** Admin: the course's Certificates tab. */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin')
export class AdminCertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get('courses/:id/certificates')
  roster(@Param('id') id: string) {
    return this.certificates.roster(id);
  }

  @Put('courses/:id/certificate-rule')
  rule(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(certificateRuleSchema)) body: CertificateRuleInput) {
    return this.certificates.setRule(id, body, user);
  }

  @Post('courses/:id/certificates')
  issue(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(issueCertificatesSchema)) body: IssueCertificatesInput) {
    return this.certificates.issueBulk(id, body, user);
  }

  @Get('courses/:id/certificates.csv')
  async csv(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const csv = await this.certificates.rosterCsv(id, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="certificates-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(csv);
  }

  @Post('certificates/:id/revoke')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(revokeCertificateSchema)) body: RevokeCertificateInput): Promise<void> {
    await this.certificates.revoke(id, body.reason, user);
  }

  @Post('certificates/:id/reissue')
  @HttpCode(204)
  async reissue(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(reissueCertificateSchema)) body: z.infer<typeof reissueCertificateSchema>): Promise<void> {
    await this.certificates.reissue(id, body.grade, user);
  }
}
