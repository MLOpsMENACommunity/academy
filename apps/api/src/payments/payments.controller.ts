import { Body, Controller, Get, HttpCode, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  approvePaymentSchema,
  PAYMENT_STATUSES,
  rejectPaymentSchema,
  type AdminPaymentDto,
  type MyPaymentDto,
  type PaymentInstructionsDto,
  type PaymentStatus,
} from '@academy/shared';
import { z } from 'zod';
import { AdminCan, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { MAX_UPLOAD_BYTES } from '../storage/file-type';
import { PaymentsService } from './payments.service';

const queueQuerySchema = z.object({
  status: z.enum(PAYMENT_STATUSES).default('PENDING_REVIEW'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // ------------------------------------------------------------------ student

  @Get('me/applications/:id/payment-instructions')
  instructions(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<PaymentInstructionsDto> {
    return this.payments.instructions(user.id, id);
  }

  @Get('me/applications/:id/payments')
  listMine(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<MyPaymentDto[]> {
    return this.payments.listMine(user.id, id);
  }

  @Post('me/applications/:id/payments')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('screenshot', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } }))
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<MyPaymentDto> {
    return this.payments.submit(user, id, body, file);
  }

  // ------------------------------------------------------------------ admin

  @Roles('ADMIN')
  @AdminCan('FINANCE')
  @Get('admin/payments')
  queue(@Query(new ZodPipe(queueQuerySchema)) q: { status: PaymentStatus; page: number }): Promise<AdminPaymentDto[]> {
    return this.payments.queue(q.status, q.page);
  }

  @Roles('ADMIN')
  @AdminCan('FINANCE')
  @Get('admin/payments-count')
  async count(@Query(new ZodPipe(queueQuerySchema)) q: { status: PaymentStatus }): Promise<{ count: number }> {
    return { count: await this.payments.count(q.status) };
  }

  @Roles('ADMIN')
  @AdminCan('FINANCE')
  @Get('admin/payments/:id')
  get(@Param('id') id: string): Promise<AdminPaymentDto> {
    return this.payments.adminGet(id);
  }

  @Roles('ADMIN')
  @AdminCan('FINANCE')
  @Get('admin/payments/:id/screenshot')
  screenshot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.screenshotUrl(id, user);
  }

  @Roles('ADMIN')
  @AdminCan('FINANCE')
  @Post('admin/payments/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(approvePaymentSchema)) body: z.infer<typeof approvePaymentSchema>,
  ): Promise<AdminPaymentDto> {
    return this.payments.approve(id, user, body.verifiedInHistory);
  }

  @Roles('ADMIN')
  @AdminCan('FINANCE')
  @Post('admin/payments/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(rejectPaymentSchema)) body: z.infer<typeof rejectPaymentSchema>,
  ): Promise<AdminPaymentDto> {
    return this.payments.reject(id, user, body.reason);
  }
}
