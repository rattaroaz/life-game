import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@lifesim/sim': path.resolve(__dirname, '../sim/src'),
      '@lifesim/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
});
