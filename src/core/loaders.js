import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';

export const SUPPORTED_EXTENSIONS = ['obj', 'mtl', 'gltf', 'glb', 'fbx', 'stl', 'ply', 'dae', '3mf'];
export const TEXTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga', 'tif', 'tiff', 'gif', 'ktx2', 'hdr', 'exr'];

const ext = (name) => String(name).split('.').pop().toLowerCase();
const stem = (name) => String(name).split('/').pop().replace(/\.[^.]+$/, '');

/**
 * A LoadingManager that resolves texture paths against a bag of blob URLs.
 *
 * This is the part that makes drag-and-drop of a whole model folder work.
 * An MTL says `map_Kd textures/diffuse.jpg`, but in the browser we only have
 * a set of File objects with no directory structure. We therefore match on the
 * *basename*, case-insensitively, and fall back to a fuzzy match — which is
 * what recovers the very common case of an MTL written on Windows with
 * backslashes and absolute paths like `C:\Users\...\wood.jpg`.
 */
export function createAssetManager(fileMap = {}) {
  const manager = new THREE.LoadingManager();
  const byFullPath = new Map();
  const byBasename = new Map();

  for (const [path, url] of Object.entries(fileMap)) {
    const clean = path.replace(/\\/g, '/').toLowerCase();
    const base = clean.split('/').pop();
    byFullPath.set(clean, url);
    if (!byBasename.has(base)) byBasename.set(base, url);
  }

  manager.setURLModifier((url) => {
    if (!url) return url;
    // Already-resolvable URLs are left alone. Rewriting them is how a request
    // for the model itself can get hijacked by a same-stem sibling.
    if (/^(blob:|data:|https?:)/.test(url)) return url;

    const clean = decodeURIComponent(url).replace(/\\/g, '/');
    const lower = clean.toLowerCase();
    const base = lower.split('/').pop();

    // 1. Exact path, then exact filename. This resolves almost everything.
    const exact = byFullPath.get(lower) ?? byFullPath.get(lower.replace(/^\.?\//, '')) ?? byBasename.get(base);
    if (exact) return exact;

    // A server-absolute path that we have no entry for is already correct.
    if (clean.startsWith('/')) return url;

    // 2. Fall back to a fuzzy match, but only among files of the *same
    //    extension*. MTL files written on Windows routinely carry absolute
    //    paths like `C:\Users\me\wood.jpg`, so matching on the stem is
    //    necessary — while matching across extensions would let a .mtl answer
    //    a request for a .png, which silently produces a broken scene.
    const ext = base.includes('.') ? base.split('.').pop() : '';
    const stemOf = (n) => n.replace(/\.[^.]+$/, '');
    const wanted = stemOf(base);
    let fallback = null;
    for (const [candidate, candidateUrl] of byBasename) {
      const candidateExt = candidate.includes('.') ? candidate.split('.').pop() : '';
      if (candidateExt !== ext) continue;
      if (stemOf(candidate) === wanted) return candidateUrl;
      if (!fallback && (candidate.includes(wanted) || wanted.includes(stemOf(candidate)))) {
        fallback = candidateUrl;
      }
    }
    if (fallback) return fallback;

    // 3. Same stem, any texture extension — covers an MTL that names a .tga
    //    when the folder actually ships a converted .png.
    if (TEXTURE_EXTENSIONS.includes(ext)) {
      for (const [candidate, candidateUrl] of byBasename) {
        const candidateExt = candidate.split('.').pop();
        if (TEXTURE_EXTENSIONS.includes(candidateExt) && stemOf(candidate) === wanted) return candidateUrl;
      }
    }
    return url;
  });

  manager.__lookup = byBasename;
  return manager;
}

/**
 * Load a model. `files` maps relative path -> URL (blob: or http:).
 * Returns { object, format, stats, warnings }.
 */
export async function loadModel({ url, name, files = {}, onProgress } = {}) {
  const format = ext(name || url);
  const manager = createAssetManager(files);
  const warnings = [];
  let object = null;

  const progress = (e) => {
    if (onProgress && e && e.lengthComputable) onProgress(e.loaded / e.total);
  };

  switch (format) {
    case 'obj': {
      // Find a sibling MTL. Prefer one with the same stem, else the only one present.
      const mtlEntries = Object.entries(files).filter(([p]) => ext(p) === 'mtl');
      let materials = null;
      if (mtlEntries.length) {
        const same = mtlEntries.find(([p]) => stem(p) === stem(name || url));
        const [mtlPath, mtlUrl] = same || mtlEntries[0];
        try {
          const mtlLoader = new MTLLoader(manager);
          mtlLoader.setMaterialOptions({ side: THREE.FrontSide, invertTrProperty: false });
          const mtl = await mtlLoader.loadAsync(mtlUrl, progress);
          mtl.preload();
          materials = mtl;
        } catch (err) {
          warnings.push(`Could not parse ${mtlPath.split('/').pop()}: ${err.message}. Loading geometry without materials.`);
        }
      } else {
        warnings.push('No .mtl file found — the model will load with a default grey material. Drop the .mtl and its textures in alongside the .obj to get the authored look.');
      }
      const objLoader = new OBJLoader(manager);
      if (materials) objLoader.setMaterials(materials);
      object = await objLoader.loadAsync(url, progress);
      break;
    }
    case 'gltf':
    case 'glb': {
      const loader = new GLTFLoader(manager);
      const gltf = await loader.loadAsync(url, progress);
      object = gltf.scene || gltf.scenes[0];
      object.animations = gltf.animations || [];
      break;
    }
    case 'fbx': {
      object = await new FBXLoader(manager).loadAsync(url, progress);
      break;
    }
    case 'dae': {
      const dae = await new ColladaLoader(manager).loadAsync(url, progress);
      object = dae.scene;
      break;
    }
    case '3mf': {
      object = await new ThreeMFLoader(manager).loadAsync(url, progress);
      break;
    }
    case 'stl': {
      const geom = await new STLLoader(manager).loadAsync(url, progress);
      geom.computeVertexNormals();
      object = new THREE.Group();
      object.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 0.0 })));
      warnings.push('STL carries no materials or UVs. Use a Material preset to give it a finish.');
      break;
    }
    case 'ply': {
      const geom = await new PLYLoader(manager).loadAsync(url, progress);
      if (!geom.attributes.normal) geom.computeVertexNormals();
      const hasColor = Boolean(geom.attributes.color);
      object = new THREE.Group();
      object.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        color: 0xcccccc, roughness: 0.6, metalness: 0.0, vertexColors: hasColor
      })));
      break;
    }
    default:
      throw new Error(`Unsupported format ".${format}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }

  if (!object) throw new Error('The file loaded but produced no geometry.');

  // Each loader reports clips differently — GLTF hands them back beside the
  // scene, FBX and Collada attach them to the root. Normalise so the rest of
  // the engine has one place to look.
  const clips = object.animations || [];
  object.userData.animations = clips;
  object.name = object.name || stem(name || url);
  const stats = analyse(object);
  stats.clips = clips.map((c) => ({ name: c.name || 'clip', duration: +c.duration.toFixed(3) }));
  if (stats.triangles === 0) warnings.push('The file contains no triangles — it may be a point cloud or an empty scene.');
  if (!stats.hasUVs && stats.hasTextures) warnings.push('Textures were found but the mesh has no UV coordinates, so they cannot be applied.');
  if (clips.length) {
    warnings.push(`This file carries ${clips.length} animation clip${clips.length === 1 ? '' : 's'} ` +
      `(${clips.map((c) => `${c.name || 'clip'} ${c.duration.toFixed(1)}s`).join(', ')}). ` +
      'Choose "Embedded clip" in the Animation section to render it, otherwise it renders in its rest pose.');
  }
  if (stats.reversedWinding) warnings.push('This model\'s faces appear to be wound inside-out. It will still look right in the real-time preview, but turn on "Double-sided" before path tracing, or the object may render as a black silhouette.');
  if (stats.triangles > 3_000_000) warnings.push(`${stats.triangles.toLocaleString()} triangles is heavy. Real-time preview may be slow; the path tracer will still work but expect longer builds.`);

  return { object, format, stats, warnings };
}

/** Walk the object and collect useful facts about it. */
export function analyse(object) {
  let triangles = 0, vertices = 0, meshes = 0;
  const materials = new Set();
  const textures = new Set();
  let hasUVs = false, hasNormals = false, hasVertexColors = false;

  object.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    meshes++;
    const g = o.geometry;
    const pos = g.attributes.position;
    if (pos) {
      vertices += pos.count;
      triangles += g.index ? g.index.count / 3 : pos.count / 3;
    }
    if (g.attributes.uv) hasUVs = true;
    if (g.attributes.normal) hasNormals = true;
    if (g.attributes.color) hasVertexColors = true;
    for (const m of [].concat(o.material || [])) {
      if (!m) continue;
      materials.add(m.uuid);
      for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
        'bumpMap', 'displacementMap', 'alphaMap', 'specularMap', 'clearcoatMap']) {
        if (m[slot]) textures.add(m[slot].uuid);
      }
    }
  });

  // Compare each sampled triangle's winding-derived normal against the normal
  // the file supplied. Disagreement means the faces are wound inside-out, which
  // raster shading hides but ray tracing renders as a black silhouette.
  let sampled = 0, reversed = 0;
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry || sampled >= 300) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    if (!pos || !nrm) return;
    const triCount = g.index ? g.index.count / 3 : pos.count / 3;
    const step = Math.max(1, Math.floor(triCount / 100));
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), geoN = new THREE.Vector3(), vN = new THREE.Vector3();
    for (let t = 0; t < triCount && sampled < 300; t += step) {
      const i0 = g.index ? g.index.getX(t * 3) : t * 3;
      const i1 = g.index ? g.index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = g.index ? g.index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      ab.subVectors(b, a); ac.subVectors(c, a);
      geoN.crossVectors(ab, ac);
      if (geoN.lengthSq() < 1e-16) continue;
      geoN.normalize();
      vN.fromBufferAttribute(nrm, i0);
      if (vN.lengthSq() < 1e-12) continue;
      sampled++;
      if (geoN.dot(vN.normalize()) < -0.25) reversed++;
    }
  });
  const reversedWinding = sampled > 20 && reversed / sampled > 0.6;

  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  if (!box.isEmpty()) { box.getSize(size); box.getCenter(center); }

  return {
    triangles: Math.round(triangles), vertices, meshes,
    materialCount: materials.size, textureCount: textures.size,
    hasUVs, hasNormals, hasVertexColors, hasTextures: textures.size > 0,
    reversedWinding, windingSampled: sampled, windingReversed: reversed,
    boundingBox: { min: box.min.toArray(), max: box.max.toArray() },
    size: size.toArray(), center: center.toArray(),
    maxDimension: Math.max(size.x, size.y, size.z) || 1
  };
}

/**
 * Apply the model transform settings: axis fix, centring, grounding, scaling.
 * Returns the fitted bounding box so the camera can frame against it.
 */
export function normalizeModel(object, cfg) {
  const m = cfg.model;

  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);

  // 1. Up-axis correction. CAD and 3ds Max exports are very often Z-up.
  if (m.upAxis === 'z-up') object.rotation.x = -Math.PI / 2;
  else if (m.upAxis === 'x-up') object.rotation.z = Math.PI / 2;

  // 2. User rotation, in degrees.
  const d2r = Math.PI / 180;
  object.rotation.x += (m.rotation?.x || 0) * d2r;
  object.rotation.y += (m.rotation?.y || 0) * d2r;
  object.rotation.z += (m.rotation?.z || 0) * d2r;
  object.updateMatrixWorld(true);

  // 3. Uniform scale — normalise so every model arrives at a predictable size,
  //    which is what lets one lighting rig work for a ring and for a building.
  let box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const autoScale = m.autoScale ? (m.targetSize || 1) / maxDim : 1;
  const s = autoScale * (m.scale ?? 1);
  object.scale.multiplyScalar(s);
  object.updateMatrixWorld(true);

  // 4. Centre / ground.
  box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  if (m.autoCenter) {
    object.position.x -= center.x;
    object.position.z -= center.z;
    if (m.autoGround) object.position.y -= box.min.y;
    else object.position.y -= center.y;
  }
  object.position.x += m.position?.x || 0;
  object.position.y += m.position?.y || 0;
  object.position.z += m.position?.z || 0;
  object.updateMatrixWorld(true);

  return new THREE.Box3().setFromObject(object);
}

/** Recompute normals according to the smoothing setting. */
export function applySmoothing(object, cfg) {
  const mode = cfg.model.smoothing;
  if (mode === 'auto') return;
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    if (mode === 'flat') {
      const nonIndexed = g.index ? g.toNonIndexed() : g;
      nonIndexed.computeVertexNormals();
      if (g !== nonIndexed) { o.geometry = nonIndexed; g.dispose(); }
      o.geometry.attributes.normal.needsUpdate = true;
    } else if (mode === 'smooth') {
      g.computeVertexNormals();
      g.attributes.normal.needsUpdate = true;
    }
  });
}

/** Release GPU memory for an entire subtree. */
export function disposeObject(object) {
  if (!object) return;
  object.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) {
      if (!m) continue;
      for (const key of Object.keys(m)) {
        const v = m[key];
        if (v && v.isTexture) v.dispose();
      }
      m.dispose();
    }
  });
}
