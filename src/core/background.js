import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

/**
 * Backdrops and set pieces.
 *
 * The background is not just a colour behind the object — it is part of the
 * lighting. A white sweep bounces light back into the shadow side; a glossy
 * plinth doubles the subject and grounds it. These pieces are real geometry in
 * the scene so they shadow, reflect and bounce like the real thing.
 *
 * 'transparent' is the exception: nothing is drawn, the renderer clears to
 * alpha 0, and only the shadow catchers write into the alpha channel.
 */

export class Backdrop {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Backdrop';
    // Set pieces are scenery, not subject: they must not cast contact shadows.
    this.group.userData.excludeFromContactShadow = true;
    this._disposables = [];
    this.reflector = null;
  }

  /**
   * @param {object} cfg    full RenderConfig
   * @param {number} subjectSize
   * @param {THREE.Texture|null} envTexture  the built environment, for 'environment' mode
   * @param {number} aspect output aspect ratio, so gradients are drawn undistorted
   */
  build(scene, cfg, subjectSize = 1, envTexture = null, aspect = 1) {
    this.clear(scene);
    const bg = cfg.background;
    const mode = resolveBackgroundMode(cfg);

    scene.background = null;
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = 1;

    switch (mode) {
      case 'transparent':
        scene.background = null;
        break;

      case 'solid':
        scene.background = new THREE.Color(bg.color || '#ffffff');
        break;

      case 'gradient': {
        const tex = makeGradientTexture(bg.gradient, aspect);
        this._disposables.push(tex);
        scene.background = tex;
        break;
      }

      case 'environment':
        if (envTexture) {
          scene.background = envTexture;
          scene.backgroundBlurriness = bg.envBlur ?? 0;
          scene.backgroundIntensity = bg.envIntensity ?? 1;
        } else {
          scene.background = new THREE.Color(bg.color || '#808080');
        }
        break;

      case 'image':
        // The caller preloads and hands us the texture through cfg cache.
        if (cfg.__imageTexture) scene.background = cfg.__imageTexture;
        else scene.background = new THREE.Color(bg.color || '#ffffff');
        break;

      case 'studio-cyc':
        this._buildCyc(bg.cyc, subjectSize);
        scene.background = new THREE.Color(bg.cyc?.color || '#ededf0');
        break;
    }

    if (bg.floor?.enabled) this._buildFloor(bg.floor, subjectSize);

    scene.add(this.group);
    return this.group;
  }

  /**
   * Infinite cyclorama: a floor that curves seamlessly into a back wall.
   * The absence of a corner line is what makes a product look like it is
   * floating in a void rather than sitting in a room.
   */
  _buildCyc(cycCfg = {}, subjectSize = 1) {
    const S = (cycCfg.size ?? 20) * subjectSize;
    const r = (cycCfg.curveRadius ?? 1.6) * subjectSize;
    const wallHeight = S * 0.6;
    const segments = 24;

    // Profile in the (z, y) plane, swept along x.
    const profile = [];
    profile.push(new THREE.Vector2(S * 0.5, 0));           // front of floor
    profile.push(new THREE.Vector2(0, 0));                  // start of the curve
    for (let i = 1; i <= segments; i++) {
      const t = (i / segments) * (Math.PI / 2);
      profile.push(new THREE.Vector2(-r * Math.sin(t), r - r * Math.cos(t)));
    }
    profile.push(new THREE.Vector2(-r, wallHeight));        // top of the wall

    const halfWidth = S * 0.75;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i < profile.length; i++) {
      const p = profile[i];
      // Normal from the profile tangent, rotated 90°.
      const prev = profile[Math.max(0, i - 1)];
      const next = profile[Math.min(profile.length - 1, i + 1)];
      const tz = next.x - prev.x, ty = next.y - prev.y;
      const len = Math.hypot(tz, ty) || 1;
      const nz = -ty / len, ny = tz / len;
      for (let s = 0; s < 2; s++) {
        positions.push(s === 0 ? -halfWidth : halfWidth, p.y, p.x);
        normals.push(0, ny, nz);
        uvs.push(s, i / (profile.length - 1));
      }
    }
    for (let i = 0; i < profile.length - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);

    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(cycCfg.color || '#ededf0'),
      roughness: cycCfg.roughness ?? 0.85,
      metalness: 0,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = cycCfg.receiveShadow !== false;
    mesh.name = 'Cyclorama';
    this.group.add(mesh);
    this._disposables.push(geo, mat);
  }

  _buildFloor(floorCfg, subjectSize) {
    const size = (floorCfg.fadeDistance ?? 6) * subjectSize * 4;

    if (floorCfg.type === 'mirror' || floorCfg.type === 'glossy') {
      // A real planar reflection: the object appears upside down beneath itself.
      const geo = new THREE.PlaneGeometry(size, size);
      geo.rotateX(-Math.PI / 2);
      const reflector = new Reflector(geo, {
        textureWidth: 1024,
        textureHeight: 1024,
        color: new THREE.Color(floorCfg.color || '#0e0e10')
      });
      reflector.position.y = -0.0008;
      reflector.name = 'ReflectiveFloor';

      // Fade the reflection with distance and dim it by `reflectivity`, so it
      // reads as a polished surface rather than a mirror-perfect duplicate.
      const strength = floorCfg.reflectivity ?? 0.6;
      const fade = (floorCfg.fadeDistance ?? 6) * subjectSize;
      reflector.material.transparent = true;
      reflector.material.onBeforeCompile = (shader) => {
        shader.uniforms.uStrength = { value: strength };
        shader.uniforms.uFade = { value: fade };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nuniform float uStrength;\nuniform float uFade;')
          .replace(
            'gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );',
            `float d = length(vWorldPos.xz);
             float fade = 1.0 - smoothstep(0.0, uFade, d);
             gl_FragColor = vec4( blendOverlay( base.rgb, color ), uStrength * fade );`
          );
      };
      this.group.add(reflector);
      this.reflector = reflector;
      this._disposables.push(geo);
      return;
    }

    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(floorCfg.color || '#202024'),
      roughness: floorCfg.roughness ?? 0.4,
      metalness: floorCfg.metalness ?? 0,
      side: THREE.FrontSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.y = -0.0008;
    mesh.name = 'Floor';
    this.group.add(mesh);
    this._disposables.push(geo, mat);
  }

  clear(scene) {
    if (scene) scene.remove(this.group);
    this.group.clear();
    if (this.reflector) { this.reflector.dispose?.(); this.reflector = null; }
    this._disposables.forEach((d) => d.dispose && d.dispose());
    this._disposables = [];
  }

  dispose(scene) { this.clear(scene); }
}

/**
 * The output settings can override the configured background — that is how you
 * render the same look as both a transparent cut-out and a white packshot
 * without touching the art direction.
 */
export function resolveBackgroundMode(cfg) {
  switch (cfg.output.backgroundMode) {
    case 'transparent': return 'transparent';
    case 'white': return 'solid-white';
    case 'black': return 'solid-black';
    case 'custom': return 'solid-custom';
    default: return cfg.background.type;
  }
}

/** The clear colour + alpha the renderer should use. */
export function resolveClearColor(cfg) {
  const mode = cfg.output.backgroundMode;
  if (mode === 'transparent' || (mode === 'as-configured' && cfg.background.type === 'transparent')) {
    return { color: new THREE.Color(0x000000), alpha: 0 };
  }
  if (mode === 'white') return { color: new THREE.Color(0xffffff), alpha: 1 };
  if (mode === 'black') return { color: new THREE.Color(0x000000), alpha: 1 };
  if (mode === 'custom') return { color: new THREE.Color(cfg.output.customBackground || '#ffffff'), alpha: 1 };
  return { color: new THREE.Color(cfg.background.color || '#ffffff'), alpha: 1 };
}

/** True when the render must preserve an alpha channel. */
export function isTransparentOutput(cfg) {
  return resolveClearColor(cfg).alpha === 0;
}

export function makeGradientTexture(g = {}, aspect = 1) {
  const H = 1024;
  const W = Math.max(8, Math.round(H * aspect));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  let grad;
  if (g.style === 'radial') {
    grad = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.72);
  } else {
    const a = ((g.angle ?? 180) - 90) * (Math.PI / 180);
    const cx = W / 2, cy = H / 2;
    const r = Math.max(W, H) / 2;
    grad = ctx.createLinearGradient(
      cx - Math.cos(a) * r, cy - Math.sin(a) * r,
      cx + Math.cos(a) * r, cy + Math.sin(a) * r
    );
  }
  grad.addColorStop(0, g.top || '#ffffff');
  grad.addColorStop(1, g.bottom || '#cccccc');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
