#!/usr/bin/env node
/**
 * Smoke test.
 *
 * Exercises the whole stack the way a person would: loads the studio, checks
 * the interface built itself, drives a few presets, then renders a still and a
 * transparent cut-out headlessly and inspects the pixels that come out.
 *
 * Run it after any change to the renderer:  npm run smoke
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.mjs';
import { launchChromium } from './browser.mjs';

const OUT = process.argv[2] || join(tmpdir(), 'obj-render-studio-smoke');
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
};

const { chromium } = await import('playwright');
const server = await startServer({ appRoot: 'dist', assetRoots: { model: 'examples/test-model' } });
const { browser } = await launchChromium(chromium);

const MODEL = {
  url: '/assets-model/testobject.obj',
  name: 'testobject.obj',
  files: {
    'testobject.obj': '/assets-model/testobject.obj',
    'testobject.mtl': '/assets-model/testobject.mtl',
    'textures/body_diffuse.png': '/assets-model/textures/body_diffuse.png'
  }
};

try {
  // ── the studio interface ──────────────────────────────────────────────────
  console.log('\nStudio');
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${server.origin}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.studio && window.studio.engine', { timeout: 30000 });
  await page.waitForTimeout(3000);

  const ui = await page.evaluate(() => ({
    sections: document.querySelectorAll('.section').length,
    controls: document.querySelectorAll('.ctrl').length,
    chips: document.querySelectorAll('.chip').length,
    lights: document.querySelectorAll('.light-row').length
  }));
  check('interface builds', ui.sections > 8 && ui.controls > 80,
    `${ui.sections} sections, ${ui.controls} controls, ${ui.chips} presets, ${ui.lights} lights`);

  await page.evaluate(() => window.studio.applyPreset('material', 'metal-gold', { mode: 'metal-gold' }));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.studio.onChange({ camera: { azimuth: -40 } }, { path: 'camera.azimuth' }));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(OUT, 'studio.png') });
  check('no runtime errors', errors.length === 0, errors.length ? errors[0].slice(0, 90) : '');
  await page.close();

  // ── headless rendering ────────────────────────────────────────────────────
  console.log('\nRendering');
  const r = await browser.newPage();
  r.on('pageerror', (e) => errors.push(e.message));
  await r.goto(`${server.origin}/headless.html`, { waitUntil: 'load' });
  await r.waitForFunction('window.__STUDIO_READY__ === true', { timeout: 30000 });

  const { defaultConfig, mergeConfig } = await import('../src/core/schema.js');
  const { getLightingPreset } = await import('../src/core/presets/lighting.js');

  const render = async (patch, file) => {
    const cfg = mergeConfig(defaultConfig(), mergeConfig({
      lighting: { preset: 'studio-softbox', ...getLightingPreset('studio-softbox') },
      render: { width: 420, height: 420 }
    }, patch));
    await r.evaluate(([c, w]) => window.__STUDIO__.init(c, { width: w, height: w }), [JSON.stringify(cfg), 420]);
    const info = await r.evaluate((m) => window.__STUDIO__.loadModel(m.url, m.name, m.files), MODEL);
    const data = await r.evaluate(() => window.__STUDIO__.renderFrame(null, 'png'));
    writeFileSync(join(OUT, file), Buffer.from(data.split(',')[1], 'base64'));
    const stats = await r.evaluate(() => {
      const c = document.getElementById('view');
      const t = document.createElement('canvas');
      t.width = c.width; t.height = c.height;
      const x = t.getContext('2d'); x.drawImage(c, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let clear = 0, opaque = 0, partial = 0, shadowDark = 0;
      // Shading variety: a correctly lit object produces a wide spread of
      // tones. A flat or black render collapses to a handful of buckets, which
      // counting lit pixels alone would not catch.
      const buckets = new Set();
      let sum = 0, sumSq = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a < 5) clear++; else if (a > 250) opaque++; else {
          partial++;
          if (d[i] < 160) shadowDark++;
        }
        if (a > 250) {
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          buckets.add(Math.round(l / 4));
          sum += l; sumSq += l * l; n++;
        }
      }
      const mean = n ? sum / n : 0;
      const sd = n ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0;
      return { clear, opaque, partial, shadowDark, tones: buckets.size, meanLuma: Math.round(mean), sd: Math.round(sd) };
    });
    return { info, stats };
  };

  const still = await render({}, 'still.png');
  check('model loads with materials', still.info.stats.triangles > 1000 && still.info.stats.textureCount > 0,
    `${still.info.stats.triangles.toLocaleString()} tris, ${still.info.stats.materialCount} materials, ${still.info.stats.textureCount} textures`);
  check('subject is shaded, not flat or black',
    still.stats.tones > 20 && still.stats.sd > 12 && still.stats.meanLuma > 40,
    `${still.stats.tones} distinct tones, mean luma ${still.stats.meanLuma}, spread ${still.stats.sd}`);

  const cut = await render({ output: { backgroundMode: 'transparent' } }, 'cutout.png');
  const total = cut.stats.clear + cut.stats.opaque + cut.stats.partial;
  check('transparent background', cut.stats.clear / total > 0.3,
    `${Math.round(100 * cut.stats.clear / total)}% transparent`);
  check('grounding shadow in alpha', cut.stats.shadowDark > 2000,
    `${cut.stats.shadowDark.toLocaleString()} dark partial-alpha pixels`);

  await r.close();
} finally {
  await browser.close();
  await server.close();
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed  ·  ${OUT}\n`);
process.exit(failed.length ? 1 : 0);
