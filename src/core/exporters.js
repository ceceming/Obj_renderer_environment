import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { EXRExporter, ZIP_COMPRESSION } from 'three/examples/jsm/exporters/EXRExporter.js';
import { formatName } from './schema.js';

/**
 * Output.
 *
 * The point of this module is that one approved look can leave as any of the
 * things a designer actually needs: a cut-out PNG for a layout, a numbered
 * frame sequence for an edit, a linear EXR for grading, a GLB for a 3D
 * pipeline, or a self-contained interactive page for a client.
 */

export const OUTPUT_FORMATS = {
  png: { label: 'PNG', group: 'Still', ext: 'png', note: 'Lossless, supports a real alpha channel. The default for design work.' },
  jpg: { label: 'JPEG', group: 'Still', ext: 'jpg', note: 'Smaller, no transparency. Fine for previews and mood boards.' },
  webp: { label: 'WebP', group: 'Still', ext: 'webp', note: 'Smaller than PNG with alpha intact. Best for the web.' },
  exr: { label: 'OpenEXR (32-bit linear)', group: 'Still', ext: 'exr', note: 'Full dynamic range, un-tone-mapped. Grade it in DaVinci, Nuke or After Effects without clipping.' },
  'png-sequence': { label: 'PNG Sequence (ZIP)', group: 'Motion', ext: 'zip', note: 'Numbered frames for a video editor. Keeps alpha, never recompresses.' },
  mp4: { label: 'MP4 (H.264)', group: 'Motion', ext: 'mp4', note: 'Universally playable. No alpha channel. Requires ffmpeg when rendering from the CLI.' },
  webm: { label: 'WebM (VP9, alpha)', group: 'Motion', ext: 'webm', note: 'The only common video format that keeps transparency.' },
  gif: { label: 'Animated GIF', group: 'Motion', ext: 'gif', note: 'Limited to 256 colours. Good for quick shares, poor for gradients.' },
  html: { label: 'Interactive HTML', group: 'Interactive', ext: 'html', note: 'A single self-contained page with the live three.js scene. Send it to a client; it needs no server.' },
  glb: { label: 'GLB (3D model)', group: 'Interactive', ext: 'glb', note: 'The configured scene as a 3D asset, materials and all.' },
  json: { label: 'Render config', group: 'Data', ext: 'render.json', note: 'The recipe alone. Tiny, diffable, and reproduces this exact image later.' }
};

// ── Raster capture ──────────────────────────────────────────────────────────

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export function canvasToBlob(canvas, format = 'png', quality = 0.95) {
  return new Promise((resolve, reject) => {
    const mime = MIME[format] || 'image/png';
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`Could not encode ${format}.`))),
      mime,
      mime === 'image/png' ? undefined : quality
    );
  });
}

/**
 * Flatten an image with alpha onto a solid colour.
 * JPEG has no alpha, so without this a transparent render becomes black.
 */
export function compositeOnColor(canvas, color = '#ffffff') {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/** Trim fully transparent margins. Very useful for packing cut-outs into layouts. */
export function trimTransparent(canvas, padding = 0) {
  const ctx = canvas.getContext('2d') || copyTo2D(canvas).getContext('2d');
  const src = ctx.canvas;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 2) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return src;
  minX = Math.max(0, minX - padding); minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding); maxY = Math.min(height - 1, maxY + padding);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function copyTo2D(canvas) {
  const out = document.createElement('canvas');
  out.width = canvas.width; out.height = canvas.height;
  out.getContext('2d').drawImage(canvas, 0, 0);
  return out;
}

/**
 * Turn whatever the engine produced into a delivery-ready blob, honouring the
 * output settings (background flattening, trimming, quality).
 */
export async function captureStill(engine, cfg) {
  const format = cfg.output.format === 'png-sequence' ? 'png' : cfg.output.format;
  let canvas = engine.canvas;

  if (format === 'exr') return captureEXR(engine, cfg);

  // The WebGL canvas cannot be read through a 2D context, so anything that
  // needs pixel work gets a copy first.
  const needs2D = format === 'jpg' || cfg.output.trim;
  if (needs2D) canvas = copyTo2D(canvas);

  if (format === 'jpg') {
    canvas = compositeOnColor(canvas, cfg.output.customBackground || '#ffffff');
  }
  if (cfg.output.trim) {
    canvas = trimTransparent(canvas, cfg.output.trimPadding ?? 0);
  }

  const quality = format === 'jpg' ? cfg.output.jpegQuality : cfg.output.webpQuality;
  const blob = await canvasToBlob(canvas, format, quality ?? 0.95);
  return { blob, filename: stillName(cfg, format), mime: blob.type };
}

/** 32-bit linear EXR, straight out of the path tracer's accumulation buffer. */
export async function captureEXR(engine, cfg) {
  const pt = engine.pathTracer;
  if (!pt) {
    throw new Error('EXR output needs the path tracer. Switch the engine to "Path traced" and render again.');
  }
  const exporter = new EXRExporter();
  const buffer = await exporter.parse(engine.renderer, pt.target, {
    type: THREE.FloatType,
    compression: ZIP_COMPRESSION
  });
  const blob = new Blob([buffer], { type: 'image/x-exr' });
  return { blob, filename: stillName(cfg, 'exr'), mime: 'image/x-exr' };
}

function stillName(cfg, ext) {
  const base = formatName(cfg.output.namePattern || '{name}_{preset}_{w}x{h}', {
    name: cfg.name || 'render',
    preset: cfg.lighting.preset,
    camera: cfg.camera.preset,
    look: cfg.look.preset,
    material: cfg.material.mode,
    w: cfg.render.width,
    h: cfg.render.height
  });
  return `${sanitize(base)}.${ext}`;
}

export function frameName(cfg, frame, ext = 'png') {
  const base = formatName(cfg.output.frameNamePattern || '{name}_{frame:04}', {
    name: cfg.name || 'render',
    frame,
    preset: cfg.lighting.preset,
    w: cfg.render.width,
    h: cfg.render.height
  });
  return `${sanitize(base)}.${ext}`;
}

export const sanitize = (s) => String(s).replace(/[^\w\-.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

// ── 3D + data ───────────────────────────────────────────────────────────────

/** Export the configured scene (model + set pieces) as a GLB. */
export function exportGLB(engine, cfg) {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    const scene = new THREE.Scene();
    if (engine.model) scene.add(engine.model.clone(true));
    const backdrop = engine.scene.getObjectByName('Backdrop');
    if (backdrop && cfg.output.includeSetInGLB !== false) scene.add(backdrop.clone(true));
    exporter.parse(
      scene,
      (result) => {
        const blob = new Blob([result], { type: 'model/gltf-binary' });
        resolve({ blob, filename: `${sanitize(cfg.name || 'model')}.glb`, mime: 'model/gltf-binary' });
      },
      (err) => reject(err),
      { binary: true, onlyVisible: true, maxTextureSize: 4096 }
    );
  });
}

export function exportConfig(cfg) {
  const clean = JSON.parse(JSON.stringify(cfg));
  // Strip runtime caches that mean nothing on disk.
  for (const key of Object.keys(clean)) if (key.startsWith('__')) delete clean[key];
  const json = JSON.stringify(clean, null, 2);
  return {
    blob: new Blob([json], { type: 'application/json' }),
    filename: `${sanitize(cfg.name || 'render')}.render.json`,
    mime: 'application/json',
    text: json
  };
}

// ── ZIP ─────────────────────────────────────────────────────────────────────

/**
 * Bundle frames into a ZIP. Frames are already-compressed PNGs, so we store
 * them without further compression — it is faster and the size is the same.
 */
export async function zipFiles(entries, { comment } = {}) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const { name, blob, text } of entries) {
    zip.file(name, text ?? blob, { compression: /\.(png|jpe?g|webp|zip)$/i.test(name) ? 'STORE' : 'DEFLATE' });
  }
  if (comment) zip.file('README.txt', comment);
  return zip.generateAsync({ type: 'blob' });
}

// ── Browser download helper ─────────────────────────────────────────────────

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
