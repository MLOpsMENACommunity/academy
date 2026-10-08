import { Injectable } from '@nestjs/common';
import { DEFAULT_SETTINGS, settingsSchema, settingsUpdateSchema, type Settings, type SettingsUpdate } from '@academy/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Admin-editable platform settings (payment details, windows, retention), one row per key. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<Settings> {
    const rows = await this.prisma.setting.findMany();
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    // Unknown or invalid stored values fall back to defaults instead of breaking pages.
    const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...stored });
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
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
