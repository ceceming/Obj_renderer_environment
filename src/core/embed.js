import viewerSource from '../../templates/viewer.js?raw';
import pageTemplate from '../../templates/index.html?raw';
import { exportGLB, exportConfig, zipFiles, sanitize } from './exporters.js';

/**
 * Interactive exports.
 *
 * Two shapes, because they serve different people:
 *
 *  - "Single file"  — one .html with the model base64-encoded inside it and
 *    three.js pulled from a CDN. Email it, drop it on a USB stick, open it
 *    from the desktop. Nothing to install, no server, no build step.
 *
 *  - "Project"      — a small folder (index.html, viewer.js, model.glb,
 *    config.json). Same result, but the viewer is a readable, commented file
 *    you can edit and fold into a real site.
 *
 * Both replay the same config the studio used, so what the recipient spins
 * around is the look you signed off.
 */

const THREE_VERSION = '0.186.0';
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;

const IMPORTMAP = JSON.stringify({
  imports: {
    three: `${CDN}/build/three.module.js`,
    'three/addons/': `${CDN}/examples/jsm/`
  }
}, null, 2);

function fillTemplate(cfg, { modelUrl, importmap = IMPORTMAP }) {
  const dark = isDarkBackground(cfg);
  return pageTemplate
    .replace(/__TITLE__/g, escapeHtml(cfg.name || 'Render'))
    .replace(/__PAGE_BG__/g, dark ? '#0b0b0d' : '#f4f4f6')
    .replace(/__PAGE_FG__/g, dark ? '#e8e8ea' : '#16161a')
    .replace('__IMPORTMAP__', importmap)
    .replace('__CONFIG__', JSON.stringify(stripRuntime(cfg), null, 2))
    .replace('__MODEL_URL__', JSON.stringify(modelUrl));
}

/** One .html file with everything inside it. */
export async function exportSingleFileHTML(engine, cfg) {
  const { blob: glb } = await exportGLB(engine, cfg);
  const dataUrl = await blobToDataURL(glb);

  let html = fillTemplate(cfg, { modelUrl: dataUrl });
  // Inline the viewer module: a single file cannot import a sibling.
  html = html.replace(
    `<script type="module">\n    import { createViewer } from './viewer.js';`,
    `<script type="module">\n${viewerSource.replace(/^export /gm, '')}\n`
  );

  const size = new Blob([html]).size;
  return {
    blob: new Blob([html], { type: 'text/html' }),
    filename: `${sanitize(cfg.name || 'render')}.html`,
    mime: 'text/html',
    note: size > 40 * 1024 * 1024
      ? `This file is ${(size / 1024 / 1024).toFixed(1)} MB because the model is embedded. Use the Project export if that is awkward to share.`
      : null
  };
}

/** A small folder as a ZIP: index.html + viewer.js + model.glb + config.json. */
export async function exportProjectZip(engine, cfg) {
  const { blob: glb } = await exportGLB(engine, cfg);
  const config = exportConfig(cfg);
  const html = fillTemplate(cfg, { modelUrl: './model.glb' });

  const readme = [
    `${cfg.name || 'Render'} — exported from OBJ Render Studio`,
    '',
    'Files',
    '  index.html    the page. Open it through a local server, not file://,',
    '                because browsers block module and .glb loading from disk.',
    '  viewer.js     the scene, commented and meant to be edited.',
    '  model.glb     your model with materials.',
    '  config.json   the render recipe. Load it back into the studio any time.',
    '',
    'Running it',
    '  npx serve .           (or)   python3 -m http.server',
    '  then open the address it prints.',
    '',
    'three.js is loaded from a CDN via the import map in index.html.',
    `To vendor it instead, download three@${THREE_VERSION} and repoint those paths.`,
    '',
    'Look',
    `  lighting   ${cfg.lighting.preset}`,
    `  camera     ${cfg.camera.preset} · ${cfg.camera.focalLength}mm`,
    `  material   ${cfg.material.mode}`,
    `  grade      ${cfg.look.preset} · ${cfg.look.tonemap}`
  ].join('\n');

  const blob = await zipFiles([
    { name: 'index.html', text: html },
    { name: 'viewer.js', text: viewerSource },
    { name: 'model.glb', blob: glb },
    { name: 'config.json', text: config.text },
    { name: 'README.txt', text: readme }
  ]);

  return {
    blob,
    filename: `${sanitize(cfg.name || 'render')}-threejs.zip`,
    mime: 'application/zip'
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function stripRuntime(cfg) {
  const clean = JSON.parse(JSON.stringify(cfg));
  for (const key of Object.keys(clean)) if (key.startsWith('__')) delete clean[key];
  return clean;
}

function isDarkBackground(cfg) {
  const bg = cfg.background;
  const hex = bg.type === 'gradient' ? bg.gradient?.bottom : bg.type === 'studio-cyc' ? bg.cyc?.color : bg.color;
  if (!hex) return false;
  const n = parseInt(String(hex).replace('#', ''), 16);
  const luma = (((n >> 16) & 255) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722) / 255;
  return luma < 0.42;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
