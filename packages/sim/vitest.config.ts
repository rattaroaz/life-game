import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@lifesim/shared': path.resolve(__dirname, '../shared/src'),
      '@lifesim/content': path.resolve(__dirname, '../content/src'),
    },
  },
});
