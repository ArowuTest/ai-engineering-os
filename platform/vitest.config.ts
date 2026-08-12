import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    // Windows/Docker schema resets can occasionally cross 10s. If a reset hook
    // times out, its uncancelled DDL can overlap the next test and corrupt the
    // suite state. Keep a finite but realistic ceiling for DB-backed tests.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});