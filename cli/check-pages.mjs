#!/usr/bin/env node
/**
 * Is the committed site still what the source builds?
 *
 * Committed build output drifts the moment someone edits the source without
 * rebuilding, and nothing about the repository makes that visible. This
 * compares the published files against a fresh build and says so.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12);

const built = join(ROOT, 'dist');
if (!existsSync(join(built, 'app.html'))) {
  console.error('No build to compare against. Run `npm run build` first.');
  process.exit(1);
}

const problems = [];
if (!existsSync(join(ROOT, 'index.html'))) {
  problems.push('index.html is missing from the repository root');
} else if (hash(join(built, 'app.html')) !== hash(join(ROOT, 'index.html'))) {
  problems.push('index.html differs from the current build');
}

const fresh = new Set(readdirSync(join(built, 'assets')));
const published = existsSync(join(ROOT, 'assets')) ? new Set(readdirSync(join(ROOT, 'assets'))) : new Set();
for (const f of fresh) if (!published.has(f)) problems.push(`assets/${f} is not published`);
for (const f of published) if (!fresh.has(f)) problems.push(`assets/${f} is stale and no longer built`);

if (problems.length) {
  console.error('\n  The committed site is out of date:\n');
  problems.forEach((p) => console.error(`    · ${p}`));
  console.error('\n  Run `npm run build:pages` and commit the result.\n');
  process.exit(1);
}
console.log(`  Committed site matches the build (${fresh.size} assets).`);
