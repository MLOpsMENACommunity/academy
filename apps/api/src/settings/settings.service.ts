import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_SETTINGS,
  settingsSchema,
  settingsUpdateSchema,
  type SettingKey,
  type Settings,
  type SettingsUpdate,
} from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Admin-editable platform settings (payment details, windows, retention), one row per key. */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<Settings> {
    const rows = await this.prisma.setting.findMany();
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    // Each key is validated on its own: one bad value falls back to its default
    // (and is logged) instead of resetting every setting.
    for (const row of rows) {
      const field = settingsSchema.shape[row.key as SettingKey];
      if (!field) continue;
      const parsed = field.safeParse(row.value);
      if (parsed.success) out[row.key] = parsed.data;
      else this.logger.warn(`Invalid stored setting "${row.key}"; using the default`);
    }
    return out as Settings;
  }

  async update(patch: SettingsUpdate, actorId: string): Promise<Settings> {
    const data = settingsUpdateSchema.parse(patch);
    const entries = Object.entries(data).filter(([, v]) => v !== undefined);
    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { key },
          update: { value: value as Prisma.InputJsonValue },
          create: { key, value: value as Prisma.InputJsonValue },
        }),
      ),
    );
    await this.audit.log({
      actorId,
      action: 'settings.updated',
      entityType: 'Setting',
      metadata: { keys: entries.map(([k]) => k) },
    });
    return this.get();
  }
}
