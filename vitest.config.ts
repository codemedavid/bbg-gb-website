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
    // Every integration file's beforeEach applies the whole migration set to a
    // fresh in-memory Postgres and truncates it. That is comfortably under a
    // second alone, but the files run in parallel and the slowest of them
    // crossed vitest's 10s default under load — producing "Hook timed out"
    // failures that moved between files run to run and passed in isolation.
    // Raised rather than papered over with retries: a flaky suite that has to be
    // re-run is a suite nobody trusts.
    hookTimeout: 60_000,
    testTimeout: 30_000,
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
