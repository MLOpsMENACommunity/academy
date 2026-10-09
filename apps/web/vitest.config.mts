import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Pages are TSX (tsconfig keeps JSX for Next): compile it for the page tests.
  esbuild: { jsx: 'automatic' },
  test: { include: ['src/**/*.test.ts'] },
});
