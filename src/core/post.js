import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SavePass } from 'three/examples/jsm/postprocessing/SavePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { SSAARenderPass } from 'three/examples/jsm/postprocessing/SSAARenderPass.js';
import { TAARenderPass } from 'three/examples/jsm/postprocessing/TAARenderPass.js';
import { LUTPass } from 'three/examples/jsm/postprocessing/LUTPass.js';
import { GradeShader, FilmicShader, HalationShader, AlphaRestoreShader } from './shaders.js';
import { hexToRGB } from './color.js';
import { resolveFocusDistance, apertureToBokehScale } from './camera.js';
import { isTransparentOutput } from './background.js';

export const TONEMAP_MAP = {
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  linear: THREE.LinearToneMapping
};

/**
 * The post chain.
 *
 * Built once per configuration change and reused every frame. The passes run in
 * a deliberate order — see shaders.js for why — and, when the output needs an
 * alpha channel, the original alpha is stashed immediately after the render
 * pass and restored at the very end, because bloom, AO and DOF all destroy it.
 */
export class PostPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.composer = null;
    this.passes = {};
    this.width = 1;
    this.height = 1;
    this._time = 0;
  }

  build(scene, camera, cfg, width, height) {
    this.dispose();
    this.width = width;
    this.height = height;

    const look = cfg.look;
    const transparent = isTransparentOutput(cfg);

    const targetOptions = {
      type: THREE.HalfFloatType,       // keep HDR headroom through the whole chain
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      samples: cfg.render.antialias === 'msaa' ? 4 : 0
    };
    const target = new THREE.WebGLRenderTarget(width, height, targetOptions);
    const composer = new EffectComposer(this.renderer, target);
    composer.setSize(width, height);
    composer.setPixelRatio(1);
    this.composer = composer;

    // ── 1. Base render ──────────────────────────────────────────────────────
    let renderPass;
    if (cfg.render.antialias === 'ssaa2' || cfg.render.antialias === 'ssaa4') {
      renderPass = new SSAARenderPass(scene, camera);
      renderPass.sampleLevel = cfg.render.antialias === 'ssaa4' ? 3 : 2;
      renderPass.unbiased = true;
      renderPass.clearAlpha = transparent ? 0 : 1;
    } else if (cfg.render.antialias === 'taa') {
      renderPass = new TAARenderPass(scene, camera);
      renderPass.sampleLevel = 2;
      renderPass.unbiased = true;
    } else {
      renderPass = new RenderPass(scene, camera);
    }
    renderPass.clearAlpha = transparent ? 0 : 1;
    composer.addPass(renderPass);
    this.passes.render = renderPass;

    // ── 2. Stash alpha before anything can destroy it ───────────────────────
    let savePass = null;
    if (transparent) {
      savePass = new SavePass(new THREE.WebGLRenderTarget(width, height, targetOptions));
      composer.addPass(savePass);
      this.passes.save = savePass;
    }

    // ── 3. Ambient occlusion (linear space, before everything optical) ──────
    if (look.ao?.enabled) {
      const ao = new GTAOPass(scene, camera, width, height);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = look.ao.intensity ?? 1;
      ao.updateGtaoMaterial({
        radius: (look.ao.radius ?? 0.35) * 2.0,
        distanceExponent: look.ao.distanceFalloff ?? 1,
        thickness: 1.0,
        scale: 1.0,
        samples: Math.max(4, Math.min(32, look.ao.samples ?? 16)),
        screenSpaceRadius: false
      });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: look.ao.denoise ? 4 : 0, radiusExponent: 1, rings: 2, samples: 16 });
      composer.addPass(ao);
      this.passes.ao = ao;
    }

    // ── 4. Depth of field ───────────────────────────────────────────────────
    if (cfg.camera.dof?.enabled) {
      const bokeh = new BokehPass(scene, camera, {
        focus: 1.0, aperture: 0.0001, maxblur: cfg.camera.dof.maxBlur ?? 0.012
      });
      composer.addPass(bokeh);
      this.passes.bokeh = bokeh;
    }

    // ── 5. Bloom ────────────────────────────────────────────────────────────
    if (look.bloom?.enabled) {
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        look.bloom.intensity ?? 0.22,
        look.bloom.radius ?? 0.5,
        1.0 - (look.bloom.threshold ?? 0.85)
      );
      // UnrealBloomPass treats `threshold` as a luminance cut in the *current*
      // buffer, which is linear HDR here, so map it onto a sensible HDR range.
      bloom.threshold = look.bloom.threshold ?? 0.85;
      composer.addPass(bloom);
      this.passes.bloom = bloom;
    }

    // ── 6. Halation ─────────────────────────────────────────────────────────
    if (look.halation?.enabled) {
      const hal = new ShaderPass(HalationShader);
      hal.uniforms.uResolution.value.set(width, height);
      composer.addPass(hal);
      this.passes.halation = hal;
    }

    // ── 7. Primary grade, still in linear light ─────────────────────────────
    const grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
    this.passes.grade = grade;

    // ── 8. Tone map + convert to display colour space ───────────────────────
    const output = new OutputPass();
    composer.addPass(output);
    this.passes.output = output;

    // ── 9. Creative LUT (display space) ─────────────────────────────────────
    if (look.lut?.enabled && cfg.__lutTexture) {
      const lut = new LUTPass({ lut: cfg.__lutTexture, intensity: look.lut.intensity ?? 1 });
      composer.addPass(lut);
      this.passes.lut = lut;
    }

    // ── 10. Lens + film finishing ───────────────────────────────────────────
    const needsFilmic =
      look.chromaticAberration?.enabled || look.sharpen?.enabled ||
      look.vignette?.enabled || look.grain?.enabled;
    if (needsFilmic) {
      const filmic = new ShaderPass(FilmicShader);
      filmic.uniforms.uResolution.value.set(width, height);
      composer.addPass(filmic);
      this.passes.filmic = filmic;
    }

    // ── 11. Anti-aliasing on the final image ────────────────────────────────
    if (cfg.render.antialias === 'smaa') {
      const smaa = new SMAAPass();
      smaa.setSize(width, height);
      composer.addPass(smaa);
      this.passes.smaa = smaa;
    }

    // ── 12. Put the alpha back ──────────────────────────────────────────────
    if (transparent && savePass) {
      const restore = new ShaderPass(AlphaRestoreShader);
      restore.uniforms.tAlpha.value = savePass.renderTarget.texture;
      restore.uniforms.uStrength.value = cfg.output.alphaShadowStrength ?? 1;
      composer.addPass(restore);
      this.passes.alphaRestore = restore;
    }

    // Everything above writes to a render target; the last pass goes to screen.
    const last = composer.passes[composer.passes.length - 1];
    last.renderToScreen = true;

    this.update(cfg, camera, null);
    return composer;
  }

  /** Cheap per-frame / per-edit uniform refresh — no rebuild needed. */
  update(cfg, camera, box) {
    const look = cfg.look;
    const p = this.passes;

    this.renderer.toneMapping = TONEMAP_MAP[look.tonemap] ?? THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;   // exposure is handled in the grade

    if (p.grade) {
      const u = p.grade.uniforms;
      u.uExposure.value = look.exposure ?? 1;
      u.uContrast.value = look.contrast ?? 1;
      u.uSaturation.value = look.saturation ?? 1;
      u.uTemperature.value = (look.temperatureShift ?? 0) / 100;
      u.uTint.value = (look.tintShift ?? 0) / 100;
      const lift = hexToRGB(look.lift || '#000000');
      const gamma = hexToRGB(look.gamma || '#808080');
      const gain = hexToRGB(look.gain || '#ffffff');
      u.uLift.value.set(lift.r, lift.g, lift.b);
      // 0.5 grey is neutral: map 0..1 onto a useful gamma range around 1.0.
      u.uGamma.value.set(gammaCurve(gamma.r), gammaCurve(gamma.g), gammaCurve(gamma.b));
      u.uGain.value.set(gain.r * 2, gain.g * 2, gain.b * 2);
    }

    if (p.bloom) {
      p.bloom.strength = look.bloom.intensity ?? 0.22;
      p.bloom.radius = look.bloom.radius ?? 0.5;
      p.bloom.threshold = look.bloom.threshold ?? 0.85;
    }

    if (p.halation) {
      p.halation.uniforms.uAmount.value = look.halation.amount ?? 0;
      p.halation.uniforms.uThreshold.value = look.halation.threshold ?? 0.9;
      p.halation.uniforms.uTint.value.set(look.halation.tint || '#ff7a3c');
    }

    if (p.ao) {
      p.ao.blendIntensity = look.ao.intensity ?? 1;
      if (p.ao.gtaoMaterial) {
        p.ao.gtaoMaterial.uniforms.radius && (p.ao.gtaoMaterial.uniforms.radius.value = (look.ao.radius ?? 0.35) * 2);
      }
    }

    if (p.filmic) {
      const u = p.filmic.uniforms;
      u.uCA.value = look.chromaticAberration?.enabled ? look.chromaticAberration.amount ?? 0 : 0;
      u.uSharpen.value = look.sharpen?.enabled ? look.sharpen.amount ?? 0 : 0;
      u.uVignette.value = look.vignette?.enabled ? look.vignette.amount ?? 0 : 0;
      u.uVignetteOffset.value = look.vignette?.offset ?? 0.9;
      u.uVignetteRoundness.value = look.vignette?.roundness ?? 1;
      u.uGrain.value = look.grain?.enabled ? look.grain.amount ?? 0 : 0;
      u.uGrainSize.value = look.grain?.size ?? 1;
      u.uGrainColored.value = look.grain?.colored ? 1 : 0;
      u.uTime.value = this._time;
    }

    if (p.bokeh && camera && box) {
      const focus = resolveFocusDistance(camera, cfg, box);
      p.bokeh.uniforms.focus.value = focus;
      p.bokeh.uniforms.maxblur.value = apertureToBokehScale(cfg);
      p.bokeh.uniforms.aperture.value = 0.00001 + (1 / Math.max(0.7, cfg.camera.dof.fStop)) * 0.0004;
    }

    if (p.alphaRestore) {
      p.alphaRestore.uniforms.uStrength.value = cfg.output.alphaShadowStrength ?? 1;
    }

    if (p.lut && cfg.__lutTexture) {
      p.lut.lut = cfg.__lutTexture;
      p.lut.intensity = look.lut.intensity ?? 1;
    }
  }

  /** Advance animated effects (grain). Deterministic when given a frame index. */
  setTime(t) { this._time = t; }

  setSize(width, height) {
    if (!this.composer) return;
    this.width = width; this.height = height;
    this.composer.setSize(width, height);
    for (const key of ['ao', 'bloom', 'smaa', 'bokeh', 'save']) {
      this.passes[key]?.setSize?.(width, height);
    }
    this.passes.filmic?.uniforms.uResolution.value.set(width, height);
    this.passes.halation?.uniforms.uResolution.value.set(width, height);
    if (this.passes.alphaRestore && this.passes.save) {
      this.passes.save.renderTarget.setSize(width, height);
      this.passes.alphaRestore.uniforms.tAlpha.value = this.passes.save.renderTarget.texture;
    }
  }

  render(deltaTime = 0.016) {
    if (this.composer) this.composer.render(deltaTime);
  }

  dispose() {
    if (!this.composer) return;
    for (const pass of this.composer.passes) pass.dispose?.();
    this.composer.renderTarget1?.dispose();
    this.composer.renderTarget2?.dispose();
    this.passes.save?.renderTarget?.dispose();
    this.composer = null;
    this.passes = {};
  }
}

/** Map a 0..1 grading-wheel value onto a useful gamma exponent (0.5 = neutral). */
function gammaCurve(v) {
  return THREE.MathUtils.clamp(1 + (v - 0.5) * 1.6, 0.1, 4.0);
}
