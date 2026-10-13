import { defineConfig } from 'vite';
import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname_ = dirname(fileURLToPath(import.meta.url));

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

/**
 * The built entry is `app.html`, because the repository root keeps `index.html`
 * for the committed site. A host serving `dist/` directly — GitHub Pages via
 * Actions, say — still asks for `/`, so emit `index.html` alongside it. Without
 * this the deployment looks healthy and every visitor gets a 404.
 */
const emitIndexAlias = {
  name: 'emit-index-alias',
  apply: 'build',
  closeBundle() {
    const dist = resolve(__dirname_, 'dist');
    const entry = join(dist, 'app.html');
    if (existsSync(entry)) copyFileSync(entry, join(dist, 'index.html'));
  }
};

export default defineConfig({
  plugins: [devEntryRedirect, emitIndexAlias],
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
