#!/usr/bin/env node
/**
 * Exposure calibration.
 *
 * Renders a known-albedo white reference and measures the subject only —
 * isolated with a transparent background, so the backdrop cannot skew the
 * statistics the way a framed crop does. Reports the brightness distribution
 * across the lit surface and how much of it is clipped.
 *
 *   node calib.mjs [model.obj]
 */
import { startServer } from './cli/server.mjs';
import { launchChromium } from './cli/browser.mjs';
import { chromium } from 'playwright';
import { dirname, basename, resolve } from 'node:path';
import { defaultConfig, mergeConfig } from './src/core/schema.js';
import { getLightingPreset } from './src/core/presets/lighting.js';

const model = resolve(process.argv[2] || 'examples/test-model/testobject.obj');
const sweep = (process.argv[3] || '1,0.7,0.5,0.35,0.25').split(',').map(Number);
const preset = process.argv[4] || 'studio-softbox';

const server = await startServer({ appRoot: 'dist', assetRoots: { model: dirname(model) } });
const { browser } = await launchChromium(chromium);
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`${server.origin}/headless.html`, { waitUntil: 'load' });
await page.waitForFunction('window.__STUDIO_READY__ === true', { timeout: 30000 });

console.log(`\n  reference: white clay (albedo 0.94) · rig: ${preset} · ${basename(model)}`);
console.log('  target: p99 below ~248 with clipping under 1%\n');
console.log('  intensity   mean   median    p95    p99   clipped   verdict');

for (const gi of sweep) {
  const cfg = mergeConfig(defaultConfig(), {
    lighting: { preset, ...getLightingPreset(preset), intensity: gi },
    material: { mode: 'clay-white' },
    // Transparent background makes alpha a perfect mask for the subject.
    output: { backgroundMode: 'transparent' },
    render: { width: 480, height: 480 }
  });
  await page.evaluate(([c, w]) => window.__STUDIO__.init(c, { width: w, height: w }), [JSON.stringify(cfg), 480]);
  await page.evaluate(([u, n]) => window.__STUDIO__.loadModel(u, n, {}), [`/assets-model/${encodeURI(basename(model))}`, basename(model)]);
  await page.evaluate(() => window.__STUDIO__.renderFrame(null, 'png'));

  const s = await page.evaluate(() => {
    const c = document.getElementById('view');
    const t = document.createElement('canvas');
    t.width = c.width; t.height = c.height;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const lum = [];
    let clipped = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 250) continue;              // subject pixels only
      lum.push((d[i] + d[i + 1] + d[i + 2]) / 3);
      if (d[i] >= 252 && d[i + 1] >= 252 && d[i + 2] >= 252) clipped++;
    }
    lum.sort((a, b) => a - b);
    const q = (p) => lum[Math.min(lum.length - 1, Math.floor(lum.length * p))] || 0;
    return {
      n: lum.length,
      mean: lum.reduce((a, b) => a + b, 0) / Math.max(1, lum.length),
      median: q(0.5), p95: q(0.95), p99: q(0.99),
      clipPct: (100 * clipped) / Math.max(1, lum.length)
    };
  });

  const ok = s.p99 <= 249 && s.clipPct < 1;
  const dark = s.p95 < 150;
  console.log(
    `  ${String(gi).padEnd(10)} ${s.mean.toFixed(0).padStart(5)} ${String(s.median).padStart(8)} ` +
    `${String(s.p95).padStart(6)} ${String(s.p99).padStart(6)} ${s.clipPct.toFixed(1).padStart(7)}%   ` +
    (ok ? (dark ? 'usable but dark' : 'GOOD') : 'clipped')
  );
}
console.log('');
await browser.close(); await server.close();
