import * as THREE from 'three';
import { defaultConfig, mergeConfig, validate } from './schema.js';
import { loadModel, normalizeModel, applySmoothing, disposeObject, analyse } from './loaders.js';
import { EnvironmentBuilder } from './environment.js';
import { LightRig, shadowMapTypeFor } from './lighting.js';
import { applyMaterials, setEnvMapIntensity } from './materials.js';
import { Backdrop, resolveClearColor, isTransparentOutput } from './background.js';
import { createCamera, applyCamera } from './camera.js';
import { PostPipeline, TONEMAP_MAP } from './post.js';

/**
 * RenderEngine — the one place a render is actually produced.
 *
 * The Studio UI, the headless CLI and the exported viewer all drive this same
 * class with the same config object, which is what guarantees that the image
 * you approve in the viewport is byte-for-byte the image that comes out of the
 * offline render at 4K.
 *
 * Work is split by dirty flag so that dragging a slider does not rebuild the
 * environment, and orbiting the camera does not rebuild anything at all.
 */

export const DIRTY = {
  MODEL: 'model',
  ENVIRONMENT: 'environment',
  LIGHTS: 'lights',
  MATERIALS: 'materials',
  BACKGROUND: 'background',
  CAMERA: 'camera',
  POST: 'post',
  SIZE: 'size'
};

export class RenderEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.config = defaultConfig();
    this.subjectSize = 1;
    this.box = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    this.model = null;
    this.mixer = null;
    this.clips = [];
    this._activeClip = 0;
    this._action = null;
    this.modelStats = null;
    this.warnings = [];
    this._dirty = new Set(Object.values(DIRTY));
    this._frame = 0;
    this._listeners = {};
    this._pathTracer = null;
    this._pathTracerModule = null;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: opts.antialias !== false,
      alpha: true,
      // Required so we can read the finished image back out for export.
      preserveDrawingBuffer: true,
      powerPreference: opts.powerPreference || 'high-performance',
      stencil: false,
      depth: true
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(opts.pixelRatio ?? 1);

    this.scene = new THREE.Scene();
    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'ModelRoot';
    this.scene.add(this.modelRoot);

    this.envBuilder = new EnvironmentBuilder(this.renderer);
    this.lightRig = new LightRig();
    this.scene.add(this.lightRig.group);
    this.backdrop = new Backdrop();
    this.post = new PostPipeline(this.renderer);

    this.camera = createCamera(this.config, 1);
    this.scene.add(this.camera);

    this._envMap = null;
    this._backgroundCube = null;
  }

  // ── events ────────────────────────────────────────────────────────────────
  on(event, fn) { (this._listeners[event] ||= []).push(fn); return this; }
  emit(event, payload) { (this._listeners[event] || []).forEach((f) => f(payload)); }

  // ── config ────────────────────────────────────────────────────────────────

  /**
   * Apply a partial config patch and mark the right things dirty.
   * Pass an explicit `dirty` array to override the inferred set.
   */
  patch(partial, dirty = null) {
    const before = this.config;
    this.config = mergeConfig(this.config, partial);
    const flags = dirty || inferDirty(partial);
    flags.forEach((f) => this._dirty.add(f));
    this.emit('config', { config: this.config, changed: Object.keys(partial), previous: before });
    return this.config;
  }

  setConfig(cfg) {
    this.config = mergeConfig(defaultConfig(), cfg);
    this._dirty = new Set(Object.values(DIRTY));
    this.emit('config', { config: this.config, changed: ['*'] });
  }

  get warningsList() { return [...this.warnings, ...validate(this.config)]; }

  // ── model ─────────────────────────────────────────────────────────────────

  async loadModelFrom({ url, name, files, onProgress }) {
    const result = await loadModel({ url, name, files, onProgress });
    this.setModel(result.object, result.stats, result.warnings);
    this.config.name = (name || 'model').replace(/\.[^.]+$/, '');
    return result;
  }

  setModel(object, stats = null, warnings = []) {
    if (this.model) {
      this.modelRoot.remove(this.model);
      disposeObject(this.model);
    }
    this.mixer = null;
    this.clips = object?.userData?.animations || [];
    this.model = object;
    this.modelStats = stats || analyse(object);
    this.warnings = warnings;
    this.modelRoot.add(object);
    if (this.clips.length) {
      this.mixer = new THREE.AnimationMixer(object);
      this._activeClip = 0;
    }
    this._dirty.add(DIRTY.MODEL);
    this._dirty.add(DIRTY.MATERIALS);
    this._dirty.add(DIRTY.CAMERA);
    this.emit('model', { object, stats: this.modelStats, warnings });
  }

  /**
   * Pose the model at an absolute time within one of its embedded clips.
   *
   * `setTime` rather than `update(delta)`: seeking to an absolute time means
   * frame N does not depend on frames 0..N-1, which is what keeps offline
   * renders deterministic and resumable.
   */
  setClipTime(seconds, clipIndex = this._activeClip ?? 0) {
    if (!this.mixer || !this.clips.length) return false;
    const clip = this.clips[Math.min(clipIndex, this.clips.length - 1)];
    if (!clip) return false;
    if (this._activeClip !== clipIndex || !this._action) {
      this.mixer.stopAllAction();
      this._action = this.mixer.clipAction(clip);
      this._action.play();
      this._activeClip = clipIndex;
    }
    this.mixer.setTime(0);                   // rewind, then seek: setTime is relative
    this.mixer.setTime(Math.max(0, seconds));
    this.modelRoot.updateMatrixWorld(true);
    return true;
  }

  get clipList() { return this.clips || []; }

  /** Build a simple stand-in so the studio is usable before anything is loaded. */
  loadPlaceholder() {
    const group = new THREE.Group();
    group.name = 'Placeholder';
    const knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.32, 0.105, 220, 40),
      new THREE.MeshPhysicalMaterial({ color: 0xd8dade, roughness: 0.22, metalness: 0.9, clearcoat: 0.4 })
    );
    knot.position.y = 0.5;
    knot.castShadow = knot.receiveShadow = true;
    group.add(knot);
    this.setModel(group, null, []);
    this.config.name = 'placeholder';
    return group;
  }

  // ── build steps ───────────────────────────────────────────────────────────

  _rebuildModel() {
    if (!this.model) return;
    applySmoothing(this.model, this.config);
    this.box = normalizeModel(this.model, this.config);
    const size = this.box.getSize(new THREE.Vector3());
    this.subjectSize = Math.max(size.x, size.y, size.z) || 1;
  }

  _rebuildEnvironment() {
    const L = this.config.lighting;
    const center = new THREE.Vector3(0, this.subjectSize * 0.5, 0);
    if (L.environment.type === 'hdri' && L.environment.hdriUrl) {
      // Async; the caller awaits prepare() which handles this branch.
      return;
    }
    const { envMap, backgroundCube } = this.envBuilder.build(L, {
      subjectSize: this.subjectSize,
      resolution: this.config.render.engine === 'pathtrace' ? 1024 : 512,
      center
    });
    this._envMap = envMap;
    this._backgroundCube = backgroundCube;
    this.scene.environment = envMap;
    this.scene.environmentIntensity = L.envIntensity ?? 1;
    this.scene.environmentRotation = new THREE.Euler(0, (L.envRotation ?? 0) * Math.PI / 180, 0);
    this.scene.backgroundRotation = this.scene.environmentRotation;
  }

  async _rebuildEnvironmentAsync() {
    const L = this.config.lighting;
    if (L.environment.type === 'hdri' && L.environment.hdriUrl) {
      const { envMap, background } = await this.envBuilder.fromHDRI(L.environment.hdriUrl);
      this._envMap = envMap;
      this._backgroundCube = background;
      this.scene.environment = envMap;
      this.scene.environmentIntensity = (L.envIntensity ?? 1) * (L.environment.hdriExposure ?? 1);
      this.scene.environmentRotation = new THREE.Euler(0, (L.envRotation ?? 0) * Math.PI / 180, 0);
      this.scene.backgroundRotation = this.scene.environmentRotation;
    } else {
      this._rebuildEnvironment();
    }
  }

  _rebuildLights() {
    const shadows = this.config.lighting.shadows;
    this.renderer.shadowMap.enabled = shadows.enabled && shadows.type !== 'none';
    this.renderer.shadowMap.type = shadowMapTypeFor(shadows.type);
    this.renderer.shadowMap.needsUpdate = true;
    const center = new THREE.Vector3(0, this.subjectSize * 0.5, 0);
    this.lightRig.build(this.config, this.subjectSize, center);
    this.lightRig.setRotation(this.config.lighting.envRotation ?? 0);
  }

  _rebuildMaterials() {
    if (!this.model) return;
    applyMaterials(this.model, this.config, { envMapIntensity: this.config.lighting.envIntensity ?? 1 });
  }

  _rebuildBackground(width, height) {
    this.backdrop.build(
      this.scene, this.config, this.subjectSize, this._backgroundCube, width / height
    );
    const { color, alpha } = resolveClearColor(this.config);
    this.renderer.setClearColor(color, alpha);
    // A forced white/black output overrides whatever set dressing is configured.
    const mode = this.config.output.backgroundMode;
    if (mode !== 'as-configured') {
      this.scene.background = alpha === 0 ? null : color;
    }
  }

  _rebuildCamera(width, height) {
    const wantOrtho = this.config.camera.projection === 'orthographic';
    const isOrtho = Boolean(this.camera.isOrthographicCamera);
    if (wantOrtho !== isOrtho) {
      this.scene.remove(this.camera);
      this.camera = createCamera(this.config, width / height);
      this.scene.add(this.camera);
      this._dirty.add(DIRTY.POST);
    }
    applyCamera(this.camera, this.config, this.box, width / height);
  }

  _rebuildPost(width, height) {
    this.post.build(this.scene, this.camera, this.config, width, height);
  }

  /**
   * Bring everything up to date. Call before rendering.
   * Async because HDRI loading and the path tracer are async.
   */
  async prepare({ width, height } = {}) {
    const w = width || this.canvas.width || this.config.render.width;
    const h = height || this.canvas.height || this.config.render.height;
    const d = this._dirty;

    if (d.has(DIRTY.MODEL)) { this._rebuildModel(); d.add(DIRTY.ENVIRONMENT); d.add(DIRTY.CAMERA); }
    if (d.has(DIRTY.ENVIRONMENT)) { await this._rebuildEnvironmentAsync(); d.add(DIRTY.LIGHTS); d.add(DIRTY.BACKGROUND); }
    if (d.has(DIRTY.LIGHTS)) this._rebuildLights();
    if (d.has(DIRTY.MATERIALS)) this._rebuildMaterials();
    if (d.has(DIRTY.BACKGROUND) || d.has(DIRTY.SIZE)) this._rebuildBackground(w, h);
    if (d.has(DIRTY.CAMERA) || d.has(DIRTY.SIZE)) this._rebuildCamera(w, h);
    if (d.has(DIRTY.POST) || d.has(DIRTY.SIZE) || d.has(DIRTY.ENVIRONMENT) || d.has(DIRTY.LIGHTS)) {
      this._rebuildPost(w, h);
    } else {
      this.post.update(this.config, this.camera, this.box);
    }

    if (this.config.render.engine === 'pathtrace') {
      await this._ensurePathTracer(w, h);
    } else if (this._pathTracer) {
      this._pathTracer.dispose?.();
      this._pathTracer = null;
    }

    this._dirty.clear();
    this.emit('prepared', { width: w, height: h });
  }

  /** Mark something dirty from outside (e.g. after a light gizmo drag). */
  invalidate(...flags) {
    (flags.length ? flags : Object.values(DIRTY)).forEach((f) => this._dirty.add(f));
  }

  get isDirty() { return this._dirty.size > 0; }

  // ── rendering ─────────────────────────────────────────────────────────────

  setSize(width, height, pixelRatio = 1) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.post.setSize(width * pixelRatio, height * pixelRatio);
    this._dirty.add(DIRTY.SIZE);
  }

  /** Render one frame with the raster pipeline. */
  renderFrame(deltaTime = 1 / 60) {
    const cfg = this.config;

    // Contact shadows must be regenerated before the beauty pass, and they
    // need the model's *current* transform, so this runs every frame while
    // anything is animating.
    if (this.lightRig.contactShadows) {
      this.lightRig.updateContactShadows(this.renderer, this.scene);
    }
    if (this.backdrop.reflector) {
      // Reflector renders itself during scene traversal; nothing to do here.
    }

    this.post.setTime(cfg.animation.enabled ? this._frame / Math.max(1, cfg.animation.fps) : this._frame * 0.016);
    this.post.update(cfg, this.camera, this.box);
    this.post.render(deltaTime);
    this._frame++;
  }

  /** Render with whichever engine the config selects. */
  async render(deltaTime = 1 / 60) {
    if (this.config.render.engine === 'pathtrace' && this._pathTracer) {
      return this._renderPathTraced();
    }
    this.renderFrame(deltaTime);
  }

  // ── path tracer ───────────────────────────────────────────────────────────

  async _ensurePathTracer(width, height) {
    if (!this._pathTracerModule) {
      this._pathTracerModule = await import('./pathtracer.js');
    }
    if (!this._pathTracer) {
      this._pathTracer = new this._pathTracerModule.PathTracerRenderer(this.renderer);
    }
    await this._pathTracer.build(this.scene, this.camera, this.config, {
      width, height,
      envMap: this._envMap,
      // Sky only: the softboxes reach the tracer as analytic area lights.
      equirect: this.envBuilder.buildSkyEquirect(this.config.lighting, {
        subjectSize: this.subjectSize,
        center: new THREE.Vector3(0, this.subjectSize * 0.5, 0)
      }),
      model: this.model, subjectSize: this.subjectSize, box: this.box
    });
  }

  _renderPathTraced() {
    this._pathTracer.renderSample();
    this._frame++;
    return { samples: this._pathTracer.samples, target: this._pathTracer.targetSamples };
  }

  get pathTracer() { return this._pathTracer; }

  /** Progress 0..1 for the current path-traced image. */
  get pathTraceProgress() {
    if (!this._pathTracer) return 1;
    return Math.min(1, this._pathTracer.samples / this._pathTracer.targetSamples);
  }

  resetAccumulation() {
    this._pathTracer?.reset();
  }

  // ── capture ───────────────────────────────────────────────────────────────

  /**
   * Render at an arbitrary resolution and return the canvas contents.
   * Temporarily resizes everything, so what you get is exactly the viewport
   * composition at a different pixel count.
   */
  async renderAtSize(width, height, { onProgress } = {}) {
    const prevW = this.canvas.width, prevH = this.canvas.height;
    const prevRatio = this.renderer.getPixelRatio();
    let accumCanvas = null;

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height);
    this._dirty.add(DIRTY.SIZE);
    await this.prepare({ width, height });

    if (this.config.render.engine === 'pathtrace' && this._pathTracer) {
      const target = this._pathTracer.targetSamples;
      while (this._pathTracer.samples < target) {
        this._pathTracer.renderSample();
        if (onProgress) onProgress(this._pathTracer.samples / target);
        // Yield so the browser stays responsive and the CLI can poll progress.
        if (this._pathTracer.samples % 8 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      this._pathTracer.blitToScreen();
    } else if (this.config.render.accumulate?.enabled) {
      accumCanvas = await this._renderAccumulated(this.config.render.accumulate.frames, onProgress);
    } else {
      this.renderFrame(0);
    }

    return {
      // Accumulation composites on the CPU, so it hands back its own surface.
      canvas: accumCanvas || this.canvas,
      restore: async () => {
        this.renderer.setPixelRatio(prevRatio);
        this.renderer.setSize(prevW / prevRatio, prevH / prevRatio, false);
        this.post.setSize(prevW, prevH);
        this._dirty.add(DIRTY.SIZE);
        await this.prepare({ width: prevW, height: prevH });
      }
    };
  }

  /**
   * Progressive raster accumulation: jitter the projection by sub-pixel amounts
   * and average. Costs N frames and buys clean edges plus softer shadow noise
   * without paying for a full path trace.
   */
  async _renderAccumulated(frames, onProgress) {
    const { jitter = 0.5 } = this.config.render.accumulate;
    const w = this.canvas.width, h = this.canvas.height;
    const accum = new Float32Array(w * h * 4);
    const buf = new Uint8Array(w * h * 4);
    const gl = this.renderer.getContext();
    const baseProj = this.camera.projectionMatrix.clone();

    for (let i = 0; i < frames; i++) {
      const [jx, jy] = haltonPair(i + 1);
      this.camera.projectionMatrix.copy(baseProj);
      this.camera.projectionMatrix.elements[8] += ((jx - 0.5) * 2 * jitter) / w;
      this.camera.projectionMatrix.elements[9] += ((jy - 0.5) * 2 * jitter) / h;
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
      this.renderFrame(0);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      for (let p = 0; p < accum.length; p++) accum[p] += buf[p];
      if (onProgress) onProgress((i + 1) / frames);
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    this.camera.projectionMatrix.copy(baseProj);
    this.camera.projectionMatrixInverse.copy(baseProj).invert();

    // A WebGL canvas cannot also hand out a 2D context, so the averaged result
    // is composited onto a separate surface which becomes the capture source.
    const out = new Uint8ClampedArray(accum.length);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
      // readPixels returns rows bottom-up; flip them as we go.
      const src = (h - 1 - y) * rowBytes;
      const dst = y * rowBytes;
      for (let x = 0; x < rowBytes; x++) out[dst + x] = accum[src + x] / frames;
    }
    const surface = document.createElement('canvas');
    surface.width = w; surface.height = h;
    surface.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
    return surface;
  }

  dispose() {
    this.post.dispose();
    this.lightRig.dispose();
    this.backdrop.dispose(this.scene);
    this.envBuilder.dispose();
    this._pathTracer?.dispose?.();
    if (this.model) disposeObject(this.model);
    this.renderer.dispose();
  }
}

/** Which subsystems does this config patch affect? */
function inferDirty(partial) {
  const flags = new Set();
  if (partial.model) { flags.add(DIRTY.MODEL); flags.add(DIRTY.MATERIALS); flags.add(DIRTY.CAMERA); }
  if (partial.lighting) {
    flags.add(DIRTY.LIGHTS);
    if (partial.lighting.environment || partial.lighting.intensity !== undefined || partial.lighting.temperature !== undefined) {
      flags.add(DIRTY.ENVIRONMENT);
    }
    if (partial.lighting.envIntensity !== undefined) flags.add(DIRTY.MATERIALS);
  }
  if (partial.material) flags.add(DIRTY.MATERIALS);
  if (partial.background) flags.add(DIRTY.BACKGROUND);
  if (partial.camera) {
    flags.add(DIRTY.CAMERA);
    if (partial.camera.dof) flags.add(DIRTY.POST);
    if (partial.camera.projection) flags.add(DIRTY.POST);
  }
  if (partial.look) {
    flags.add(DIRTY.POST);
    // Toggling an effect on or off changes the pass list, so a rebuild is needed.
  }
  if (partial.render) { flags.add(DIRTY.POST); flags.add(DIRTY.SIZE); }
  if (partial.output) { flags.add(DIRTY.BACKGROUND); flags.add(DIRTY.POST); }
  if (flags.size === 0) flags.add(DIRTY.POST);
  return [...flags];
}

/** Halton sequence — well-distributed sub-pixel jitter, no clumping. */
function haltonPair(index) {
  const halton = (i, base) => {
    let f = 1, r = 0;
    while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); }
    return r;
  };
  return [halton(index, 2), halton(index, 3)];
}
