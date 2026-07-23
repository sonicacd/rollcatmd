import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    strictPort: true
  },
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900
  }
});
