import { defineConfig } from 'prisma/config';

// A config file disables Prisma's automatic .env loading, so load it here (local dev only).
try {
  process.loadEnvFile();
} catch {
  // no .env: env comes from the environment
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
