import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { settingsUpdateSchema, type Settings, type SettingsUpdate } from '@academy/shared';
import { CurrentUser, Public, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Support contacts shown on public pages (contact page, payment help). */
  @Public()
  @SkipThrottle()
  @Get('settings/public')
  async publicSettings(): Promise<Pick<Settings, 'supportEmail' | 'supportWhatsapp'>> {
    const s = await this.settings.get();
    return { supportEmail: s.supportEmail, supportWhatsapp: s.supportWhatsapp };
  }

  @Roles('ADMIN')
  @Get('admin/settings')
  get(): Promise<Settings> {
    return this.settings.get();
  }

  @Roles('ADMIN')
  @Put('admin/settings')
  update(@CurrentUser() user: AuthUser, @Body(new ZodPipe(settingsUpdateSchema)) body: SettingsUpdate): Promise<Settings> {
    return this.settings.update(body, user.id);
  }
}
