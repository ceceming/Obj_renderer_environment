import * as THREE from 'three';
import { getMaterialPreset } from './presets/materials.js';

/**
 * Material handling.
 *
 * Two jobs:
 *
 *  1. *Upgrade* whatever the file gave us. MTLLoader produces MeshPhongMaterial,
 *     a 1990s lighting model that cannot respond to an IBL correctly. We convert
 *     it to MeshPhysicalMaterial, translating shininess into roughness and
 *     tagging every texture with the right colour space. This single step is
 *     usually the difference between an OBJ that looks flat and dead and one
 *     that looks photographed.
 *
 *  2. *Override* it, when the source materials are missing, broken, or simply
 *     not what you want to present.
 *
 * The originals are always kept so you can return to 'original' at any time.
 */

const ORIGINAL = Symbol('originalMaterial');

/** Colour-space rules. Getting this wrong is the most common cause of washed-out renders. */
const SRGB_SLOTS = new Set(['map', 'emissiveMap', 'specularColorMap', 'sheenColorMap']);
const DATA_SLOTS = new Set([
  'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'displacementMap',
  'alphaMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap',
  'transmissionMap', 'thicknessMap', 'iridescenceMap', 'anisotropyMap', 'specularIntensityMap'
]);

export function fixTextureColorSpaces(material, anisotropy = 16) {
  for (const slot of [...SRGB_SLOTS, ...DATA_SLOTS]) {
    const tex = material[slot];
    if (!tex || !tex.isTexture) continue;
    tex.colorSpace = SRGB_SLOTS.has(slot) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
  }
}

/**
 * Convert a legacy Phong/Lambert/Basic material into MeshPhysicalMaterial,
 * preserving every texture slot that has an equivalent.
 */
export function toPhysical(src) {
  if (src.isMeshPhysicalMaterial) return src;

  const m = new THREE.MeshPhysicalMaterial();
  m.name = src.name || '';
  if (src.color) m.color.copy(src.color);
  m.map = src.map || null;
  m.normalMap = src.normalMap || null;
  if (src.normalScale && m.normalMap) m.normalScale.copy(src.normalScale);
  m.bumpMap = src.bumpMap || null;
  m.bumpScale = src.bumpScale ?? 1;
  m.alphaMap = src.alphaMap || null;
  m.aoMap = src.aoMap || null;
  m.displacementMap = src.displacementMap || null;
  if (src.emissive) m.emissive.copy(src.emissive);
  m.emissiveMap = src.emissiveMap || null;
  m.emissiveIntensity = src.emissiveIntensity ?? 1;
  m.transparent = src.transparent ?? false;
  m.opacity = src.opacity ?? 1;
  m.alphaTest = src.alphaTest ?? 0;
  m.side = src.side ?? THREE.FrontSide;
  m.vertexColors = src.vertexColors ?? false;
  m.flatShading = src.flatShading ?? false;

  if (src.isMeshStandardMaterial) {
    m.roughness = src.roughness;
    m.metalness = src.metalness;
    m.roughnessMap = src.roughnessMap || null;
    m.metalnessMap = src.metalnessMap || null;
    m.envMapIntensity = src.envMapIntensity ?? 1;
  } else if (src.isMeshPhongMaterial) {
    // Phong shininess is an exponent on a specular lobe. The widely used
    // approximation back to a roughness value is r = sqrt(2 / (shininess + 2)).
    const shininess = Math.max(0, src.shininess ?? 30);
    m.roughness = THREE.MathUtils.clamp(Math.sqrt(2 / (shininess + 2)), 0.06, 1.0);

    // Phong's Ks is a specular *highlight* colour, not a metalness signal, and
    // classic MTL has no way to express metal at all. Guessing from a bright Ks
    // is tempting and wrong: `Ks 0.9 0.9 0.9` is what most exporters emit by
    // default, so treating it as metal turns every ordinary OBJ into a mirror
    // and loses its base colour entirely. Dielectric is the only safe default —
    // the Material presets are there for when something really is metal.
    const spec = src.specular ? src.specular.clone() : new THREE.Color(0x111111);
    const specLum = spec.r * 0.2126 + spec.g * 0.7152 + spec.b * 0.0722;
    m.metalness = 0.0;
    m.specularIntensity = THREE.MathUtils.clamp(specLum * 1.6, 0, 1);
    if (specLum > 0.001) m.specularColor.copy(spec).multiplyScalar(1 / specLum);
    m.roughnessMap = src.specularMap || null;
  } else if (src.isMeshLambertMaterial || src.isMeshBasicMaterial) {
    m.roughness = 0.85;
    m.metalness = 0.0;
  } else {
    m.roughness = 0.7;
    m.metalness = 0.0;
  }

  fixTextureColorSpaces(m);
  return m;
}

/** Snapshot the authored materials once, so 'original' is always recoverable. */
export function captureOriginals(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!o[ORIGINAL]) {
      o[ORIGINAL] = Array.isArray(o.material) ? o.material.slice() : o.material;
    }
  });
}

export function getOriginals(mesh) {
  return mesh[ORIGINAL];
}

/**
 * Apply the material configuration to the whole model.
 * Safe to call repeatedly — it always rebuilds from the captured originals.
 */
export function applyMaterials(root, cfg, { envMapIntensity = 1 } = {}) {
  captureOriginals(root);
  const M = cfg.material;
  const preset = getMaterialPreset(M.mode) || {};
  // Preset values are the base; explicit user edits in cfg.material win.
  const p = { ...preset };
  const mode = p.mode || (M.mode === 'original' || M.mode === 'original-pbr-lift' ? 'pbr' : 'pbr');

  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const originals = [].concat(mesh[ORIGINAL] || mesh.material);
    const built = originals.map((orig) => buildMaterial(orig, cfg, p, mode, envMapIntensity));
    mesh.material = Array.isArray(mesh[ORIGINAL]) ? built : built[0];
    mesh.castShadow = mode !== 'matte' ? true : true;
    mesh.receiveShadow = true;
    if (cfg.model.doubleSided) {
      for (const m of built) m.side = THREE.DoubleSide;
    }
  });
}

function buildMaterial(orig, cfg, p, mode, envMapIntensity) {
  const M = cfg.material;

  // ── Non-photoreal modes replace the shader entirely ──────────────────────
  if (mode === 'normal') {
    return new THREE.MeshNormalMaterial({ flatShading: cfg.model.smoothing === 'flat' });
  }
  if (mode === 'matte') {
    const color = new THREE.Color(M.overrideColor || p.overrideColor || '#000000');
    return new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide });
  }
  if (mode === 'matcap') {
    return new THREE.MeshMatcapMaterial({
      color: new THREE.Color(M.overrideColor || '#ffffff'),
      matcap: generateMatcap(),
      map: orig?.map || null
    });
  }
  if (mode === 'toon') {
    const color = new THREE.Color(M.overrideColor || (orig?.color ? orig.color.getHex() : 0xcccccc));
    return new THREE.MeshToonMaterial({ color, map: orig?.map || null, gradientMap: toonGradient() });
  }
  if (mode === 'xray') {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(M.overrideColor || '#6fd3ff'),
      transparent: true, opacity: 0.32, roughness: 0.25, metalness: 0.0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      transmission: 0.0, emissive: new THREE.Color(M.overrideColor || '#6fd3ff'), emissiveIntensity: 0.25
    });
  }

  // ── Physically based path ────────────────────────────────────────────────
  const m = toPhysical(orig || new THREE.MeshStandardMaterial()).clone();
  // clone() drops nothing important, but textures are shared by reference — good.
  fixTextureColorSpaces(m, M.textureAnisotropy ?? 16);

  const num = (presetVal, userMul, userAdd, base) => {
    let v = presetVal !== undefined ? presetVal : base;
    if (userMul !== undefined) v *= userMul;
    if (userAdd) v += userAdd;
    return v;
  };

  // Roughness / metalness: preset sets the target, the sliders scale it.
  m.roughness = THREE.MathUtils.clamp(
    num(p.roughness, M.roughness, M.roughnessOffset, m.roughness), 0, 1
  );
  m.metalness = THREE.MathUtils.clamp(
    p.metalnessOffset !== undefined
      ? THREE.MathUtils.clamp(p.metalness ?? 1, 0, 1) * (M.metalness ?? 1) + (M.metalnessOffset || 0)
      : num(p.metalness, M.metalness, M.metalnessOffset, m.metalness),
    0, 1
  );

  // Colour
  const override = M.overrideColor || p.overrideColor;
  if (override) {
    m.color.set(override);
    if (p.overrideColor && !M.overrideColor) m.map = null;   // preset colours replace textures
  }
  if (M.tint) {
    const tint = new THREE.Color(M.tint);
    m.color.lerp(m.color.clone().multiply(tint), M.tintStrength ?? 1);
  }

  // Extended physical properties
  m.clearcoat = pick(p.clearcoat, M.clearcoat, 0);
  m.clearcoatRoughness = pick(p.clearcoatRoughness, M.clearcoatRoughness, 0.1);
  m.sheen = pick(p.sheen, M.sheen, 0);
  m.sheenRoughness = pick(p.sheenRoughness, M.sheenRoughness, 0.3);
  m.sheenColor.set(p.sheenColor || M.sheenColor || '#ffffff');
  m.transmission = pick(p.transmission, M.transmission, 0);
  m.thickness = pick(p.thickness, M.thickness, 0.5);
  m.ior = pick(p.ior, M.ior, 1.5);
  m.attenuationDistance = pick(p.attenuationDistance, M.attenuationDistance, Infinity) || Infinity;
  m.attenuationColor.set(p.attenuationColor || M.attenuationColor || '#ffffff');
  m.iridescence = pick(p.iridescence, M.iridescence, 0);
  m.iridescenceIOR = pick(p.iridescenceIOR, M.iridescenceIOR, 1.3);
  m.iridescenceThicknessRange = [100, pick(p.iridescenceThickness, M.iridescenceThickness, 400)];
  m.anisotropy = pick(p.anisotropy, M.anisotropy, 0);
  m.anisotropyRotation = (pick(p.anisotropyRotation, M.anisotropyRotation, 0) * Math.PI) / 180;
  m.specularIntensity = pick(p.specularIntensity, M.specularIntensity, 1);
  if (p.specularColor || M.specularColor) m.specularColor.set(p.specularColor || M.specularColor);

  if (m.transmission > 0) {
    m.transparent = true;
    m.depthWrite = m.transmission < 0.95;
  }

  // Texture strengths
  if (m.normalMap) m.normalScale.setScalar(M.normalScale ?? 1);
  if (m.aoMap) m.aoMapIntensity = M.aoIntensity ?? 1;
  m.emissiveIntensity = (m.emissiveIntensity ?? 1) * (M.emissiveIntensity ?? 1);

  // UV tiling
  if ((M.uvScale ?? 1) !== 1) {
    for (const slot of [...SRGB_SLOTS, ...DATA_SLOTS]) {
      const t = m[slot];
      if (t && t.isTexture) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.setScalar(M.uvScale);
        t.needsUpdate = true;
      }
    }
  }

  m.wireframe = Boolean(p.wireframe || M.wireframe);
  if (m.wireframe) m.wireframeLinewidth = M.wireframeThickness ?? 1;
  m.envMapIntensity = envMapIntensity;
  m.side = cfg.model.doubleSided ? THREE.DoubleSide : m.side;
  if (cfg.model.flipNormals) m.side = m.side === THREE.FrontSide ? THREE.BackSide : THREE.FrontSide;
  m.flatShading = cfg.model.smoothing === 'flat';
  m.needsUpdate = true;
  return m;
}

const pick = (presetVal, userVal, fallback) =>
  presetVal !== undefined ? presetVal : userVal !== undefined ? userVal : fallback;

/** Update env map intensity across the model without a full material rebuild. */
export function setEnvMapIntensity(root, value) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material || [])) {
      if (m && 'envMapIntensity' in m) { m.envMapIntensity = value; m.needsUpdate = true; }
    }
  });
}

// ── Generated helper textures ─────────────────────────────────────────────

let _matcap = null;
function generateMatcap() {
  if (_matcap) return _matcap;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S * 0.35, S * 0.3, S * 0.02, S * 0.5, S * 0.5, S * 0.62);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.28, '#d8dade');
  g.addColorStop(0.62, '#8d9199');
  g.addColorStop(0.88, '#4a4d54');
  g.addColorStop(1, '#2a2c31');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _matcap = new THREE.CanvasTexture(c);
  _matcap.colorSpace = THREE.SRGBColorSpace;
  return _matcap;
}

let _toon = null;
function toonGradient(steps = 4) {
  if (_toon) return _toon;
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255);
  _toon = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  _toon.minFilter = _toon.magFilter = THREE.NearestFilter;
  _toon.needsUpdate = true;
  return _toon;
}
