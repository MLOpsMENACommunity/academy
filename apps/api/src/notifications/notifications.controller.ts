import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { NotificationsService } from './notifications.service';

/** In-app notifications. The web app polls /unread-count; no Firebase, no websockets. */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.list(user.id);
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthUser): Promise<{ unread: number }> {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<{ ok: true }> {
    await this.notifications.markRead(user.id, id);
    return { ok: true };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser): Promise<{ ok: true }> {
    await this.notifications.markAllRead(user.id);
    return { ok: true };
  }
}
