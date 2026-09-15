#!/usr/bin/env node
/**
 * Offline renderer.
 *
 * Drives the *same* engine the studio uses, inside a headless Chromium, so a
 * 6K frame from this command is the image you approved in the viewport — not a
 * second implementation that approximates it.
 *
 *   node cli/render.mjs --model chair.obj --preset golden-hour --out renders/
 *   node cli/render.mjs --config hero.render.json --format mp4
 *   node cli/render.mjs --model watch.obj --animate turntable --duration 6 --format png-sequence
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { findFFmpeg, encodeVideo, CODEC_SUPPORT } from './ffmpeg.mjs';
import { launchChromium } from './browser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');

// ── argument parsing ────────────────────────────────────────────────────────

const HELP = `
OBJ Render Studio — offline renderer

  node cli/render.mjs [options]

Input
  --model <path>        Model file (.obj .glb .gltf .fbx .stl .ply .dae .3mf).
                        Sibling .mtl and textures are picked up automatically.
  --config <path>       A .render.json saved from the studio. Options below override it.

Look
  --preset <key>        Lighting preset  (studio-softbox, golden-hour, low-key, …)
  --camera <key>        Camera preset    (three-quarter, iso-technical, macro-detail, …)
  --material <key>      Material preset  (original, clay, metal-polished, glass, …)
  --look <key>          Grade preset     (clean, punchy, cinematic, noir, …)
  --backdrop <key>      Background       (transparent, white, cyc, plinth-gloss, …)
  --exposure <n>        Exposure multiplier
  --azimuth <deg>       Camera angle around the subject
  --elevation <deg>     Camera height
  --focal <mm>          Focal length

Output
  --out <dir>           Output directory                     (default ./renders)
  --format <fmt>        png jpg webp exr png-sequence mp4 webm gif   (default png)
  --width <px>          Output width                         (default from config)
  --height <px>         Output height
  --size <preset>       Resolution preset (square-2048, uhd-3840x2160, print-a4-300, …)
  --background <mode>   as-configured | transparent | white | black
  --engine <e>          raster | pathtrace
  --samples <n>         Path tracer samples per pixel
  --name <str>          Base filename

Animation
  --animate <type>      turntable, camera-orbit, orbit-arc, dolly-in, light-sweep, …
  --duration <sec>      Length in seconds                    (default 6)
  --fps <n>             Frames per second                    (default 30)
  --frames <a-b>        Render only this frame range, e.g. 0-59 or 30

Other
  --angles <set>        Batch a turnaround: four-view, six-view, eight-turn, hero-set
  --list                Print every available preset key and exit
  --quiet               Only print the final summary
  --help                This message
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv);
const log = (...a) => { if (!args.quiet) console.log(...a); };

if (args.help) { console.log(HELP); process.exit(0); }

if (args.list) {
  const { LIGHTING_PRESETS } = await import('../src/core/presets/lighting.js');
  const { CAMERA_PRESETS, ANGLE_SETS } = await import('../src/core/presets/cameras.js');
  const { MATERIAL_PRESETS } = await import('../src/core/presets/materials.js');
  const { LOOK_PRESETS } = await import('../src/core/presets/looks.js');
  const { BACKDROP_PRESETS } = await import('../src/core/presets/backdrops.js');
  const { ANIMATION_PRESETS } = await import('../src/core/animation.js');
  const { RESOLUTION_PRESETS } = await import('../src/core/schema.js');
  const show = (title, obj) => {
    console.log(`\n${title}`);
    for (const [k, v] of Object.entries(obj)) {
      console.log(`  ${k.padEnd(22)} ${v.label || ''}`);
    }
  };
  show('LIGHTING  --preset', LIGHTING_PRESETS);
  show('CAMERA    --camera', CAMERA_PRESETS);
  show('MATERIAL  --material', MATERIAL_PRESETS);
  show('LOOK      --look', LOOK_PRESETS);
  show('BACKDROP  --backdrop', BACKDROP_PRESETS);
  show('ANIMATION --animate', ANIMATION_PRESETS);
  show('SIZE      --size', RESOLUTION_PRESETS);
  show('ANGLES    --angles', ANGLE_SETS);
  console.log();
  process.exit(0);
}

// ── build the config ────────────────────────────────────────────────────────

const { defaultConfig, mergeConfig, fromJSON, RESOLUTION_PRESETS } = await import('../src/core/schema.js');
const { getLightingPreset } = await import('../src/core/presets/lighting.js');
const { getCameraPreset, ANGLE_SETS } = await import('../src/core/presets/cameras.js');
const { getLookPreset } = await import('../src/core/presets/looks.js');
const { getBackdropPreset } = await import('../src/core/presets/backdrops.js');

let config = args.config
  ? fromJSON(readFileSync(resolve(args.config), 'utf8'))
  : defaultConfig();

if (!args.config) {
  config = mergeConfig(config, { lighting: { preset: 'studio-softbox', ...getLightingPreset('studio-softbox') } });
}

const num = (v, fallback) => (v === undefined ? fallback : Number(v));

if (args.preset)   config = mergeConfig(config, { lighting: { preset: args.preset, ...getLightingPreset(args.preset) } });
if (args.camera)   config = mergeConfig(config, { camera: { preset: args.camera, ...getCameraPreset(args.camera) } });
if (args.look)     config = mergeConfig(config, { look: { preset: args.look, ...getLookPreset(args.look) } });
if (args.backdrop) config = mergeConfig(config, { background: getBackdropPreset(args.backdrop) });
if (args.material) config = mergeConfig(config, { material: { mode: args.material } });

if (args.size && RESOLUTION_PRESETS[args.size]) {
  const p = RESOLUTION_PRESETS[args.size];
  config = mergeConfig(config, { render: { width: p.w, height: p.h, resolutionPreset: args.size } });
}
if (args.width)  config = mergeConfig(config, { render: { width: num(args.width), resolutionPreset: 'custom' } });
if (args.height) config = mergeConfig(config, { render: { height: num(args.height), resolutionPreset: 'custom' } });
if (args.engine) config = mergeConfig(config, { render: { engine: args.engine } });
if (args.samples) config = mergeConfig(config, { render: { pathtrace: { samples: num(args.samples) } } });
if (args.exposure) config = mergeConfig(config, { look: { exposure: num(args.exposure) } });
if (args.azimuth !== undefined) config = mergeConfig(config, { camera: { azimuth: num(args.azimuth) } });
if (args.elevation !== undefined) config = mergeConfig(config, { camera: { elevation: num(args.elevation) } });
if (args.focal) config = mergeConfig(config, { camera: { focalLength: num(args.focal) } });
if (args.background) config = mergeConfig(config, { output: { backgroundMode: args.background } });
if (args.animate) {
  config = mergeConfig(config, { animation: { enabled: true, type: args.animate } });
}
if (args.duration) config = mergeConfig(config, { animation: { duration: num(args.duration) } });
if (args.fps) config = mergeConfig(config, { animation: { fps: num(args.fps) } });
if (args.name) config.name = args.name;

const format = args.format || (config.animation.enabled ? 'png-sequence' : config.output.format || 'png');
const isVideo = ['mp4', 'webm', 'gif', 'prores'].includes(format);
const isSequence = format === 'png-sequence' || isVideo;
const stillFormat = isSequence ? 'png' : format;
config = mergeConfig(config, { output: { format: stillFormat } });

if (isSequence && !config.animation.enabled) {
  config = mergeConfig(config, { animation: { enabled: true } });
}

const outDir = resolve(args.out || 'renders');
mkdirSync(outDir, { recursive: true });

// ── locate the model and everything it references ───────────────────────────

let modelInfo = null;
if (args.model) {
  const modelPath = resolve(args.model);
  if (!existsSync(modelPath)) {
    console.error(`Model not found: ${modelPath}`);
    process.exit(1);
  }
  const modelDir = dirname(modelPath);
  // Collect siblings so MTL texture references resolve.
  const siblings = [];
  const walk = (dir, prefix = '', depth = 0) => {
    if (depth > 3) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, `${prefix}${entry}/`, depth + 1);
      else if (st.size < 256 * 1024 * 1024) siblings.push(`${prefix}${entry}`);
    }
  };
  walk(modelDir);
  modelInfo = { path: modelPath, dir: modelDir, name: basename(modelPath), siblings };
  if (!args.name && !args.config) config.name = basename(modelPath, extname(modelPath));
}

// ── render ──────────────────────────────────────────────────────────────────

if (!existsSync(join(DIST, 'headless.html'))) {
  console.error('The app has not been built yet. Run:  npm run build');
  process.exit(1);
}

const { chromium } = await import('playwright');

const server = await startServer({
  appRoot: DIST,
  assetRoots: modelInfo ? { model: modelInfo.dir } : {}
});
log(`  server        ${server.origin}`);

const { browser, source: browserSource } = await launchChromium(chromium);
if (browserSource !== 'playwright') log(`  browser       ${browserSource}`);

const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1
});
page.on('console', (msg) => {
  if (msg.type() === 'error' && !args.quiet) console.error(`  [page] ${msg.text()}`);
});
page.on('pageerror', (err) => console.error(`  [page] ${err.message}`));

const started = Date.now();
const written = [];

try {
  await page.goto(`${server.origin}/headless.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__STUDIO_READY__ === true', { timeout: 60000 });

  await page.evaluate(
    ([cfg, w, h]) => window.__STUDIO__.init(cfg, { width: w, height: h }),
    [JSON.stringify(config), config.render.width, config.render.height]
  );
  log(`  resolution    ${config.render.width} × ${config.render.height}`);

  if (modelInfo) {
    const files = {};
    for (const rel of modelInfo.siblings) files[rel] = `/assets-model/${encodeURI(rel)}`;
    const result = await page.evaluate(
      ([url, name, f]) => window.__STUDIO__.loadModel(url, name, f),
      [`/assets-model/${encodeURI(modelInfo.name)}`, modelInfo.name, files]
    );
    log(`  model         ${modelInfo.name} — ${result.stats.triangles.toLocaleString()} triangles, ${result.stats.materialCount} materials, ${result.stats.textureCount} textures`);
    for (const w of result.warnings) log(`  note          ${w}`);
  } else {
    await page.evaluate(() => window.__STUDIO__.usePlaceholder());
    log('  model         (none given — rendering the sample object)');
  }

  log(`  lighting      ${config.lighting.preset}`);
  log(`  engine        ${config.render.engine}${config.render.engine === 'pathtrace' ? ` @ ${config.render.pathtrace.samples} spp` : ''}`);

  // ── angle batch ──
  if (args.angles) {
    const set = ANGLE_SETS[args.angles];
    if (!set) { console.error(`Unknown angle set "${args.angles}".`); process.exit(1); }
    log(`  angles        ${set.label}`);
    for (let i = 0; i < set.angles.length; i++) {
      const angle = set.angles[i];
      await page.evaluate((a) => window.__STUDIO__.patch({ camera: a }), angle);
      const dataUrl = await page.evaluate((f) => window.__STUDIO__.renderFrame(null, f), stillFormat);
      const file = join(outDir, `${config.name}_az${Math.round(angle.azimuth)}_el${Math.round(angle.elevation)}.${stillFormat}`);
      writeDataURL(file, dataUrl);
      written.push(file);
      log(`  ✓ ${basename(file)}`);
    }
  }

  // ── animation ──
  else if (isSequence) {
    const total = await page.evaluate(() => window.__STUDIO__.frameCount());
    const [from, to] = parseRange(args.frames, total);
    await page.evaluate(() => window.__STUDIO__.beginAnimation());
    log(`  animation     ${config.animation.type}, ${total} frames @ ${config.animation.fps} fps`);
    log(`  rendering     frames ${from}–${to}`);

    for (let f = from; f <= to; f++) {
      const t0 = Date.now();
      const dataUrl = await page.evaluate((i) => window.__STUDIO__.renderFrame(i, 'png'), f);
      const file = join(outDir, `${config.name}_${String(f).padStart(4, '0')}.png`);
      writeDataURL(file, dataUrl);
      written.push(file);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const done = f - from + 1, count = to - from + 1;
      process.stdout.write(
        args.quiet ? '' : `\r  frame ${String(done).padStart(4)} / ${count}  (${secs}s)   `
      );
    }
    if (!args.quiet) process.stdout.write('\n');
    await page.evaluate(() => window.__STUDIO__.endAnimation());
  }

  // ── single still ──
  else {
    const dataUrl = await page.evaluate((f) => window.__STUDIO__.renderFrame(null, f), stillFormat);
    const file = join(outDir, `${config.name}.${stillFormat}`);
    writeDataURL(file, dataUrl);
    written.push(file);
    log(`  ✓ ${basename(file)}`);
  }

  // Always drop the recipe next to the output, so any render is reproducible.
  const cfgFile = join(outDir, `${config.name}.render.json`);
  writeFileSync(cfgFile, JSON.stringify(config, null, 2));

  // ── encode ──
  if (isVideo) {
    const ffmpeg = findFFmpeg();
    if (!ffmpeg) {
      console.warn(`\n  ffmpeg was not found, so the ${format.toUpperCase()} was not assembled.`);
      console.warn(`  The PNG frames are in ${outDir} and can be imported into any editor,`);
      console.warn('  or encoded later with:\n');
      console.warn(`    ffmpeg -framerate ${config.animation.fps} -i ${config.name}_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 17 ${config.name}.mp4\n`);
    } else if (!CODEC_SUPPORT[format](ffmpeg)) {
      console.warn(`\n  The ffmpeg found (${ffmpeg.kind}) cannot encode ${format.toUpperCase()}.`);
      console.warn('  It is Playwright\'s minimal build, which only supports WebM/VP8.');
      console.warn('  Install a full ffmpeg for MP4 and GIF, or render --format webm.');
      console.warn(`  The PNG frames are in ${outDir}.\n`);
    } else {
      const output = join(outDir, `${config.name}.${format === 'prores' ? 'mov' : format}`);
      log(`  encoding      ${format} with ${ffmpeg.kind} ffmpeg`);
      await encodeVideo({
        ffmpeg,
        pattern: join(outDir, `${config.name}_%04d.png`),
        fps: config.animation.fps,
        output,
        format,
        transparent: config.output.backgroundMode === 'transparent',
        onLog: (l) => { if (args.verbose) log(`  ${l}`); }
      });
      written.push(output);
      log(`  ✓ ${basename(output)}`);
    }
  }
} catch (err) {
  console.error(`\nRender failed: ${err.message}`);
  if (!args.quiet) console.error(err.stack);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
if (written.length) {
  const bytes = written.reduce((n, f) => n + (existsSync(f) ? statSync(f).size : 0), 0);
  console.log(`\n  ${written.length} file${written.length === 1 ? '' : 's'} · ${(bytes / 1024 / 1024).toFixed(1)} MB · ${elapsed}s`);
  console.log(`  ${outDir}\n`);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function writeDataURL(file, dataUrl) {
  const base64 = String(dataUrl).split(',')[1];
  writeFileSync(file, Buffer.from(base64, 'base64'));
}

function parseRange(spec, total) {
  if (!spec || spec === true) return [0, total - 1];
  const m = String(spec).match(/^(\d+)(?:[-:](\d+))?$/);
  if (!m) return [0, total - 1];
  const from = Math.max(0, Number(m[1]));
  const to = m[2] === undefined ? from : Math.min(total - 1, Number(m[2]));
  return [from, to];
}
