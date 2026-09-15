import './styles.css';
import { RenderEngine, DIRTY } from '../core/engine.js';
import { defaultConfig, mergeConfig, fromJSON, RESOLUTION_PRESETS, validate } from '../core/schema.js';
import { buildPanels, renderLightList } from './ui/panels.js';
import { el } from './ui/controls.js';
import { SUPPORTED_EXTENSIONS, TEXTURE_EXTENSIONS } from '../core/loaders.js';
import { getLightingPreset } from '../core/presets/lighting.js';
import { ANGLE_SETS } from '../core/presets/cameras.js';
import { AnimationDriver, frameCount, evaluateFrame } from '../core/animation.js';
import {
  captureStill, exportConfig, exportGLB, zipFiles, download, frameName, sanitize
} from '../core/exporters.js';
import { exportSingleFileHTML, exportProjectZip } from '../core/embed.js';

const MAX_PREVIEW_PX = 1600;   // keep the viewport responsive at any output size

class Studio {
  constructor() {
    this.canvas = document.getElementById('view');
    this.stage = document.getElementById('stage');
    this.wrap = document.getElementById('canvas-wrap');
    this.rail = document.getElementById('rail');
    this.engine = new RenderEngine(this.canvas, { pixelRatio: Math.min(2, window.devicePixelRatio || 1) });
    this.selectedLight = null;
    this.playing = false;
    this.previewFrame = 0;
    this.needsRender = true;
    this.busy = false;
    this._rafPending = false;

    this.onChange = this.onChange.bind(this);
  }

  async init() {
    // Start from a look that is already worth looking at.
    this.engine.setConfig(mergeConfig(defaultConfig(), {
      lighting: { preset: 'studio-softbox', ...getLightingPreset('studio-softbox') }
    }));
    this.engine.loadPlaceholder();

    buildPanels(this.rail, this.engine, this);
    renderLightList(this, this.engine);
    this.bindTopbar();
    this.bindStage();
    this.bindKeys();
    this.bindDrop();

    await this.resize();
    this.loop();
    this.updateStatus();
    this.restoreSession();
  }

  // ── config plumbing ───────────────────────────────────────────────────────

  /**
   * Every control funnels through here. `structural` changes (toggling an
   * effect, switching engine) force a pipeline rebuild; everything else is a
   * cheap uniform update.
   */
  onChange(patch, meta = {}) {
    this.engine.patch(patch);

    if (meta.structural || /enabled|type|engine|projection|preset|antialias|resolution/.test(meta.path || '')) {
      this.engine.invalidate(DIRTY.POST);
    }
    if ((meta.path || '').startsWith('render.resolutionPreset')) {
      const preset = RESOLUTION_PRESETS[meta.value];
      if (preset && meta.value !== 'custom') {
        this.engine.patch({ render: { width: preset.w, height: preset.h } });
        this.builder?.refresh();
      }
      this.resize();
    }
    if ((meta.path || '').startsWith('render.width') || (meta.path || '').startsWith('render.height')) {
      this.engine.patch({ render: { resolutionPreset: 'custom' } });
      this.resize();
    }
    if ((meta.path || '').startsWith('lighting.environment.sky') || (meta.path || '').startsWith('lighting.intensity')) {
      this.engine.invalidate(DIRTY.ENVIRONMENT);
    }
    if ((meta.path || '').startsWith('animation.')) this.updateFrameCount();

    this.engine.resetAccumulation();
    this.requestRender();
    this.saveSession();
  }

  applyPreset(kind, key, presetConfig) {
    const patch = { [kind]: { ...presetConfig } };
    if (kind === 'lighting') patch.lighting.preset = key;
    if (kind === 'camera') patch.camera.preset = key;
    if (kind === 'look') patch.look.preset = key;
    if (kind === 'material') patch.material = { ...presetConfig, mode: key };
    if (kind === 'background') patch.background = { ...presetConfig };

    this.engine.patch(patch);
    if (kind === 'lighting') {
      this.engine.invalidate(DIRTY.ENVIRONMENT, DIRTY.LIGHTS, DIRTY.POST);
      this.selectedLight = null;
      renderLightList(this, this.engine);
    }
    if (kind === 'look' || kind === 'material') this.engine.invalidate(DIRTY.POST, DIRTY.MATERIALS);
    if (kind === 'background') this.engine.invalidate(DIRTY.BACKGROUND);
    if (kind === 'camera') this.engine.invalidate(DIRTY.CAMERA, DIRTY.POST);

    this.builder?.refresh();
    this.engine.resetAccumulation();
    this.requestRender();
    this.saveSession();
  }

  // ── lights ────────────────────────────────────────────────────────────────

  addLight(shape = 'rect') {
    const lights = [...(this.engine.config.lighting.environment.lights || [])];
    const id = `l${Date.now().toString(36)}`;
    lights.push({
      id, role: 'fill', name: `${shape} ${lights.length + 1}`, enabled: true,
      type: 'area', shape,
      azimuth: 60, elevation: 25, distance: 3,
      width: shape === 'strip' ? 0.4 : 3, height: shape === 'strip' ? 3 : 3,
      intensity: 2, color: '#ffffff', temperature: 6500, spread: 1,
      visible: false, castShadow: false, relativeTo: 'world'
    });
    this.engine.patch({ lighting: { environment: { lights } } });
    this.engine.invalidate(DIRTY.ENVIRONMENT, DIRTY.LIGHTS);
    this.selectedLight = id;
    renderLightList(this, this.engine);
    this.requestRender();
  }

  updateLight(index, patch) {
    const lights = (this.engine.config.lighting.environment.lights || []).map((l, i) =>
      i === index ? { ...l, ...patch } : l);
    this.engine.patch({ lighting: { environment: { lights } } });
    this.engine.invalidate(DIRTY.ENVIRONMENT, DIRTY.LIGHTS);
    renderLightList(this, this.engine);
    this.engine.resetAccumulation();
    this.requestRender();
    this.saveSession();
  }

  removeLight(index) {
    const lights = (this.engine.config.lighting.environment.lights || []).filter((_, i) => i !== index);
    this.engine.patch({ lighting: { environment: { lights } } });
    this.engine.invalidate(DIRTY.ENVIRONMENT, DIRTY.LIGHTS);
    this.selectedLight = null;
    renderLightList(this, this.engine);
    this.requestRender();
  }

  // ── files ─────────────────────────────────────────────────────────────────

  pickFiles() {
    const input = el('input', {
      type: 'file', multiple: true,
      accept: [...SUPPORTED_EXTENSIONS, ...TEXTURE_EXTENSIONS].map((e) => `.${e}`).join(',')
    });
    input.addEventListener('change', () => this.handleFiles([...input.files]));
    input.click();
  }

  pickHDRI() {
    const input = el('input', { type: 'file', accept: '.hdr,.exr' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      this.setBusy(`Loading ${file.name}`);
      this.engine.patch({ lighting: { environment: { type: 'hdri', hdriUrl: url } } });
      this.engine.invalidate(DIRTY.ENVIRONMENT, DIRTY.LIGHTS, DIRTY.BACKGROUND);
      await this.render(true);
      this.setBusy(null);
      this.toast(`Environment: ${file.name}`);
    });
    input.click();
  }

  clearHDRI() {
    this.engine.patch({ lighting: { environment: { type: 'procedural', hdriUrl: null } } });
    this.engine.invalidate(DIRTY.ENVIRONMENT, DIRTY.LIGHTS, DIRTY.BACKGROUND);
    this.requestRender();
  }

  /**
   * Accept a whole folder's worth of files at once: we pick the model and hand
   * everything else to the loader as a lookup table for texture resolution.
   */
  async handleFiles(files) {
    if (!files.length) return;
    const urls = {};
    let modelFile = null;
    let bestRank = 99;
    const rank = { glb: 0, gltf: 1, obj: 2, fbx: 3, dae: 4, '3mf': 5, stl: 6, ply: 7 };

    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      urls[path] = URL.createObjectURL(file);
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext in rank && rank[ext] < bestRank) { bestRank = rank[ext]; modelFile = { file, path }; }
    }

    if (!modelFile) {
      this.toast(`No model found. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`, 'warn');
      return;
    }

    this.setBusy(`Loading ${modelFile.file.name}`);
    try {
      const result = await this.engine.loadModelFrom({
        url: urls[modelFile.path],
        name: modelFile.file.name,
        files: urls
      });
      this.showStats(result.stats, result.warnings);
      this.builder?.refresh();
      await this.render(true);
      this.toast(`Loaded ${modelFile.file.name}`);
    } catch (err) {
      console.error(err);
      this.toast(`Could not load: ${err.message}`, 'warn');
    } finally {
      this.setBusy(null);
    }
  }

  async loadSample() {
    this.engine.loadPlaceholder();
    this.showStats(this.engine.modelStats, []);
    await this.render(true);
  }

  showStats(stats, warnings = []) {
    if (!this.statsEl) return;
    this.statsEl.textContent = '';
    if (stats) {
      const rows = [
        ['Triangles', stats.triangles.toLocaleString()],
        ['Meshes', stats.meshes],
        ['Materials', stats.materialCount],
        ['Textures', stats.textureCount],
        ['UVs', stats.hasUVs ? 'yes' : 'no']
      ];
      for (const [k, v] of rows) {
        this.statsEl.append(el('span', { text: k }), el('b', { text: String(v) }));
      }
    }
    this.warnEl.textContent = '';
    for (const w of warnings) this.warnEl.append(el('div', { class: 'notice', text: w }));
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  /** Fit the canvas to the stage at the output aspect ratio. */
  async resize() {
    const cfg = this.engine.config;
    const aspect = cfg.render.width / cfg.render.height;
    const pad = 32;
    const availW = this.stage.clientWidth - pad;
    const availH = this.stage.clientHeight - pad;
    let w = availW, h = availW / aspect;
    if (h > availH) { h = availH; w = availH * aspect; }

    this.wrap.style.width = `${Math.round(w)}px`;
    this.wrap.style.height = `${Math.round(h)}px`;
    this.canvas.style.width = `${Math.round(w)}px`;
    this.canvas.style.height = `${Math.round(h)}px`;

    // Render at the output resolution when it is small enough to stay smooth,
    // otherwise at a capped preview size with the same framing.
    const longest = Math.max(cfg.render.width, cfg.render.height);
    const scale = longest > MAX_PREVIEW_PX ? MAX_PREVIEW_PX / longest : 1;
    const rw = Math.max(16, Math.round(cfg.render.width * scale));
    const rh = Math.max(16, Math.round(cfg.render.height * scale));

    this.engine.setSize(rw, rh, 1);
    this.canvas.style.width = `${Math.round(w)}px`;
    this.canvas.style.height = `${Math.round(h)}px`;
    this.wrap.classList.toggle('checker', this.isTransparent());
    this.requestRender();
  }

  isTransparent() {
    const cfg = this.engine.config;
    return cfg.output.backgroundMode === 'transparent' ||
      (cfg.output.backgroundMode === 'as-configured' && cfg.background.type === 'transparent');
  }

  requestRender() { this.needsRender = true; }

  async render(force = false) {
    if (this.busy && !force) return;
    await this.engine.prepare();
    await this.engine.render();
    this.needsRender = false;
    this.updateStatus();
  }

  loop() {
    const tick = async () => {
      requestAnimationFrame(tick);
      if (this._rafPending) return;

      const cfg = this.engine.config;
      const pathTracing = cfg.render.engine === 'pathtrace';

      if (this.playing) {
        this._rafPending = true;
        const total = frameCount(cfg);
        this.previewFrame = (this.previewFrame + 1) % total;
        await this.driver.applyFrame(this.previewFrame);
        await this.engine.render();
        this._rafPending = false;
        this.updateStatus();
        return;
      }

      if (pathTracing) {
        // Keep accumulating until the sample target is reached.
        this._rafPending = true;
        if (this.needsRender) { await this.engine.prepare(); this.needsRender = false; }
        if (this.engine.pathTraceProgress < 1) {
          await this.engine.render();
          this.updateStatus();
        }
        this._rafPending = false;
        return;
      }

      if (this.needsRender) {
        this._rafPending = true;
        await this.render();
        this._rafPending = false;
      }
    };
    requestAnimationFrame(tick);
  }

  // ── interaction ───────────────────────────────────────────────────────────

  bindStage() {
    let dragging = false, lastX = 0, lastY = 0, mode = 'orbit';

    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      mode = e.shiftKey || e.button === 1 ? 'pan' : e.altKey || e.button === 2 ? 'light' : 'orbit';
      lastX = e.clientX; lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      const cfg = this.engine.config;

      if (mode === 'orbit') {
        this.engine.patch({ camera: {
          azimuth: wrap180(cfg.camera.azimuth - dx * 0.35),
          elevation: clamp(cfg.camera.elevation + dy * 0.3, -89, 89)
        } });
        this.engine.invalidate(DIRTY.CAMERA);
      } else if (mode === 'pan') {
        this.engine.patch({ camera: {
          targetMode: 'manual',
          target: {
            ...cfg.camera.target,
            y: clamp((cfg.camera.target.y ?? 0.5) + dy * 0.0015, -1, 2),
            x: (cfg.camera.target.x ?? 0) - dx * 0.0015
          }
        } });
        this.engine.invalidate(DIRTY.CAMERA);
      } else {
        // Alt-drag spins the lighting rig — the fastest way to hunt for a highlight.
        this.engine.patch({ lighting: { envRotation: wrap180(cfg.lighting.envRotation - dx * 0.5) } });
        this.engine.invalidate(DIRTY.LIGHTS);
      }
      this.engine.resetAccumulation();
      this.requestRender();
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      this.builder?.refresh();
      this.saveSession();
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cfg = this.engine.config;
      const factor = e.deltaY > 0 ? 0.94 : 1.064;
      this.engine.patch({ camera: { framing: clamp(cfg.camera.framing * factor, 0.1, 4) } });
      this.engine.invalidate(DIRTY.CAMERA);
      this.engine.resetAccumulation();
      this.requestRender();
      this.builder?.refresh();
    }, { passive: false });

    window.addEventListener('resize', () => this.resize());
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, select, textarea')) return;
      const cfg = this.engine.config;
      switch (e.key) {
        case 'g': document.getElementById('thirds').classList.toggle('on'); break;
        case 'f': document.getElementById('safe-frame').classList.toggle('on'); break;
        case ' ': e.preventDefault(); this.togglePreview(); break;
        case 'r': this.engine.patch({ camera: { azimuth: 35, elevation: 12, framing: 0.85, roll: 0 } });
                  this.engine.invalidate(DIRTY.CAMERA); this.builder?.refresh(); this.requestRender(); break;
        case 'p': this.onChange({ render: { engine: cfg.render.engine === 'raster' ? 'pathtrace' : 'raster' } },
                                { structural: true, path: 'render.engine' });
                  this.builder?.refresh(); break;
        default: break;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); this.exportNow(); }
    });
  }

  bindDrop() {
    let depth = 0;
    const show = (on) => this.stage.classList.toggle('dragging', on);
    window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; show(true); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--depth <= 0) show(false); });
    window.addEventListener('drop', async (e) => {
      e.preventDefault(); depth = 0; show(false);
      const files = await collectFiles(e.dataTransfer);
      if (files.length) this.handleFiles(files);
    });
  }

  bindTopbar() {
    document.getElementById('btn-open').addEventListener('click', () => this.pickFiles());
    document.getElementById('btn-export').addEventListener('click', () => this.exportNow());
    document.getElementById('btn-engine').addEventListener('click', (e) => {
      const next = this.engine.config.render.engine === 'raster' ? 'pathtrace' : 'raster';
      this.onChange({ render: { engine: next } }, { structural: true, path: 'render.engine' });
      e.target.textContent = next === 'raster' ? 'Real-time' : 'Path traced';
      this.builder?.refresh();
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      if (!confirm('Reset every setting to defaults? The loaded model stays.')) return;
      const name = this.engine.config.name;
      this.engine.setConfig(mergeConfig(defaultConfig(), {
        name, lighting: { preset: 'studio-softbox', ...getLightingPreset('studio-softbox') }
      }));
      buildPanels(this.rail, this.engine, this);
      renderLightList(this, this.engine);
      this.resize();
    });
  }

  // ── animation preview ─────────────────────────────────────────────────────

  togglePreview() {
    if (this.playing) {
      this.playing = false;
      this.driver?.end();
      this.driver = null;
      this.builder?.refresh();
      this.requestRender();
      return;
    }
    this.engine.patch({ animation: { enabled: true } });
    this.driver = new AnimationDriver(this.engine).begin();
    this.previewFrame = 0;
    this.playing = true;
  }

  async scrubTo(frame) {
    const driver = this.driver || new AnimationDriver(this.engine).begin();
    await driver.applyFrame(frame);
    await this.engine.render();
    if (!this.driver) driver.end();
  }

  updateFrameCount() {
    if (!this.frameCountEl) return;
    const cfg = this.engine.config;
    const n = frameCount(cfg);
    this.frameCountEl.textContent =
      `${n} frames at ${cfg.render.width}×${cfg.render.height}. ` +
      (cfg.render.engine === 'pathtrace'
        ? `Path traced at ${cfg.render.pathtrace.samples} samples — plan for minutes per frame.`
        : 'Real-time, so roughly a second per frame at this size.');
  }

  // ── export ────────────────────────────────────────────────────────────────

  async exportNow() {
    const cfg = this.engine.config;
    const format = cfg.output.format;

    if (format === 'html') return this.exportHTML();
    if (format === 'glb') return this.exportGLBFile();
    if (format === 'json') return this.exportConfigFile();
    if (['png-sequence', 'mp4', 'webm', 'gif'].includes(format) || cfg.animation.enabled) {
      return this.exportSequence();
    }
    return this.exportStill();
  }

  async exportStill() {
    const cfg = this.engine.config;
    this.setBusy('Rendering');
    try {
      const { restore } = await this.engine.renderAtSize(cfg.render.width, cfg.render.height, {
        onProgress: (p) => this.setProgress(p)
      });
      const { blob, filename } = await captureStill(this.engine, cfg);
      download(blob, filename);
      await restore();
      this.toast(`Saved ${filename} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) {
      console.error(err);
      this.toast(err.message, 'warn');
    } finally {
      this.setBusy(null);
      this.setProgress(0);
      this.requestRender();
    }
  }

  async quickPNG() {
    await this.render(true);
    const { blob, filename } = await captureStill(this.engine, {
      ...this.engine.config,
      output: { ...this.engine.config.output, format: 'png' }
    });
    download(blob, filename);
    this.toast(`Saved ${filename}`);
  }

  /**
   * Frame-by-frame output. Frames are rendered deterministically from the
   * animation curve, so this produces the same images every time and can be
   * handed straight to a video editor.
   */
  async exportSequence() {
    const cfg = this.engine.config;
    const total = frameCount(cfg);
    const driver = new AnimationDriver(this.engine).begin();
    const entries = [];

    this.setBusy(`Rendering 0 / ${total}`);
    try {
      for (let f = 0; f < total; f++) {
        await driver.applyFrame(f);
        const { restore } = await this.engine.renderAtSize(cfg.render.width, cfg.render.height, {
          onProgress: (p) => this.setProgress((f + p) / total)
        });
        const { blob } = await captureStill(this.engine, { ...this.engine.config, output: { ...cfg.output, format: 'png' } });
        entries.push({ name: frameName(cfg, f, 'png'), blob });
        await restore();
        this.setBusy(`Rendering ${f + 1} / ${total}`);
        this.setProgress((f + 1) / total);
      }
      driver.end();

      const readme = [
        `${cfg.name} — ${total} frames at ${cfg.animation.fps} fps (${cfg.animation.duration}s)`,
        `${cfg.render.width}×${cfg.render.height}, ${cfg.animation.type}`,
        '',
        'To assemble with ffmpeg:',
        `  ffmpeg -framerate ${cfg.animation.fps} -i ${cfg.name}_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 17 ${cfg.name}.mp4`,
        '',
        'Keeping transparency (WebM/VP9):',
        `  ffmpeg -framerate ${cfg.animation.fps} -i ${cfg.name}_%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -crf 24 -b:v 0 ${cfg.name}.webm`,
        '',
        'Or import the sequence directly into After Effects, Premiere or Resolve.'
      ].join('\n');

      const zip = await zipFiles(entries, { comment: readme });
      download(zip, `${sanitize(cfg.name)}-frames.zip`);
      this.toast(`Saved ${total} frames (${(zip.size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) {
      console.error(err);
      this.toast(err.message, 'warn');
      driver.end();
    } finally {
      this.setBusy(null);
      this.setProgress(0);
      this.requestRender();
    }
  }

  async exportAngleSet(setKey) {
    const set = ANGLE_SETS[setKey];
    if (!set) return;
    const cfg = JSON.parse(JSON.stringify(this.engine.config));
    const entries = [];
    this.setBusy(`Rendering ${set.angles.length} views`);
    try {
      for (let i = 0; i < set.angles.length; i++) {
        const angle = set.angles[i];
        this.engine.patch({ camera: angle });
        this.engine.invalidate(DIRTY.CAMERA);
        const { restore } = await this.engine.renderAtSize(cfg.render.width, cfg.render.height, {
          onProgress: (p) => this.setProgress((i + p) / set.angles.length)
        });
        const { blob } = await captureStill(this.engine, this.engine.config);
        entries.push({ name: `${sanitize(cfg.name)}_az${Math.round(angle.azimuth)}_el${Math.round(angle.elevation)}.png`, blob });
        await restore();
        this.setProgress((i + 1) / set.angles.length);
      }
      this.engine.setConfig(cfg);
      this.engine.invalidate();
      const zip = await zipFiles(entries);
      download(zip, `${sanitize(cfg.name)}-${setKey}.zip`);
      this.toast(`Saved ${entries.length} views`);
    } catch (err) {
      console.error(err);
      this.toast(err.message, 'warn');
    } finally {
      this.setBusy(null);
      this.setProgress(0);
      this.builder?.refresh();
      this.requestRender();
    }
  }

  async exportHTML() {
    this.setBusy('Building page');
    try {
      const { blob, filename, note } = await exportSingleFileHTML(this.engine, this.engine.config);
      download(blob, filename);
      this.toast(note || `Saved ${filename} — open it in any browser`);
    } catch (err) { console.error(err); this.toast(err.message, 'warn'); }
    finally { this.setBusy(null); }
  }

  async exportProject() {
    this.setBusy('Building project');
    try {
      const { blob, filename } = await exportProjectZip(this.engine, this.engine.config);
      download(blob, filename);
      this.toast(`Saved ${filename}`);
    } catch (err) { console.error(err); this.toast(err.message, 'warn'); }
    finally { this.setBusy(null); }
  }

  async exportGLBFile() {
    this.setBusy('Exporting GLB');
    try {
      const { blob, filename } = await exportGLB(this.engine, this.engine.config);
      download(blob, filename);
      this.toast(`Saved ${filename}`);
    } catch (err) { console.error(err); this.toast(err.message, 'warn'); }
    finally { this.setBusy(null); }
  }

  exportConfigFile() {
    const { blob, filename } = exportConfig(this.engine.config);
    download(blob, filename);
    this.toast(`Saved ${filename}`);
  }

  importConfigFile() {
    const input = el('input', { type: 'file', accept: '.json' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const cfg = fromJSON(await file.text());
        const name = this.engine.config.name;
        this.engine.setConfig({ ...cfg, name: cfg.name || name });
        buildPanels(this.rail, this.engine, this);
        renderLightList(this, this.engine);
        await this.resize();
        this.toast(`Loaded ${file.name}`);
      } catch (err) {
        this.toast(`Not a valid render config: ${err.message}`, 'warn');
      }
    });
    input.click();
  }

  // ── chrome ────────────────────────────────────────────────────────────────

  setBusy(text) {
    this.busy = Boolean(text);
    const badge = document.getElementById('busy-badge');
    badge.style.display = text ? 'block' : 'none';
    badge.textContent = text || '';
    document.getElementById('btn-export').disabled = this.busy;
  }

  setProgress(p) {
    document.getElementById('progress-bar').style.width = `${Math.round(p * 100)}%`;
  }

  toast(message, kind = '') {
    const box = document.getElementById('toast');
    box.textContent = message;
    box.className = `badge ${kind}`;
    box.style.display = 'block';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { box.style.display = 'none'; }, 4200);
  }

  updateStatus() {
    const cfg = this.engine.config;
    const bits = [
      `${cfg.render.width}×${cfg.render.height}`,
      `${cfg.camera.focalLength}mm ${cfg.camera.projection === 'orthographic' ? 'ortho' : ''}`.trim(),
      `az ${Math.round(cfg.camera.azimuth)}° el ${Math.round(cfg.camera.elevation)}°`,
      cfg.lighting.preset,
      cfg.look.tonemap.toUpperCase()
    ];
    if (cfg.render.engine === 'pathtrace' && this.engine.pathTracer) {
      const pct = Math.round(this.engine.pathTraceProgress * 100);
      bits.push(`path tracing ${this.engine.pathTracer.samples}/${cfg.render.pathtrace.samples} spp (${pct}%)`);
    }
    document.getElementById('status-left').textContent = bits.join('  ·  ');

    const warnings = validate(cfg);
    document.getElementById('status-right').textContent = warnings.length ? warnings[0] : '';
    this.updateFrameCount();
  }

  // ── session ───────────────────────────────────────────────────────────────

  saveSession() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        localStorage.setItem('obj-render-studio:config', JSON.stringify(this.engine.config));
      } catch { /* private mode, quota — the app works fine without persistence */ }
    }, 500);
  }

  restoreSession() {
    try {
      const saved = localStorage.getItem('obj-render-studio:config');
      if (!saved) return;
      const cfg = fromJSON(saved);
      this.engine.setConfig(cfg);
      buildPanels(this.rail, this.engine, this);
      renderLightList(this, this.engine);
      this.resize();
      this.toast('Restored your last session');
    } catch { /* corrupt or stale — start fresh */ }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap180 = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };

/** Recursively read a dropped folder, so an entire model directory works. */
async function collectFiles(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(dataTransfer.files || [])];

  const files = [];
  const walk = (entry, path = '') => new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => {
        Object.defineProperty(file, 'webkitRelativePath', { value: path + file.name, configurable: true });
        files.push(file);
        resolve();
      }, resolve);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = () => reader.readEntries(async (batch) => {
        if (!batch.length) return resolve();
        await Promise.all(batch.map((e) => walk(e, `${path}${entry.name}/`)));
        readAll();
      }, resolve);
      readAll();
    } else resolve();
  });

  await Promise.all(entries.map((e) => walk(e)));
  return files;
}

const studio = new Studio();
studio.init().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    `<pre style="padding:24px;color:#ff8080;white-space:pre-wrap">Studio failed to start:\n\n${err.stack || err.message}</pre>`;
});
window.studio = studio;
