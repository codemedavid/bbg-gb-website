import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
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
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/db/seed.ts', 'src/db/data/**', 'src/test/**', 'src/db/migrations/**'],
    },
  },
});
