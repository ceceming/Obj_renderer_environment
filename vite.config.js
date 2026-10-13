import { defineConfig } from 'vite';

/**
 * In development the app is entered through `app.html`, not `index.html`.
 *
 * `index.html` at the repository root is the *built* page, committed so that
 * GitHub Pages can serve this repository directly from a branch — that mode
 * publishes the root as the site root, and needs a working index.html there.
 * The two would collide, so the source entry moves aside and `/` is redirected
 * to it while developing.
 */
const devEntryRedirect = {
  name: 'dev-entry-redirect',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(302, { Location: '/app.html' });
        res.end();
        return;
      }
      next();
    });
  }
};

export default defineConfig({
  plugins: [devEntryRedirect],
  base: './',
  server: { host: '127.0.0.1', port: 5173, fs: { allow: ['..'] } },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: {
        main: 'app.html',
        headless: 'headless.html'
      }
    }
  },
  optimizeDeps: { include: ['three'] }
});
