import * as THREE from 'three';

/**
 * Animation.
 *
 * Every animation type is a pure function of normalised time t (0..1) that
 * returns a *config patch*. Nothing is stateful, so frame 300 can be rendered
 * without rendering frames 0-299 — which is what makes deterministic offline
 * frame-by-frame output, and resuming an interrupted render, possible.
 */

export const EASINGS = {
  linear: (t) => t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => t * (2 - t),
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  'ease-in-cubic': (t) => t * t * t,
  'ease-out-cubic': (t) => --t * t * t + 1,
  'ease-in-out-cubic': (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  'ease-in-out-quint': (t) => (t < 0.5 ? 16 * t ** 5 : 1 - ((-2 * t + 2) ** 5) / 2),
  smoothstep: (t) => t * t * (3 - 2 * t),
  bounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

export const ANIMATION_PRESETS = {
  turntable: {
    label: 'Turntable', group: 'Product',
    note: 'The object rotates a full turn while the camera and lights hold still. The classic product loop — seamless if you keep the duration exact.'
  },
  'camera-orbit': {
    label: 'Camera Orbit', group: 'Product',
    note: 'The camera travels around a stationary object. Reflections shift naturally because the lighting stays fixed in the world.'
  },
  'orbit-arc': {
    label: 'Orbit Arc', group: 'Cinematic',
    note: 'A partial sweep between two angles with easing at both ends. Reads as a deliberate camera move rather than a loop.'
  },
  'dolly-in': {
    label: 'Dolly In', group: 'Cinematic',
    note: 'The camera pushes towards the subject. Add depth of field for a genuine rack-focus feel.'
  },
  'dolly-out': {
    label: 'Dolly Out (reveal)', group: 'Cinematic',
    note: 'Starts tight and pulls back to reveal the whole object.'
  },
  'crane-up': {
    label: 'Crane Up', group: 'Cinematic',
    note: 'Rises from a low hero angle to a high three-quarter. Feels expensive.'
  },
  'light-sweep': {
    label: 'Light Sweep', group: 'Lighting',
    note: 'The lighting rig rotates around a static object and camera. Specular highlights travel across the surface — the best way to show off a finish.'
  },
  'exposure-ramp': {
    label: 'Exposure Ramp', group: 'Lighting',
    note: 'Fades up from black through a full exposure range. A clean, simple opener.'
  },
  'focus-pull': {
    label: 'Focus Pull', group: 'Cinematic',
    note: 'Racks focus from front to back. Requires depth of field; strongest in the path tracer.'
  },
  'rotate-reveal': {
    label: 'Rotate & Reveal', group: 'Product',
    note: 'A three-quarter turn combined with a gentle dolly in. More interesting than a plain turntable for a short clip.'
  },
  'pendulum': {
    label: 'Pendulum', group: 'Product',
    note: 'Rocks back and forth across the front of the object. Loops perfectly and shows both sides.'
  },
  'material-morph': {
    label: 'Roughness Sweep', group: 'Material',
    note: 'Animates the surface from matte to mirror. A material study rather than a beauty shot.'
  }
};

export function animationPresetList() {
  return Object.entries(ANIMATION_PRESETS).map(([key, p]) => ({ key, label: p.label, group: p.group, note: p.note }));
}

export function frameCount(cfg) {
  return Math.max(1, Math.round(cfg.animation.duration * cfg.animation.fps));
}

/** Normalised time for a frame index, honouring ping-pong. */
export function normalizedTime(frame, cfg) {
  const total = frameCount(cfg);
  let t = total <= 1 ? 0 : frame / total;    // exclusive end, so a loop does not repeat frame 0
  if (cfg.animation.pingPong) {
    t = t * 2;
    if (t > 1) t = 2 - t;
  }
  return Math.min(1, Math.max(0, t));
}

/**
 * The config patch for a given frame.
 * @returns {{ patch: object, objectRotation: number|null }}
 */
export function evaluateFrame(cfg, frame) {
  const A = cfg.animation;
  const tRaw = normalizedTime(frame, cfg);
  const ease = EASINGS[A.easing] || EASINGS.linear;
  const t = ease(tRaw);

  const patch = {};
  let objectRotation = null;

  switch (A.type) {
    case 'turntable': {
      const revs = A.turntable?.revolutions ?? 1;
      const dir = A.turntable?.direction ?? 1;
      const angle = t * 360 * revs * dir;
      if (A.turntable?.spinObject !== false) {
        // Spinning the object keeps the lighting fixed in the world, so
        // highlights sweep across the surface exactly as on a real turntable.
        objectRotation = angle;
      } else {
        patch.camera = { azimuth: cfg.camera.azimuth + angle };
      }
      break;
    }
    case 'camera-orbit': {
      const revs = A.turntable?.revolutions ?? 1;
      const dir = A.turntable?.direction ?? 1;
      patch.camera = { azimuth: cfg.camera.azimuth + t * 360 * revs * dir };
      break;
    }
    case 'orbit-arc': {
      const o = A.orbit || {};
      patch.camera = {
        azimuth: lerp(o.startAzimuth ?? -30, o.endAzimuth ?? 30, t),
        elevation: lerp(o.startElevation ?? 5, o.endElevation ?? 30, t)
      };
      break;
    }
    case 'dolly-in':
    case 'dolly-out': {
      const zoom = A.dolly?.zoomFactor ?? 0.6;
      const from = A.type === 'dolly-in' ? 1 : zoom;
      const to = A.type === 'dolly-in' ? zoom : 1;
      // Framing is the resolution-independent way to dolly: it changes how much
      // of the frame the subject fills, and the fit solver does the rest.
      patch.camera = { framing: cfg.camera.framing / lerp(from, to, t) };
      break;
    }
    case 'crane-up': {
      const o = A.orbit || {};
      patch.camera = {
        elevation: lerp(o.startElevation ?? -12, o.endElevation ?? 45, t),
        azimuth: lerp(o.startAzimuth ?? cfg.camera.azimuth - 10, o.endAzimuth ?? cfg.camera.azimuth + 15, t)
      };
      break;
    }
    case 'light-sweep': {
      const s = A.lightSweep || {};
      patch.lighting = { envRotation: lerp(s.startRotation ?? 0, s.endRotation ?? 360, t) };
      break;
    }
    case 'exposure-ramp': {
      patch.look = { exposure: cfg.look.exposure * lerp(0.02, 1, t) };
      break;
    }
    case 'focus-pull': {
      const d = cfg.camera.dof.focusDistance || 2;
      patch.camera = { dof: { enabled: true, focusMode: 'manual', focusDistance: lerp(d * 0.55, d * 1.6, t) } };
      break;
    }
    case 'rotate-reveal': {
      objectRotation = t * 270;
      patch.camera = { framing: cfg.camera.framing / lerp(0.78, 1, t) };
      break;
    }
    case 'pendulum': {
      const swing = Math.sin(tRaw * Math.PI * 2) * 35;
      patch.camera = { azimuth: cfg.camera.azimuth + swing };
      break;
    }
    case 'material-morph': {
      patch.material = { roughness: lerp(1.0, 0.04, t) };
      break;
    }
    default:
      break;
  }

  // Custom keyframes win over the preset, and are interpolated pairwise.
  if (A.keyframes?.length >= 2) {
    Object.assign(patch, interpolateKeyframes(A.keyframes, tRaw, ease));
  }

  return { patch, objectRotation, t, tRaw };
}

function interpolateKeyframes(keys, t, ease) {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  let a = sorted[0], b = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].t && t <= sorted[i + 1].t) { a = sorted[i]; b = sorted[i + 1]; break; }
  }
  const span = b.t - a.t;
  const local = span <= 0 ? 0 : ease((t - a.t) / span);
  return deepLerp(a, b, local);
}

function deepLerp(a, b, t) {
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 't') continue;
    const av = a[key], bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') out[key] = lerp(av, bv, t);
    else if (av && bv && typeof av === 'object' && typeof bv === 'object') out[key] = deepLerp(av, bv, t);
    else out[key] = t < 0.5 ? (av ?? bv) : (bv ?? av);
  }
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Drives an engine through an animation.
 * Used identically by the interactive preview and the offline frame renderer.
 */
export class AnimationDriver {
  constructor(engine) {
    this.engine = engine;
    this.baseConfig = null;
    this.currentFrame = 0;
  }

  begin() {
    this.baseConfig = JSON.parse(JSON.stringify(this.engine.config));
    return this;
  }

  /** Apply frame N. Returns the resolved config used for that frame. */
  async applyFrame(frame) {
    const base = this.baseConfig || this.engine.config;
    const { patch, objectRotation } = evaluateFrame(base, frame);

    // Restore the base each time so patches never compound.
    this.engine.config = JSON.parse(JSON.stringify(base));
    if (Object.keys(patch).length) this.engine.patch(patch);

    if (objectRotation !== null && this.engine.model) {
      const axis = base.animation.turntable?.axis || 'y';
      const rad = (objectRotation * Math.PI) / 180;
      this.engine.modelRoot.rotation.set(0, 0, 0);
      if (axis === 'y') this.engine.modelRoot.rotation.y = rad;
      else if (axis === 'x') this.engine.modelRoot.rotation.x = rad;
      else this.engine.modelRoot.rotation.z = rad;
      this.engine.modelRoot.updateMatrixWorld(true);
    } else if (this.engine.modelRoot.rotation.lengthSq?.() !== 0) {
      this.engine.modelRoot.rotation.set(0, 0, 0);
    }

    this.currentFrame = frame;
    await this.engine.prepare();
    return this.engine.config;
  }

  end() {
    if (this.baseConfig) this.engine.setConfig(this.baseConfig);
    this.engine.modelRoot.rotation.set(0, 0, 0);
    this.baseConfig = null;
  }
}
