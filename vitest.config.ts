import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Pin the root so `npm test` collects the same files from any cwd.
  root: dir('.'),
  // tsconfig sets jsx:"preserve" because Next owns the real transform; vitest
  // has to compile JSX itself, so opt into the automatic runtime here.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // Mirrors the "@/*" path mapping in tsconfig.json.
      '@': dir('.'),
      // Route handlers pull in `server-only`, which throws outside a Next request.
      'server-only': dir('./lib/test/server-only-stub.ts'),
    },
  },
  test: {
    // Route/integration tests run in node (they touch PGlite, fs, Request).
    // Component tests opt into a DOM via the .tsx glob below.
    environment: 'node',
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['./lib/test/setup-dom.ts'],
    globals: true,
    include: ['{app,lib,components}/**/*.test.{ts,tsx}'],
    // Isolated in-memory Postgres per test file; never touch the dev ./.pglite or a real DB.
    env: {
      DATABASE_URL: '',
      PGLITE_PATH: 'memory://',
      JWT_SECRET: 'test-secret',
      STORAGE_DRIVER: 'local',
      SMTP_HOST: '',
    },
    coverage: {
      reporter: ['text', 'html'],
      include: ['{app,lib,components}/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', 'lib/test/**', 'lib/db/data/**', 'scripts/**'],
    },
  },
});
