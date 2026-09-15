import { RenderEngine } from '../core/engine.js';
import { fromJSON } from '../core/schema.js';
import { AnimationDriver, frameCount } from '../core/animation.js';
import { captureStill, captureEXR } from '../core/exporters.js';

/**
 * Headless bootstrap.
 *
 * This page is driven by Playwright from cli/render.mjs. It exposes a tiny RPC
 * surface on `window.__STUDIO__` and does nothing on its own.
 *
 * The important property: it imports the *same* engine, the same presets and
 * the same post chain as the interactive studio. There is no separate "offline
 * renderer" that could drift, so a 6K frame from the CLI matches the viewport.
 */

const canvas = document.getElementById('view');
let engine = null;
let driver = null;

const api = {
  async init(configJSON, { width, height } = {}) {
    engine = new RenderEngine(canvas, { pixelRatio: 1, antialias: true });
    engine.setConfig(fromJSON(configJSON));
    const w = width || engine.config.render.width;
    const h = height || engine.config.render.height;
    canvas.width = w; canvas.height = h;
    engine.setSize(w, h, 1);
    return { ok: true, width: w, height: h };
  },

  /** Load a model from a URL the CLI serves over http. */
  async loadModel(url, name, files) {
    const result = await engine.loadModelFrom({ url, name, files: files || {} });
    return {
      ok: true,
      stats: result.stats,
      warnings: result.warnings,
      format: result.format
    };
  },

  usePlaceholder() {
    engine.loadPlaceholder();
    return { ok: true };
  },

  async patch(partial) {
    engine.patch(partial);
    return { ok: true };
  },

  frameCount() { return frameCount(engine.config); },

  beginAnimation() { driver = new AnimationDriver(engine).begin(); return { ok: true }; },
  endAnimation() { driver?.end(); driver = null; return { ok: true }; },

  /**
   * Render one frame and return it as a base64 data URL.
   * `frame` is optional; when given, the animation curve is evaluated for it.
   */
  async renderFrame(frame = null, format = 'png') {
    if (frame !== null && driver) await driver.applyFrame(frame);
    else await engine.prepare();

    const cfg = engine.config;

    if (cfg.render.engine === 'pathtrace') {
      const target = cfg.render.pathtrace.samples;
      while (engine.pathTracer && engine.pathTracer.samples < target) {
        engine.pathTracer.renderSample();
        window.__STUDIO_PROGRESS__ = engine.pathTracer.samples / target;
        if (engine.pathTracer.samples % 16 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    } else if (cfg.render.accumulate?.enabled) {
      const { restore } = await engine.renderAtSize(canvas.width, canvas.height, {
        onProgress: (p) => { window.__STUDIO_PROGRESS__ = p; }
      });
      // renderAtSize already produced the final image; skip the extra pass.
      const data = await toDataURL(engine, cfg, format);
      await restore();
      return data;
    } else {
      await engine.render();
    }

    return toDataURL(engine, cfg, format);
  },

  config() { return JSON.parse(JSON.stringify(engine.config)); },

  warnings() { return engine.warningsList; },
  progress() { return window.__STUDIO_PROGRESS__ ?? 1; }
};

async function toDataURL(engine, cfg, format) {
  if (format === 'exr') {
    const { blob } = await captureEXR(engine, cfg);
    return blobToDataURL(blob);
  }
  const { blob } = await captureStill(engine, { ...cfg, output: { ...cfg.output, format } });
  return blobToDataURL(blob);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

window.__STUDIO__ = api;
window.__STUDIO_READY__ = true;
