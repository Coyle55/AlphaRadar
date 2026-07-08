import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    passWithNoTests: true,
    // DB-backed test files (tokens.test.ts, route.test.ts) share one real
    // Postgres instance and each truncate the same tables in beforeEach.
    // Running test files in parallel races those truncations against
    // concurrent inserts in other files, causing intermittent FK violations
    // and row-count mismatches. Force file-level sequencing so DB state
    // stays consistent within each file's test run.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
