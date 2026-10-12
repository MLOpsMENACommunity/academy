/* eslint-disable no-console */
import '../src/load-env';
import { PrismaClient, type Prisma } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { DEFAULT_SETTINGS } from '@academy/shared';
import { seedCatalog } from './seed-catalog';
import { seedCourses } from './seed-data';

/** Idempotent: safe to run on every start (admin, default settings, catalog; see seed-catalog.ts). */
const prisma = new PrismaClient();

async function seedAdmin(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set; skipping admin user');
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Never promote an existing account: someone could have registered the admin email first.
    if (existing.role !== 'ADMIN') {
      console.warn(`WARNING: ${email} exists but is not an admin; NOT promoting it. Resolve manually.`);
    }
    return;
  }
  const passwordHash = await hash(password);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: 'ADMIN',
      // The first admin manages the team (Admin → Team), so it is a super admin.
      adminPermissions: ['SUPER'],
      emailVerifiedAt: new Date(),
      profile: { create: { fullNameEn: 'Academy Admin' } },
    },
  });
  console.log(`Admin ready: ${email}`);
}

async function seedSettings(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as Prisma.InputJsonValue },
    });
  }
}

async function main(): Promise<void> {
  await seedAdmin();
  await seedSettings();
  await seedCatalog(prisma, seedCourses);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
