import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  changeEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
  PROFILE_SECTIONS,
  updateAccountSchema,
  type ProfileDto,
  type ProfileSection,
} from '@academy/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { clearAuthCookies } from '../auth/cookies';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { Inject } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { MAX_UPLOAD_BYTES } from '../storage/file-type';
import { AccountService } from './account.service';
import { ProfileService } from './profile.service';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly account: AccountService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthUser): Promise<ProfileDto> {
    return this.profiles.get(user.id);
  }

  @Put('profile/:section')
  updateSection(
    @CurrentUser() user: AuthUser,
    @Param('section') section: string,
    @Body() body: unknown,
  ): Promise<ProfileDto> {
    if (!(PROFILE_SECTIONS as readonly string[]).includes(section)) {
      throw new BadRequestException('Unknown profile section');
    }
    return this.profiles.updateSection(user.id, section as ProfileSection, body);
  }

  @Post('profile/cv')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  uploadCv(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File): Promise<ProfileDto> {
    return this.profiles.uploadCv(user.id, file);
  }

  @Delete('profile/cv')
  deleteCv(@CurrentUser() user: AuthUser): Promise<ProfileDto> {
    return this.profiles.deleteCv(user.id);
  }

  @Patch('account')
  async updateAccount(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(updateAccountSchema)) body: z.infer<typeof updateAccountSchema>,
  ): Promise<{ ok: true }> {
    await this.account.setLocale(user.id, body.locale);
    return { ok: true };
  }

  @Post('password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.account.changePassword(user.id, body.currentPassword, body.newPassword);
    // All sessions were revoked; the user signs in again with the new password.
    clearAuthCookies(res, this.env);
    return { ok: true };
  }

  @Post('email')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changeEmail(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changeEmailSchema)) body: z.infer<typeof changeEmailSchema>,
  ): Promise<{ ok: true }> {
    await this.account.requestEmailChange(user.id, body.newEmail, body.password);
    return { ok: true };
  }

  @Delete('email')
  async cancelEmailChange(@CurrentUser() user: AuthUser): Promise<{ ok: true }> {
    await this.account.cancelEmailChange(user.id);
    return { ok: true };
  }

  @Get('export')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="mlops-mena-academy-data.json"')
  @Header('Cache-Control', 'no-store')
  export(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.account.export(user.id);
  }

  @Post('delete')
  @HttpCode(200)
  async deleteAccount(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(deleteAccountSchema)) body: z.infer<typeof deleteAccountSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.account.deleteAccount(user.id, body.password);
    clearAuthCookies(res, this.env);
    return { ok: true };
  }
}
