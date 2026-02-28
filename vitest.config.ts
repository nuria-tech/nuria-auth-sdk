import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/core/types.ts'],
      thresholds: {
        lines: 70,
        functions: 90,
        branches: 60,
        statements: 70,
      },
    },
  },
});
