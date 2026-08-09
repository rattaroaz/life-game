import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Prevent Vite from clearing the terminal so Tauri cargo logs stay visible
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Prefer 127.0.0.1 for Tauri webview reliability on Windows
    host: host || '127.0.0.1',
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : { protocol: 'ws', host: '127.0.0.1', port: 1420 },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  resolve: {
    alias: {
      '@lifesim/sim': path.resolve(__dirname, '../../packages/sim/src'),
      '@lifesim/content': path.resolve(__dirname, '../../packages/content/src'),
      '@lifesim/render': path.resolve(__dirname, '../../packages/render/src'),
      '@lifesim/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'esnext',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
