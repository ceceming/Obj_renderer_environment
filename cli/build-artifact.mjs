#!/usr/bin/env node
/**
 * Repackage the built app as a single hosted page.
 *
 * Some hosts (a published Artifact, for one) supply their own document
 * skeleton and expect only the page's contents — a title, styles, markup and
 * scripts — rather than a full HTML document. This rewrites `dist/index.html`
 * into that shape and copies the hashed assets alongside it, so the same build
 * can be served either way.
 *
 *   npm run build && node cli/build-artifact.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'dist-artifact');

const html = readFileSync(join(DIST, 'index.html'), 'utf8');

const script = html.match(/<script[^>]*src="\.\/(assets\/[^"]+)"/)?.[1];
const style = html.match(/<link[^>]*rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+)"/)?.[1];
const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1]?.trim();

if (!script || !style || !body) {
  console.error('Could not parse dist/index.html — run `npm run build` first.');
  process.exit(1);
}

const page = `<title>OBJ Render Studio</title>
<link rel="stylesheet" href="${style}">
<style>
  /* The host supplies its own reset, including safe-area padding on :root and
     a light background on body. This is a full-bleed application, so both are
     cleared and the layout is pinned to the visual viewport instead. */
  :root { padding: 0 !important; color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #0d0e11; overflow: hidden; }
  #app { height: 100dvh; }
</style>

${body}

<script type="module" src="${script}"></script>
`;

mkdirSync(join(OUT, 'assets'), { recursive: true });
writeFileSync(join(OUT, 'page.html'), page);

const assets = readdirSync(join(DIST, 'assets'));
for (const file of assets) copyFileSync(join(DIST, 'assets', file), join(OUT, 'assets', file));

const files = Object.fromEntries(assets.map((f) => [`assets/${f}`, `dist-artifact/assets/${f}`]));
writeFileSync(join(OUT, 'files.json'), JSON.stringify(files, null, 2));

console.log(`  page     dist-artifact/page.html`);
console.log(`  entry    ${script}`);
console.log(`  assets   ${assets.length} files`);
console.log(`  map      dist-artifact/files.json`);
