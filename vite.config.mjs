import { defineConfig } from 'vite';

const mobileDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  base: './',
  clearScreen: false,
  server: {
    host: mobileDevHost || '127.0.0.1',
    port: 1420,
    hmr: mobileDevHost
      ? {
          protocol: 'ws',
          host: mobileDevHost,
          port: 1421
        }
      : undefined,
    strictPort: true
  },
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900
  }
});
