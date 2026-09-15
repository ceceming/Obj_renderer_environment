import * as THREE from 'three';
import { WebGLPathTracer, PhysicalCamera, ShapedAreaLight } from 'three-gpu-pathtracer';
import { placeOnSphere, emitterSpec } from './environment.js';

/**
 * Hero-quality rendering.
 *
 * The raster pipeline is fast and looks good, but it fakes three things that
 * matter for a final image: light bounces between surfaces, true refraction
 * through glass, and real optical bokeh. A path tracer computes all three by
 * following light paths, and converges towards the physically correct answer
 * the longer you let it run.
 *
 * Use raster while you art-direct; switch to this for the shot you deliver.
 *
 * Light is supplied differently here, and deliberately so. The raster path
 * bakes every softbox into one environment map, which is fast but leaves a
 * path tracer guessing: it has to find those small, very bright regions by
 * chance, and until it does the image is black with a scattering of fireflies.
 *
 * So the tracer instead gets each softbox as a real analytic area light, which
 * it can sample directly (next-event estimation) and converge on in a handful
 * of samples, plus a *sky-only* environment for ambient. The softboxes are
 * excluded from that environment, because counting them as both a light and an
 * emissive background would double their contribution.
 */
/**
 * What the traced image should show behind the subject.
 * `null` means a transparent background, which the tracer renders as alpha 0.
 */
function resolveTraceBackground(cfg, equirect) {
  const mode = cfg.output.backgroundMode;
  if (mode === 'transparent') return null;
  if (mode === 'white') return new THREE.Color(0xffffff);
  if (mode === 'black') return new THREE.Color(0x000000);
  if (mode === 'custom') return new THREE.Color(cfg.output.customBackground || '#ffffff');

  switch (cfg.background.type) {
    case 'transparent': return null;
    case 'environment': return equirect || null;
    case 'gradient': return new THREE.Color(cfg.background.gradient?.bottom || '#cccccc');
    case 'studio-cyc': return new THREE.Color(cfg.background.cyc?.color || '#ededf0');
    default: return new THREE.Color(cfg.background.color || '#ffffff');
  }
}

export class PathTracerRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    this.tracer = new WebGLPathTracer(renderer);
    this.tracer.renderToCanvas = true;
    this.tracer.renderDelay = 0;
    this.tracer.minSamples = 1;
    this.tracer.fadeDuration = 0;
    this.targetSamples = 256;
    this._camera = null;
    this._sceneSignature = null;
    this._physicalCamera = null;
  }

  get samples() { return this.tracer.samples; }
  get target() { return this.tracer.target; }

  /**
   * (Re)build the BVH and upload the scene. This is the expensive step — it is
   * skipped whenever nothing structural has changed, so tweaking exposure or
   * orbiting the camera stays instant.
   */
  async build(scene, camera, cfg, { width, height, envMap, equirect, model, subjectSize, box }) {
    // eslint-disable-next-line no-unused-vars -- kept async for call-site symmetry
    const pt = cfg.render.pathtrace;
    this.targetSamples = Math.max(1, pt.samples ?? 256);

    this.tracer.bounces = pt.bounces ?? 6;
    this.tracer.transmissiveBounces = pt.transmissiveBounces ?? 4;
    this.tracer.filterGlossyFactor = pt.filterGlossy ?? 0.1;
    this.tracer.multipleImportanceSampling = pt.multipleImportanceSampling !== false;
    this.tracer.tiles.set(pt.tiles ?? 2, pt.tiles ?? 2);
    this.tracer.renderScale = 1;
    // Deterministic noise, so re-rendering the same frame gives the same
    // result — essential for animation, where drifting noise reads as flicker.
    this.tracer.stableNoise = Boolean(cfg.animation.enabled);

    // A physical camera gives real aperture-driven depth of field.
    this._physicalCamera = this._syncPhysicalCamera(camera, cfg, box);

    const signature = this._signature(cfg, model, width, height, Boolean(equirect));
    const camOnly = this._sceneSignature === signature;

    if (camOnly) {
      this.tracer.updateCamera();
      return;
    }

    // Build a scene that contains only what the path tracer should see: the
    // model and the set pieces. The raster stand-in lights are excluded.
    const traceScene = new THREE.Scene();
    // The path tracer samples the environment directly and needs readable
    // equirectangular data; a PMREM texture has none, which is why the raster
    // environment cannot simply be reused here.
    traceScene.environment = equirect || envMap || null;
    traceScene.environmentIntensity = cfg.lighting.envIntensity ?? 1;
    traceScene.environmentRotation = new THREE.Euler(0, (cfg.lighting.envRotation ?? 0) * Math.PI / 180, 0);
    traceScene.backgroundRotation = traceScene.environmentRotation;
    traceScene.backgroundBlurriness = cfg.background.envBlur ?? 0;
    traceScene.backgroundIntensity = cfg.background.envIntensity ?? 1;
    traceScene.background = resolveTraceBackground(cfg, equirect);

    if (model) {
      const traced = model.clone(true);
      // Ray tracing respects geometric winding, unlike raster shading, so a
      // model whose faces are wound inward renders as a black silhouette. A
      // great many OBJ exports in the wild are wound inconsistently, so the
      // traced copy is forced double-sided: the cost is negligible and it turns
      // a baffling black render into a correct one.
      traced.traverse((o) => {
        if (!o.isMesh) return;
        o.material = [].concat(o.material).map((m) => {
          if (!m) return m;
          const c = m.clone();
          c.side = THREE.DoubleSide;
          return c;
        });
        if (!Array.isArray(model.material)) o.material = o.material[0];
      });
      traceScene.add(traced);
    }

    // Explicit area lights — the reason this converges instead of speckling.
    for (const light of this._buildAreaLights(cfg, subjectSize)) traceScene.add(light);
    for (const child of scene.children) {
      if (child.name === 'Backdrop') {
        const c = child.clone(true);
        // Shadow catchers are a raster trick; the path tracer produces real
        // shadows on real geometry, so they would only darken the image twice.
        c.traverse((o) => { if (o.userData?.isShadowCatcher) o.visible = false; });
        traceScene.add(c);
      }
    }
    traceScene.updateMatrixWorld(true);

    // setSceneAsync() requires a BVH web worker to be registered first; the
    // synchronous build needs no worker and behaves identically. It blocks
    // while the BVH is constructed, which is a one-off cost paid only when the
    // geometry actually changes — camera moves and grading reuse the same tree.
    this.tracer.setScene(traceScene, this._physicalCamera || camera);
    this._sceneSignature = signature;
    this._traceScene = traceScene;
  }

  /** One analytic area light per enabled rig light, matching the raster rig. */
  _buildAreaLights(cfg, subjectSize = 1) {
    const out = [];
    const L = cfg.lighting;
    const globalIntensity = L.intensity ?? 1;
    const rotation = (L.envRotation ?? 0) * Math.PI / 180;

    for (const def of L.environment.lights || []) {
      if (def.enabled === false) continue;
      const spec = emitterSpec(def, globalIntensity, subjectSize);
      if (spec.radiance <= 0.0001) continue;

      // Role weighting matches lighting.js so the two engines agree on ratios.
      const roleScale =
        def.role === 'fill' ? 1.0 / Math.max(0.2, (L.keyToFill ?? 4) / 4) :
        def.role === 'rim' || def.role === 'kick' ? (L.rimStrength ?? 1) :
        def.role === 'bounce' ? (L.bounceStrength ?? 0.5) * 2 : 1.0;

      const area = new ShapedAreaLight(spec.color, spec.radiance * roleScale, spec.width, spec.height);
      area.isCircular = spec.circular;
      placeOnSphere(area.position, def.azimuth, def.elevation, spec.distance);
      area.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
      area.lookAt(0, subjectSize * 0.5, 0);
      out.push(area);
    }

    // The sun is directional, and stays directional.
    const sky = L.environment.sky || {};
    if (sky.sunEnabled && L.environment.type === 'procedural') {
      const sun = new THREE.DirectionalLight(
        new THREE.Color(sky.sunColor || '#fff4e0'),
        (sky.sunIntensity ?? 6) * globalIntensity
      );
      placeOnSphere(sun.position, (sky.sunAzimuth ?? 130) + (L.envRotation ?? 0), sky.sunElevation ?? 35, 12 * subjectSize);
      out.push(sun);
    }
    return out;
  }

  _syncPhysicalCamera(camera, cfg, box) {
    if (!cfg.camera.dof?.enabled || camera.isOrthographicCamera) {
      this._physicalCamera = null;
      return null;
    }
    const pc = this._physicalCamera || new PhysicalCamera();
    pc.copy(camera, true);
    pc.fov = camera.fov;
    pc.aspect = camera.aspect;
    pc.near = camera.near;
    pc.far = camera.far;
    // fStop maps straight through — this is a real lens model, not a blur hack.
    pc.fStop = Math.max(0.7, cfg.camera.dof.fStop ?? 2.8);
    pc.focusDistance = Math.max(0.01, cfg.camera.dof.focusDistance ?? 2);
    if (cfg.camera.dof.focusMode !== 'manual' && box) {
      const target = camera.userData?.target || box.getCenter(new THREE.Vector3());
      pc.focusDistance = camera.position.distanceTo(target);
    }
    pc.bokehSize = 0;      // derived from fStop internally
    pc.apertureBlades = cfg.camera.dof.bokehBlades ?? 6;
    pc.apertureRotation = (cfg.camera.dof.bokehRotation ?? 0) * Math.PI / 180;
    pc.updateProjectionMatrix();
    pc.updateMatrixWorld(true);
    this._physicalCamera = pc;
    return pc;
  }

  /** Anything in here changing forces a full BVH/material re-upload. */
  _signature(cfg, model, width, height, hasEquirect) {
    return JSON.stringify({
      env: hasEquirect,
      m: model?.uuid,
      mat: cfg.material,
      mdl: cfg.model,
      bg: cfg.background,
      light: cfg.lighting,
      pt: cfg.render.pathtrace,
      w: width, h: height
    });
  }

  renderSample() {
    if (this.tracer.isCompiling) return;
    this.tracer.renderSample();
  }

  /** Draw the accumulated buffer to the canvas (the tracer normally does this). */
  blitToScreen() {
    this.tracer.renderSample();
  }

  /**
   * Read the accumulated image back as linear float data — the basis for
   * true 32-bit EXR output with full highlight range intact.
   */
  readFloatPixels() {
    const target = this.tracer.target;
    if (!target) return null;
    const { width, height } = target;
    const buffer = new Float32Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
    return { data: buffer, width, height };
  }

  reset() { this.tracer.reset(); }

  dispose() {
    this.tracer.dispose();
    this._sceneSignature = null;
  }
}
