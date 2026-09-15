import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: {
        main: 'index.html',
        headless: 'headless.html'
      }
    }
  },
  optimizeDeps: { include: ['three'] }
});
