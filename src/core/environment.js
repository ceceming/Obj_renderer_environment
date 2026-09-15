import * as THREE from 'three';
import { hexToRGB, kelvinToRGB } from './color.js';

/**
 * Procedural environment (IBL) generator.
 *
 * Rather than shipping a folder of fixed HDRI files, we *build* the environment
 * from the light rig: a gradient sky dome, an optional sun disc, and one
 * emissive surface per softbox. That environment is then rendered into a
 * half-float cube map and pre-filtered with PMREM.
 *
 * Why this is the better approach for a rendering tool:
 *   - every light stays movable, resizable, re-colourable and animatable;
 *   - the specular highlight on a glossy surface is the *actual shape* of the
 *     softbox you positioned, which is the single biggest tell of a real
 *     product photograph;
 *   - the whole look travels in a 4 KB JSON file instead of a 40 MB .hdr;
 *   - and you can still drop in your own .hdr/.exr when you want one.
 */

const DEG = Math.PI / 180;

/**
 * Calibration constant for emissive area lights.
 *
 * Preset intensities are written in human terms ("a key at 5, a fill at 1.5"),
 * but what the environment actually needs is *radiance*. A 4x4 softbox at 2.6
 * units subtends roughly 2.4 steradians, so a radiance of 5 delivers an
 * irradiance near 10 — about ten stops hot, which saturates every channel and
 * leaves the tone mapper bleaching everything to white regardless of albedo.
 *
 * This factor converts the readable numbers into physically sane radiance, so
 * a mid-grey surface renders as mid-grey. It was set by rendering a calibration
 * sweep and measuring the result, not by eye.
 */
export const ENV_ENERGY_SCALE = 2.4;

/**
 * Reference emitter area (a 3x3 softbox).
 *
 * A light's `intensity` is its *power*, not its surface brightness — the same
 * convention photographers and Blender use. Radiance is therefore power spread
 * over the emitter's area, which is what makes the size sliders behave
 * correctly: growing a softbox softens its shadow without also making the shot
 * brighter, and a small hard spot at intensity 9 actually reads as bright
 * rather than disappearing because it covers so little of the sphere.
 */
export const REFERENCE_AREA = 9.0;

/**
 * Default brightness of the sky dome, per sky model.
 *
 * This is the correction for a mistake that is easy to make and hard to see:
 * a "studio" environment whose dome is painted near-white is not a subtle
 * gradient, it is an enormous uniform light source covering the entire sphere.
 * It delivers more irradiance than every softbox combined, so the rig goes
 * flat, shadows vanish and the tone mapper bleaches the colour out.
 *
 * A real studio is a dark room with a few bright sources in it. The dome
 * therefore stays dim for studio work — it stands in for wall bounce, nothing
 * more — while outdoor models keep it at full strength, because outdoors the
 * sky genuinely *is* the light.
 */
export const SKY_INTENSITY_BY_MODE = {
  studio: 0.32,
  daylight: 3.2,
  overcast: 3.2,
  sunset: 3.2,
  night: 3.2,
  gradient: 1.9
};

export function resolveSkyIntensity(sky = {}) {
  if (typeof sky.intensity === 'number') return sky.intensity;
  return SKY_INTENSITY_BY_MODE[sky.mode] ?? 1.0;
}

/** Spherical placement: azimuth 0 = +Z (front of subject), elevation 0 = horizon. */
export function placeOnSphere(target, azimuthDeg, elevationDeg, distance) {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  target.set(
    distance * Math.cos(el) * Math.sin(az),
    distance * Math.sin(el),
    distance * Math.cos(el) * Math.cos(az)
  );
  return target;
}

/** Resolve a light's emissive colour from its hex colour and Kelvin temperature. */
export function resolveLightColor(light) {
  const base = hexToRGB(light.color || '#ffffff');
  const k = kelvinToRGB(light.temperature ?? 6500);
  const ref = kelvinToRGB(6500);
  return new THREE.Color(
    (base.r * k.r) / ref.r,
    (base.g * k.g) / ref.g,
    (base.b * k.b) / ref.b
  );
}

/**
 * A feathered alpha ramp so softbox edges fade instead of ending in a hard
 * rectangle. `spread` 0 = crisp edge (a hard light), 1 = fully feathered.
 */
const gradientCache = new Map();
function softMask(spread, shape) {
  const key = `${shape}:${Math.round(spread * 20)}`;
  if (gradientCache.has(key)) return gradientCache.get(key);
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const feather = Math.max(0.001, spread) * 0.5;

  if (shape === 'disc' || shape === 'ring') {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    const inner = shape === 'ring' ? 0.62 : 0;
    if (shape === 'ring') {
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(Math.max(0, inner - feather), 'rgba(255,255,255,0)');
      g.addColorStop(Math.min(1, inner + feather * 0.5), 'rgba(255,255,255,1)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,1)');
    }
    g.addColorStop(Math.max(0.01, 1 - feather), 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  } else {
    // Rectangular softbox: feather both axes independently.
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / (S - 1), v = y / (S - 1);
        const du = Math.min(u, 1 - u) * 2;   // 0 at the edge, 1 at the centre
        const dv = Math.min(v, 1 - v) * 2;
        const f = Math.max(0.0001, feather * 2);
        const a = Math.min(1, du / f) * Math.min(1, dv / f);
        const i = (y * S + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(smoothstep(a) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  gradientCache.set(key, tex);
  return tex;
}
const smoothstep = (t) => t * t * (3 - 2 * t);

/** GLSL for the sky dome: three-stop vertical gradient plus an optional sun. */
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uGround, uSunColor, uSunDir;
uniform float uSunIntensity, uSunSize, uSunEnabled, uTurbidity, uGradientPower;

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  // Sky: horizon -> zenith above, horizon -> ground below.
  vec3 col;
  if (h >= 0.0) {
    float t = pow(clamp(h, 0.0, 1.0), uGradientPower);
    col = mix(uHorizon, uZenith, t);
    // Haze concentrates light near the horizon as turbidity rises.
    float haze = exp(-h * (12.0 / max(uTurbidity, 0.3)));
    col = mix(col, uHorizon * 1.15, haze * 0.35);
  } else {
    float t = pow(clamp(-h, 0.0, 1.0), 0.55);
    col = mix(uHorizon, uGround, t);
  }

  if (uSunEnabled > 0.5) {
    float cosAngle = dot(d, normalize(uSunDir));
    float sunCos = cos(radians(uSunSize));
    // Hard disc with a soft limb, plus a broad glow that sells the atmosphere.
    float disc = smoothstep(sunCos - 0.0006, sunCos + 0.0012, cosAngle);
    float glow = pow(max(cosAngle, 0.0), 220.0 / max(uTurbidity, 0.5)) * 0.55
               + pow(max(cosAngle, 0.0), 8.0) * 0.05 * uTurbidity;
    col += uSunColor * (disc * uSunIntensity + glow * uSunIntensity * 0.18);
  }

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

/** Build the throwaway scene that gets rendered into the cube map. */
export function buildEnvironmentScene(lightingCfg, { subjectSize = 1, skyOnly = false } = {}) {
  const env = lightingCfg.environment;
  const sky = env.sky || {};
  const scene = new THREE.Scene();
  const disposables = [];
  const skyIntensity = resolveSkyIntensity(sky) * (lightingCfg.intensity ?? 1);

  // ── Sky dome ──────────────────────────────────────────────────────────────
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uZenith: { value: new THREE.Color(sky.zenith || '#dfe7f2').convertSRGBToLinear().multiplyScalar(skyIntensity) },
      uHorizon: { value: new THREE.Color(sky.horizon || '#ffffff').convertSRGBToLinear().multiplyScalar(skyIntensity) },
      uGround: { value: new THREE.Color(sky.ground || '#8a8a8a').convertSRGBToLinear().multiplyScalar(skyIntensity) },
      uSunColor: { value: new THREE.Color(sky.sunColor || '#fff4e0').convertSRGBToLinear() },
      uSunDir: { value: placeOnSphere(new THREE.Vector3(), sky.sunAzimuth ?? 130, sky.sunElevation ?? 35, 1) },
      uSunIntensity: { value: (sky.sunIntensity ?? 6) * (lightingCfg.intensity ?? 1) },
      uSunSize: { value: Math.max(0.05, sky.sunAngularSize ?? 2) },
      uSunEnabled: { value: sky.sunEnabled ? 1 : 0 },
      uTurbidity: { value: sky.turbidity ?? 2.5 },
      uGradientPower: { value: sky.mode === 'overcast' ? 1.6 : sky.mode === 'studio' ? 0.9 : 0.55 }
    }
  });
  const skyGeo = new THREE.SphereGeometry(100, 48, 32);
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.name = '__sky';
  scene.add(skyMesh);
  disposables.push(skyGeo, skyMat);

  // ── Area lights as emissive surfaces ──────────────────────────────────────
  const globalIntensity = lightingCfg.intensity ?? 1;
  for (const light of skyOnly ? [] : (env.lights || [])) {
    if (light.enabled === false) continue;
    const mesh = buildEmitter(light, globalIntensity, subjectSize);
    if (mesh) { scene.add(mesh); disposables.push(mesh.geometry, mesh.material); }
  }

  scene.userData.dispose = () => disposables.forEach((d) => d.dispose && d.dispose());
  return scene;
}

/**
 * Emitter geometry and radiance for one rig light.
 * Shared by the raster environment and the path tracer's analytic area lights
 * so the two render the same brightness.
 */
export function emitterSpec(light, globalIntensity = 1, subjectSize = 1) {
  const w = (light.width ?? 2) * subjectSize;
  const h = (light.height ?? 2) * subjectSize;
  const circular = light.shape === 'disc' || light.shape === 'ring';
  const area = circular ? Math.PI * Math.pow(Math.max(w, h) / 2, 2) : w * h;
  const areaFactor = REFERENCE_AREA / Math.max(area, 0.02);
  return {
    width: w, height: h, circular, area,
    radiance: (light.intensity ?? 1) * globalIntensity * ENV_ENERGY_SCALE * areaFactor,
    color: resolveLightColor(light),
    distance: (light.distance ?? 3) * subjectSize
  };
}

function buildEmitter(light, globalIntensity, subjectSize) {
  const w = (light.width ?? 2) * subjectSize;
  const h = (light.height ?? 2) * subjectSize;
  let geo;
  switch (light.shape) {
    case 'disc': geo = new THREE.CircleGeometry(Math.max(w, h) / 2, 64); break;
    case 'ring': geo = new THREE.CircleGeometry(Math.max(w, h) / 2, 64); break;
    case 'strip':
    case 'rect':
    default: geo = new THREE.PlaneGeometry(w, h, 1, 1); break;
  }

  const color = resolveLightColor(light).convertSRGBToLinear();
  // Power -> radiance: divide by the emitter's own area.
  const area = (light.shape === 'disc' || light.shape === 'ring')
    ? Math.PI * Math.pow(Math.max(w, h) / 2, 2)
    : w * h;
  const areaFactor = REFERENCE_AREA / Math.max(area, 0.02);
  const power = (light.intensity ?? 1) * globalIntensity * ENV_ENERGY_SCALE * areaFactor;
  const mat = new THREE.MeshBasicMaterial({
    color: color.multiplyScalar(power),
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    alphaMap: softMask(light.spread ?? 1, light.shape || 'rect'),
    blending: THREE.AdditiveBlending
  });

  const mesh = new THREE.Mesh(geo, mat);
  placeOnSphere(mesh.position, light.azimuth, light.elevation, (light.distance ?? 3) * subjectSize);
  mesh.lookAt(0, 0, 0);
  mesh.userData.lightId = light.id;
  return mesh;
}

/**
 * Render the environment scene into a PMREM-filtered texture ready for
 * `scene.environment`. Also returns the raw cube target so the background can
 * show the un-filtered version if requested.
 */
/**
 * Cube map -> equirectangular float data.
 *
 * The raster path wants a PMREM-filtered texture, but the path tracer builds an
 * importance-sampling distribution on the CPU and therefore needs a real
 * equirectangular DataTexture it can read pixel data from. A PMREM texture has
 * no readable image data at all, so it has to be converted rather than reused.
 */
const EQUIRECT_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const EQUIRECT_FRAG = /* glsl */`
precision highp float;
uniform samplerCube tCube;
varying vec2 vUv;
#define PI 3.141592653589793
void main() {
  // Inverse of three's equirect lookup, so the result lines up exactly with
  // what the raster renderer shows.
  float theta = (vUv.x - 0.5) * 2.0 * PI;
  float phi = (vUv.y - 0.5) * PI;
  float r = cos(phi);
  vec3 dir = vec3(r * cos(theta), sin(phi), r * sin(theta));
  gl_FragColor = vec4(textureCube(tCube, dir).rgb, 1.0);
}`;

export function cubeToEquirectData(renderer, cubeTexture, width = 1024) {
  const height = Math.round(width / 2);
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: false,
    generateMipmaps: false
  });

  const material = new THREE.ShaderMaterial({
    uniforms: { tCube: { value: cubeTexture } },
    vertexShader: EQUIRECT_VERT,
    fragmentShader: EQUIRECT_FRAG,
    depthTest: false,
    depthWrite: false
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const prevTarget = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(target);
  renderer.render(quad, cam);

  const floats = new Float32Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, floats);

  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  quad.geometry.dispose();
  material.dispose();
  target.dispose();

  // Store as half float, not full float.
  //
  // Linear filtering of 32-bit float textures needs OES_texture_float_linear,
  // which plenty of drivers — including software rasterisers — do not provide.
  // Where it is missing the sampler silently returns garbage, and the symptom
  // is a path-traced render that comes out uniformly flat and unlit. Half float
  // filtering is effectively universal and loses nothing we can see.
  const data = new Uint16Array(floats.length);
  for (let i = 0; i < floats.length; i++) data[i] = THREE.DataUtils.toHalfFloat(clampHalf(floats[i]));

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Half float tops out at 65504; clamp so bright emitters do not become Infinity. */
const clampHalf = (v) => (Number.isFinite(v) ? Math.min(Math.max(v, -65504), 65504) : 0);

export class EnvironmentBuilder {
  constructor(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();
    this._cubeTarget = null;
    this._envMap = null;
    this._bgCube = null;
    this._equirect = null;
    this._equirectSource = null;
  }

  /**
   * An equirectangular DataTexture of the current environment, for the path
   * tracer. Built on demand and cached until the environment changes, because
   * it costs a full GPU-to-CPU readback.
   */
  /**
   * The sky dome alone, as equirectangular data.
   *
   * The path tracer samples the softboxes as explicit area lights, so its
   * environment must not also contain them — otherwise every source is counted
   * twice and the render comes out two stops hot.
   */
  buildSkyEquirect(lightingCfg, { subjectSize = 1, width = 512, center = new THREE.Vector3() } = {}) {
    const scene = buildEnvironmentScene(lightingCfg, { subjectSize, skyOnly: true });
    const cubeTarget = new THREE.WebGLCubeRenderTarget(256, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace, generateMipmaps: false
    });
    const cubeCam = new THREE.CubeCamera(0.1, 1000, cubeTarget);
    cubeCam.position.copy(center);

    const prevTarget = this.renderer.getRenderTarget();
    const prevTone = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;
    cubeCam.update(this.renderer, scene);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.toneMapping = prevTone;

    const texture = cubeToEquirectData(this.renderer, cubeTarget.texture, width);
    scene.userData.dispose();
    cubeTarget.dispose();

    if (this._skyEquirect) this._skyEquirect.dispose();
    this._skyEquirect = texture;
    return texture;
  }

  getEquirect(width = 1024) {
    if (this._equirectData) return this._equirectData;
    if (this._equirectSource) {
      // A user-supplied .hdr/.exr is already equirectangular float data.
      this._equirectData = this._equirectSource;
      return this._equirectData;
    }
    if (!this._cubeTarget) return null;
    this._equirectData = cubeToEquirectData(this.renderer, this._cubeTarget.texture, width);
    return this._equirectData;
  }

  /** @returns {{ envMap: THREE.Texture, backgroundCube: THREE.CubeTexture }} */
  build(lightingCfg, { subjectSize = 1, resolution = 512, center = new THREE.Vector3() } = {}) {
    this.disposeResults();

    const scene = buildEnvironmentScene(lightingCfg, { subjectSize });

    const cubeTarget = new THREE.WebGLCubeRenderTarget(resolution, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter
    });
    const cubeCam = new THREE.CubeCamera(0.1, 1000, cubeTarget);
    cubeCam.position.copy(center);

    const prevTarget = this.renderer.getRenderTarget();
    const prevTone = this.renderer.toneMapping;
    const prevExposure = this.renderer.toneMappingExposure;
    // The environment must be captured in *linear* light, untouched by the
    // display transform. Tone mapping happens later, once, on the beauty pass.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    cubeCam.update(this.renderer, scene);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.toneMapping = prevTone;
    this.renderer.toneMappingExposure = prevExposure;

    const envMap = this.pmrem.fromCubemap(cubeTarget.texture).texture;

    scene.userData.dispose();
    this._equirectData = null;   // invalidated by the rebuild
    this._cubeTarget = cubeTarget;
    this._envMap = envMap;
    return { envMap, backgroundCube: cubeTarget.texture };
  }

  /** Load a user-supplied .hdr / .exr instead of the procedural rig. */
  async fromHDRI(url, { loaderHint } = {}) {
    this.disposeResults();
    const isEXR = /\.exr($|\?)/i.test(url) || loaderHint === 'exr';
    const { EXRLoader } = isEXR
      ? await import('three/examples/jsm/loaders/EXRLoader.js')
      : { EXRLoader: null };
    const { RGBELoader } = !isEXR
      ? await import('three/examples/jsm/loaders/RGBELoader.js')
      : { RGBELoader: null };
    const Loader = isEXR ? EXRLoader : RGBELoader;
    const texture = await new Loader().loadAsync(url);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const envMap = this.pmrem.fromEquirectangular(texture).texture;
    this._envMap = envMap;
    this._equirect = texture;
    this._equirectSource = texture;
    this._equirectData = null;
    return { envMap, background: texture };
  }

  disposeResults() {
    if (this._equirectData && this._equirectData !== this._equirectSource) this._equirectData.dispose();
    this._equirectData = null;
    if (this._skyEquirect) { this._skyEquirect.dispose(); this._skyEquirect = null; }
    if (this._envMap) { this._envMap.dispose(); this._envMap = null; }
    if (this._cubeTarget) { this._cubeTarget.dispose(); this._cubeTarget = null; }
    if (this._equirect) { this._equirect.dispose(); this._equirect = null; }
  }

  dispose() {
    this.disposeResults();
    this.pmrem.dispose();
  }
}
