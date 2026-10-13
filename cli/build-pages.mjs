#!/usr/bin/env node
/**
 * Copy the build into the repository root, so GitHub Pages can serve this
 * repository directly from a branch.
 *
 * Branch deployment publishes the repository root as the site root, and will
 * only serve what is committed — it runs no build. The alternative, deploying
 * through the Actions workflow, needs the repository's Pages source set to
 * "GitHub Actions"; this route needs no settings at all, at the cost of
 * carrying the build in version control.
 *
 * Because of that cost, the committed copy can fall behind the source. Run this
 * after any change you want published:
 *
 *   npm run build:pages
 *
 * then commit the result. `npm run check:pages` reports whether what is
 * committed still matches what the source builds.
 */

import { readdirSync, rmSync, mkdirSync, copyFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

if (!existsSync(join(DIST, 'app.html'))) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

// The built entry becomes the site's index.html.
copyFileSync(join(DIST, 'app.html'), join(ROOT, 'index.html'));

// Replace assets wholesale: filenames are content-hashed, so leftovers from an
// earlier build would otherwise accumulate for ever.
const assetsOut = join(ROOT, 'assets');
rmSync(assetsOut, { recursive: true, force: true });
mkdirSync(assetsOut, { recursive: true });

const assets = readdirSync(join(DIST, 'assets'));
for (const file of assets) copyFileSync(join(DIST, 'assets', file), join(assetsOut, file));

// Without this, GitHub runs the published files through Jekyll, which ignores
// anything whose name begins with an underscore.
writeFileSync(join(ROOT, '.nojekyll'), '');

const bytes = assets.reduce((n, f) => n + statSync(join(assetsOut, f)).size, 0)
  + statSync(join(ROOT, 'index.html')).size;

console.log('  index.html   <- dist/app.html');
console.log(`  assets/      <- ${assets.length} files`);
console.log(`  .nojekyll    written`);
console.log(`  total        ${(bytes / 1024 / 1024).toFixed(2)} MB committed`);
console.log('\n  Commit these to refresh the fallback copy served if Pages ever deploys from a branch.');
