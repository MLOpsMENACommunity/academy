import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  adminTransitionSchema,
  applicationFilterSchema,
  bulkTransitionSchema,
  certificateRuleSchema,
  courseInputSchema,
  inviteApplySchema,
  invitePreviewSchema,
  issueCertificatesSchema,
  reissueCertificateSchema,
  revokeCertificateSchema,
  sessionInputSchema,
  sessionOrderSchema,
  sessionsBulkSchema,
  waitlistNotifySchema,
  type AdminTransitionInput,
  type ApplicationFilter,
  type CertificateRuleInput,
  type CourseInput,
  type InviteApplyInput,
  type InvitePreviewInput,
  type IssueCertificatesInput,
  type RevokeCertificateInput,
  type SessionInput,
  type WaitlistNotifyInput,
} from '@academy/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { AdminApplicationsService } from '../admin/admin-applications.service';
import { AdminCoursesService } from '../admin/admin-courses.service';
import { CertificatesService } from '../certificates/certificates.service';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CourseAccessService } from '../course-access/course-access.service';
import { CourseCan, CoursePermissionGuard } from '../course-access/course-permission.guard';
import { InvitesService } from '../invites/invites.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { TeachManageService } from './teach-manage.service';
import { TeachingService } from './teaching.service';

const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

function sendCsv(res: Response, name: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(csv);
}

/**
 * Teaching → {course}: running the course, for staff whose role allows it (@CourseCan, checked
 * by CoursePermissionGuard on every request). Each route reuses the admin service with the
 * route's course: lists are that course's only, and an application, session, invite, waiting
 * list entry or certificate id of another course is a 404. Audited like the admin actions, with
 * the staff member as the actor.
 */
@ApiTags('teach')
@UseGuards(CoursePermissionGuard)
@Controller('teach/courses')
export class TeachManageController {
  constructor(
    private readonly teaching: TeachingService,
    private readonly manage: TeachManageService,
    private readonly courses: AdminCoursesService,
    private readonly applications: AdminApplicationsService,
    private readonly invites: InvitesService,
    private readonly waitlist: WaitlistService,
    private readonly certificates: CertificatesService,
    private readonly access: CourseAccessService,
  ) {}

  // ------------------------------------------------------------------ roster (VIEW_ROSTER)

  @Get(':courseId/roster')
  @CourseCan('VIEW_ROSTER')
  @Header('Cache-Control', 'private, no-store')
  roster(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string) {
    return this.teaching.roster(courseId, user);
  }

  // ------------------------------------------------------------------ details (EDIT_COURSE)

  @Get(':courseId/details')
  @CourseCan('EDIT_COURSE')
  @Header('Cache-Control', 'private, no-store')
  details(@Param('courseId') courseId: string) {
    return this.courses.get(courseId);
  }

  /** Status, address, price and who teaches stay as they are (AdminCoursesService.updateAsStaff). */
  @Put(':courseId/details')
  @CourseCan('EDIT_COURSE')
  @Throttle(WRITE_LIMIT)
  saveDetails(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(courseInputSchema)) body: CourseInput) {
    return this.courses.updateAsStaff(courseId, body, user);
  }

  // ------------------------------------------------------------------ sessions (MANAGE_SESSIONS)

  @Get(':courseId/sessions')
  @CourseCan('MANAGE_SESSIONS')
  @Header('Cache-Control', 'private, no-store')
  async sessions(@Param('courseId') courseId: string) {
    return (await this.courses.get(courseId)).sessions;
  }

  @Post(':courseId/sessions')
  @CourseCan('MANAGE_SESSIONS')
  @Throttle(WRITE_LIMIT)
  createSession(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(sessionInputSchema)) body: SessionInput) {
    return this.courses.createSession(courseId, body, user);
  }

  @Post(':courseId/sessions/bulk')
  @CourseCan('MANAGE_SESSIONS')
  @Throttle(WRITE_LIMIT)
  createSessions(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(sessionsBulkSchema)) body: z.infer<typeof sessionsBulkSchema>) {
    return this.courses.createSessions(courseId, body.sessions, user);
  }

  /** Ids of other courses are ignored (the update is scoped to this course). */
  @Put(':courseId/sessions/order')
  @CourseCan('MANAGE_SESSIONS')
  @Throttle(WRITE_LIMIT)
  async reorderSessions(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(sessionOrderSchema)) body: { ids: string[] }) {
    const list = await this.courses.reorderSessions(courseId, body.ids);
    await this.manage.auditReorder(courseId, user, body.ids);
    return list;
  }

  @Put(':courseId/sessions/:sessionId')
  @CourseCan('MANAGE_SESSIONS')
  @Throttle(WRITE_LIMIT)
  updateSession(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('sessionId') sessionId: string, @Body(new ZodPipe(sessionInputSchema)) body: SessionInput) {
    return this.courses.updateSession(courseId, sessionId, body, user);
  }

  @Delete(':courseId/sessions/:sessionId')
  @CourseCan('MANAGE_SESSIONS')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  async deleteSession(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('sessionId') sessionId: string): Promise<void> {
    await this.courses.deleteSession(courseId, sessionId, user);
  }

  // ------------------------------------------------------------------ applications (MANAGE_APPLICATIONS)

  @Get(':courseId/applications')
  @CourseCan('MANAGE_APPLICATIONS')
  @Header('Cache-Control', 'private, no-store')
  listApplications(@Param('courseId') courseId: string, @Query(new ZodPipe(applicationFilterSchema)) f: ApplicationFilter) {
    return this.applications.list({ ...f, courseId });
  }

  @Get(':courseId/applications.csv')
  @CourseCan('MANAGE_APPLICATIONS')
  @Throttle(WRITE_LIMIT)
  async exportApplications(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Query(new ZodPipe(applicationFilterSchema)) f: ApplicationFilter, @Res() res: Response) {
    sendCsv(res, 'applications', await this.applications.exportCsv({ ...f, courseId }, user));
  }

  @Post(':courseId/applications/bulk')
  @CourseCan('MANAGE_APPLICATIONS')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  bulk(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(bulkTransitionSchema)) body: z.infer<typeof bulkTransitionSchema>) {
    return this.manage.bulk(courseId, body.ids, body.event, user, body.reason);
  }

  @Get(':courseId/applications/:id')
  @CourseCan('MANAGE_APPLICATIONS')
  @Header('Cache-Control', 'private, no-store')
  application(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('id') id: string) {
    return this.manage.applicationDetail(courseId, id, user);
  }

  @Post(':courseId/applications/:id/transition')
  @CourseCan('MANAGE_APPLICATIONS')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  transition(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('id') id: string, @Body(new ZodPipe(adminTransitionSchema)) body: AdminTransitionInput) {
    return this.manage.transition(courseId, id, body.event, user, body.reason);
  }

  // ------------------------------------------------------------------ enrolment (ENROL): by email, invites, waiting list

  @Get(':courseId/invites')
  @CourseCan('ENROL')
  @Header('Cache-Control', 'private, no-store')
  invitesList(@Param('courseId') courseId: string) {
    return this.invites.list(courseId);
  }

  @Get(':courseId/invites/export.csv')
  @CourseCan('ENROL')
  @Throttle(WRITE_LIMIT)
  async invitesCsv(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Res() res: Response) {
    sendCsv(res, 'course-invites', await this.invites.csv(courseId, user));
  }

  @Post(':courseId/invites/preview')
  @CourseCan('ENROL')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  invitesPreview(@Param('courseId') courseId: string, @Body(new ZodPipe(invitePreviewSchema)) body: InvitePreviewInput) {
    return this.invites.preview(courseId, body);
  }

  @Post(':courseId/invites')
  @CourseCan('ENROL')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async invitesApply(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(inviteApplySchema)) body: InviteApplyInput) {
    // A paid course: enrolling or inviting by email waives the payment (SUPER and ADMISSIONS admins only).
    await this.access.assertMayEnrolByEmail(user, courseId, body.skipPayment);
    return this.invites.apply(courseId, body, user);
  }

  @Post(':courseId/invites/:inviteId/resend')
  @CourseCan('ENROL')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  inviteResend(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('inviteId') inviteId: string) {
    return this.invites.resend(courseId, inviteId, user);
  }

  @Post(':courseId/invites/:inviteId/revoke')
  @CourseCan('ENROL')
  @HttpCode(200)
  @Throttle(WRITE_LIMIT)
  inviteRevoke(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('inviteId') inviteId: string) {
    return this.invites.revoke(courseId, inviteId, user);
  }

  @Get(':courseId/waitlist')
  @CourseCan('ENROL')
  @Header('Cache-Control', 'private, no-store')
  waitlistList(@Param('courseId') courseId: string) {
    return this.waitlist.list(courseId);
  }

  @Get(':courseId/waitlist/export.csv')
  @CourseCan('ENROL')
  @Throttle(WRITE_LIMIT)
  async waitlistCsv(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Res() res: Response) {
    sendCsv(res, 'waiting-list', await this.waitlist.csv(courseId, user));
  }

  @Post(':courseId/waitlist/notify')
  @CourseCan('ENROL')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  waitlistNotify(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(waitlistNotifySchema)) body: WaitlistNotifyInput) {
    return this.waitlist.notify(courseId, body, user);
  }

  @Delete(':courseId/waitlist/:entryId')
  @CourseCan('ENROL')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  async waitlistRemove(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Param('entryId') entryId: string): Promise<void> {
    await this.waitlist.remove(courseId, entryId, user);
  }

  // ------------------------------------------------------------------ certificates (ISSUE_CERTIFICATES)

  @Get(':courseId/certificates')
  @CourseCan('ISSUE_CERTIFICATES')
  @Header('Cache-Control', 'private, no-store')
  certificatesRoster(@Param('courseId') courseId: string) {
    return this.certificates.roster(courseId);
  }

  @Put(':courseId/certificate-rule')
  @CourseCan('ISSUE_CERTIFICATES')
  @Throttle(WRITE_LIMIT)
  certificateRule(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(certificateRuleSchema)) body: CertificateRuleInput) {
    return this.certificates.setRule(courseId, body, user);
  }

  @Post(':courseId/certificates')
  @CourseCan('ISSUE_CERTIFICATES')
  @Throttle(WRITE_LIMIT)
  issueCertificates(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body(new ZodPipe(issueCertificatesSchema)) body: IssueCertificatesInput) {
    return this.certificates.issueBulk(courseId, body, user);
  }

  @Get(':courseId/certificates.csv')
  @CourseCan('ISSUE_CERTIFICATES')
  @Throttle(WRITE_LIMIT)
  async certificatesCsv(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Res() res: Response): Promise<void> {
    sendCsv(res, 'certificates', await this.certificates.rosterCsv(courseId, user));
  }

  @Post(':courseId/certificates/:certificateId/revoke')
  @CourseCan('ISSUE_CERTIFICATES')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  async revokeCertificate(
    @CurrentUser() user: AuthUser,
    @Param('courseId') courseId: string,
    @Param('certificateId') certificateId: string,
    @Body(new ZodPipe(revokeCertificateSchema)) body: RevokeCertificateInput,
  ): Promise<void> {
    await this.manage.assertCertificateInCourse(courseId, certificateId);
    await this.certificates.revoke(certificateId, body.reason, user);
  }

  @Post(':courseId/certificates/:certificateId/reissue')
  @CourseCan('ISSUE_CERTIFICATES')
  @HttpCode(204)
  @Throttle(WRITE_LIMIT)
  async reissueCertificate(
    @CurrentUser() user: AuthUser,
    @Param('courseId') courseId: string,
    @Param('certificateId') certificateId: string,
    @Body(new ZodPipe(reissueCertificateSchema)) body: z.infer<typeof reissueCertificateSchema>,
  ): Promise<void> {
    await this.manage.assertCertificateInCourse(courseId, certificateId);
    await this.certificates.reissue(certificateId, body.grade, user);
  }
}
