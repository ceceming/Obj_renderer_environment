/**
 * RenderConfig — the single source of truth for a render.
 *
 * Every consumer of this project speaks this one object:
 *   - the interactive Studio UI edits it,
 *   - the headless CLI renders from it,
 *   - the exported three.js embed replays it,
 *   - `.render.json` on disk *is* it.
 *
 * That is what makes the viewport WYSIWYG: there is no second code path
 * that could drift from what you saw on screen.
 */

export const SCHEMA_VERSION = 3;

/** Physical camera sensor sizes (mm). Focal length is interpreted against these. */
export const SENSORS = {
  'full-frame': { w: 36, h: 24, label: '35mm Full Frame' },
  'aps-c': { w: 23.6, h: 15.7, label: 'APS-C' },
  'micro-43': { w: 17.3, h: 13, label: 'Micro 4/3' },
  'medium-format': { w: 53.7, h: 40.2, label: 'Medium Format' },
  'super-35': { w: 24.89, h: 18.66, label: 'Super 35 (cine)' },
  'imax': { w: 70.4, h: 52.6, label: 'IMAX 70mm' }
};

/** Output aspect / resolution presets aimed at design + motion deliverables. */
export const RESOLUTION_PRESETS = {
  'square-1080': { w: 1080, h: 1080, label: 'Square 1080 (social)' },
  'square-2048': { w: 2048, h: 2048, label: 'Square 2048' },
  'square-4096': { w: 4096, h: 4096, label: 'Square 4K' },
  'portrait-1080x1350': { w: 1080, h: 1350, label: 'Portrait 4:5' },
  'story-1080x1920': { w: 1080, h: 1920, label: 'Story 9:16' },
  'hd-1920x1080': { w: 1920, h: 1080, label: 'HD 1080p' },
  'uhd-3840x2160': { w: 3840, h: 2160, label: 'UHD 4K' },
  'dci-4096x2160': { w: 4096, h: 2160, label: 'DCI 4K' },
  'print-a4-300': { w: 2480, h: 3508, label: 'A4 @ 300dpi' },
  'print-a3-300': { w: 3508, h: 4961, label: 'A3 @ 300dpi' },
  'poster-5000': { w: 5000, h: 7000, label: 'Poster 5000x7000' },
  'cinemascope': { w: 3840, h: 1608, label: 'Cinemascope 2.39:1' },
  custom: { w: 2048, h: 2048, label: 'Custom' }
};

/** Tone mapping operators. AgX and Neutral are the modern, highlight-safe choices. */
export const TONEMAPS = {
  agx: { label: 'AgX (filmic, best highlights)', hint: 'Desaturates bright areas like film. Best default for product work.' },
  neutral: { label: 'Khronos Neutral (PBR accurate)', hint: 'Preserves material hue. Best when colour accuracy matters.' },
  aces: { label: 'ACES Filmic (cinematic)', hint: 'Punchy, contrasty, slightly warm. Classic VFX look.' },
  reinhard: { label: 'Reinhard (soft)', hint: 'Gentle rolloff, flat. Good for clay/greyscale studies.' },
  cineon: { label: 'Cineon (log-ish)', hint: 'Low contrast, lots of grading headroom.' },
  linear: { label: 'Linear (none)', hint: 'No curve. Clips hard. Use only for technical output.' }
};

export const UP_AXES = ['y-up', 'z-up', 'x-up'];

/** Deep-clone helper used everywhere instead of structuredClone for older runtimes. */
export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function defaultConfig() {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'untitled-render',

    // ── MODEL ───────────────────────────────────────────────────────────────
    model: {
      source: null,          // {kind:'file'|'url', name, url}
      upAxis: 'y-up',        // OBJ from CAD is frequently Z-up
      autoCenter: true,      // centre on origin
      autoGround: true,      // sit the object on Y=0 so it can cast a real shadow
      autoScale: true,       // normalise longest side to `targetSize`
      targetSize: 1.0,
      rotation: { x: 0, y: 0, z: 0 },   // degrees, applied after up-axis fix
      position: { x: 0, y: 0, z: 0 },
      scale: 1.0,
      // Geometry treatment
      smoothing: 'auto',     // 'auto' | 'flat' | 'smooth' — recompute normals
      smoothAngle: 45,       // degrees, for 'auto'
      doubleSided: false,
      flipNormals: false,
      weldVertices: false
    },

    // ── CAMERA ──────────────────────────────────────────────────────────────
    camera: {
      preset: 'three-quarter',
      projection: 'perspective',   // 'perspective' | 'orthographic'
      sensor: 'full-frame',
      focalLength: 85,             // mm — 85 is the flattering product default
      orthoZoom: 1.0,
      // Spherical framing around the subject: this is what "camera positioning"
      // means in practice, and it is resolution-independent.
      azimuth: 35,                 // degrees around Y, 0 = front
      elevation: 12,               // degrees above horizon
      distance: 'auto',            // 'auto' = fit to frame, or a number in scene units
      framing: 0.85,               // 0..1 how much of the frame the subject fills
      target: { x: 0, y: 0.5, z: 0 },   // 0.5 = normalised object height fraction
      targetMode: 'auto',          // 'auto' (centre of bounds) | 'manual'
      roll: 0,                     // dutch angle, degrees
      shift: { x: 0, y: 0 },       // lens shift (tilt-shift / architectural correction)
      near: 0.01,
      far: 1000,
      dof: {
        enabled: false,
        focusMode: 'subject',      // 'subject' | 'manual' | 'nearest'
        focusDistance: 2.0,
        fStop: 2.8,
        maxBlur: 0.012,
        bokehBlades: 6,
        bokehRotation: 0
      }
    },

    // ── LIGHTING ────────────────────────────────────────────────────────────
    lighting: {
      preset: 'studio-softbox',
      intensity: 1.0,              // global multiplier over the whole rig
      envRotation: 0,              // degrees — spins the environment reflections
      envIntensity: 1.0,
      temperature: 6500,           // Kelvin — global white balance of the rig
      // Procedural environment: we synthesise the IBL instead of shipping HDRIs,
      // so every light is a real, movable, resizable area source.
      environment: {
        type: 'procedural',        // 'procedural' | 'hdri' | 'gradient' | 'solid'
        hdriUrl: null,
        hdriExposure: 1.0,
        // procedural sky / room description
        sky: {
          mode: 'studio',          // 'studio' | 'daylight' | 'overcast' | 'sunset' | 'night' | 'gradient'
          intensity: null,         // null = use the per-mode default (see environment.js)
          zenith: '#dfe7f2',
          horizon: '#ffffff',
          ground: '#8a8a8a',
          sunEnabled: true,
          sunAzimuth: 130,
          sunElevation: 35,
          sunAngularSize: 2.0,     // degrees — controls shadow softness from the sun
          sunIntensity: 6.0,
          sunColor: '#fff4e0',
          turbidity: 2.5
        },
        // Named area lights ("softboxes"). This is the heart of the look.
        lights: []                 // filled from the lighting preset
      },
      shadows: {
        enabled: true,
        type: 'soft',              // 'soft' (PCSS-ish) | 'hard' | 'contact' | 'none'
        resolution: 2048,
        softness: 1.0,
        opacity: 0.45,
        bias: -0.0005,
        normalBias: 0.02,
        catcher: true,             // invisible ground that receives shadow only
        catcherSize: 12,
        contactShadow: {
          enabled: true,
          darkness: 1.1,
          blur: 2.2,
          height: 0.35,
          resolution: 512
        }
      },
      // Fast global controls that read like a photographer's language.
      keyToFill: 4.0,              // lighting ratio (contrast of the rig)
      rimStrength: 1.0,
      bounceStrength: 0.5,
      bounceColor: '#ffffff'
    },

    // ── MATERIAL ────────────────────────────────────────────────────────────
    material: {
      mode: 'original',            // see presets/materials.js
      // Multipliers applied on top of whatever the MTL/GLTF supplied.
      roughness: 1.0,
      metalness: 1.0,
      roughnessOffset: 0.0,
      metalnessOffset: 0.0,
      normalScale: 1.0,
      aoIntensity: 1.0,
      emissiveIntensity: 1.0,
      // Additions the source format usually cannot express
      clearcoat: 0.0,
      clearcoatRoughness: 0.1,
      sheen: 0.0,
      sheenColor: '#ffffff',
      sheenRoughness: 0.3,
      transmission: 0.0,
      thickness: 0.5,
      ior: 1.5,
      attenuationDistance: 1.0,
      attenuationColor: '#ffffff',
      iridescence: 0.0,
      iridescenceIOR: 1.3,
      iridescenceThickness: 400,
      anisotropy: 0.0,
      anisotropyRotation: 0,
      specularIntensity: 1.0,
      specularColor: '#ffffff',
      // Texture handling
      textureAnisotropy: 16,
      uvScale: 1.0,
      tint: null,                  // hex — multiplies base colour, null = off
      tintStrength: 1.0,
      overrideColor: null,         // hex — replaces base colour entirely
      wireframe: false,
      wireframeThickness: 1.0,
      // Non-photoreal edges
      outline: { enabled: false, color: '#000000', thickness: 1.5, threshold: 0.6 }
    },

    // ── BACKGROUND ──────────────────────────────────────────────────────────
    background: {
      type: 'solid',               // 'transparent'|'solid'|'gradient'|'environment'|'studio-cyc'|'image'
      color: '#f2f2f4',
      gradient: {
        top: '#ffffff',
        bottom: '#c9ced8',
        angle: 180,                // degrees
        style: 'linear'            // 'linear' | 'radial'
      },
      envBlur: 0.25,               // blur the environment when shown as backdrop
      envIntensity: 1.0,
      imageUrl: null,
      imageFit: 'cover',
      // Infinite-curve studio backdrop (the classic "cyc wall")
      cyc: {
        color: '#ededf0',
        curveRadius: 1.6,
        roughness: 0.85,
        size: 20,
        receiveShadow: true
      },
      // Reflective floor ("product plinth")
      floor: {
        enabled: false,
        type: 'glossy',            // 'glossy' | 'matte' | 'mirror' | 'gradient-fade'
        color: '#0e0e10',
        roughness: 0.12,
        metalness: 0.0,
        reflectivity: 0.6,
        fadeDistance: 6
      }
    },

    // ── LOOK / GRADE (post) ─────────────────────────────────────────────────
    look: {
      preset: 'clean',
      tonemap: 'agx',
      exposure: 1.0,               // stops multiplier
      contrast: 1.0,
      saturation: 1.0,
      temperatureShift: 0,         // -100..100 cool→warm grade (separate from rig WB)
      tintShift: 0,                // -100..100 green→magenta
      lift: '#000000',
      gamma: '#808080',
      gain: '#ffffff',
      bloom: { enabled: true, intensity: 0.22, threshold: 1.12, radius: 0.5, smoothing: 0.08 },
      ao: { enabled: true, intensity: 0.9, radius: 0.35, samples: 16, distanceFalloff: 1.0, denoise: true, color: '#000000' },
      vignette: { enabled: false, amount: 0.35, offset: 0.9, roundness: 1.0 },
      grain: { enabled: false, amount: 0.035, size: 1.0, animated: true, colored: false },
      chromaticAberration: { enabled: false, amount: 0.0012 },
      sharpen: { enabled: false, amount: 0.3 },
      lut: { enabled: false, url: null, intensity: 1.0 },
      halation: { enabled: false, amount: 0.15, threshold: 0.9, tint: '#ff7a3c' }
    },

    // ── RENDER ENGINE ───────────────────────────────────────────────────────
    render: {
      engine: 'raster',            // 'raster' (real-time) | 'pathtrace' (hero quality)
      width: 2048,
      height: 2048,
      resolutionPreset: 'square-2048',
      pixelRatio: 1,
      antialias: 'smaa',           // 'none' | 'msaa' | 'smaa' | 'taa' | 'ssaa2' | 'ssaa4'
      // Path tracer settings
      pathtrace: {
        samples: 256,              // target samples per pixel
        bounces: 6,
        transmissiveBounces: 4,
        filterGlossy: 0.1,
        tiles: 2,                  // higher = more responsive UI, slower total
        multipleImportanceSampling: true,
        environmentBlur: 0.0,
        backgroundAlpha: 1.0
      },
      // Progressive raster accumulation — cheap "poor man's AA + soft shadows"
      accumulate: { enabled: false, frames: 64, jitter: 0.5 }
    },

    // ── ANIMATION ───────────────────────────────────────────────────────────
    animation: {
      enabled: false,
      type: 'turntable',           // see presets/animation
      duration: 6,                 // seconds
      fps: 30,
      easing: 'linear',
      loop: true,
      pingPong: false,
      motionBlur: { enabled: false, shutter: 0.5, samples: 8 },
      turntable: { axis: 'y', revolutions: 1, direction: 1, spinObject: true },
      orbit: { startAzimuth: -30, endAzimuth: 30, startElevation: 5, endElevation: 30 },
      dolly: { startDistance: 'auto', endDistance: 'auto', zoomFactor: 0.6 },
      lightSweep: { startRotation: 0, endRotation: 360 },
      exploded: { distance: 1.5, stagger: 0.15 },
      reveal: { mode: 'clip-y', direction: 'up' },
      keyframes: []                // optional custom [{t, camera:{...}, lighting:{...}}]
    },

    // ── OUTPUT ──────────────────────────────────────────────────────────────
    output: {
      format: 'png',               // 'png'|'jpg'|'webp'|'exr'|'png-sequence'|'mp4'|'webm'|'gif'|'html'|'glb'|'json'
      backgroundMode: 'as-configured', // 'as-configured'|'transparent'|'white'|'black'|'custom'
      customBackground: '#ffffff',
      jpegQuality: 0.95,
      webpQuality: 0.95,
      // Transparent output with a *real* shadow in the alpha channel,
      // so the render drops into Photoshop/After Effects over any colour.
      alphaShadow: true,
      alphaShadowStrength: 1.0,
      // Multi-angle batch: render N views in one go
      batch: { enabled: false, angles: [], includeTurntableFrames: false },
      // Extra passes for compositing
      passes: {
        beauty: true,
        alpha: false,
        depth: false,
        normal: false,
        ao: false,
        matte: false,              // solid-colour silhouette
        shadowOnly: false,
        wireframe: false
      },
      namePattern: '{name}_{preset}_{w}x{h}',
      frameNamePattern: '{name}_{frame:04}',
      colorSpace: 'srgb'           // 'srgb' | 'linear' (exr only)
    }
  };
}

/**
 * Merge a partial config over the defaults, recursively.
 * Arrays are replaced wholesale (they are ordered data, not bags of options).
 */
export function mergeConfig(base, patch) {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(patch)) return clone(patch);
  if (typeof patch !== 'object') return patch;
  const out = Array.isArray(base) ? clone(base) : { ...(base || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = mergeConfig(out[k], v);
    } else {
      out[k] = Array.isArray(v) ? clone(v) : v;
    }
  }
  return out;
}

export function fromJSON(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  return migrate(mergeConfig(defaultConfig(), parsed));
}

/** Forward-migrate older saved configs so nobody's `.render.json` rots. */
function migrate(cfg) {
  if (!cfg.schemaVersion || cfg.schemaVersion < SCHEMA_VERSION) {
    cfg.schemaVersion = SCHEMA_VERSION;
  }
  return cfg;
}

/** Non-fatal sanity checks — returns a list of human-readable warnings. */
export function validate(cfg) {
  const warn = [];
  const { width, height } = cfg.render;
  if (width * height > 8192 * 8192) warn.push('Resolution above 8K x 8K may exceed GPU texture limits.');
  if (cfg.render.engine === 'pathtrace' && cfg.animation.enabled && cfg.render.pathtrace.samples > 128) {
    warn.push(`Path-traced animation at ${cfg.render.pathtrace.samples} spp x ${Math.round(cfg.animation.duration * cfg.animation.fps)} frames will be very slow. Consider 32-64 spp.`);
  }
  if (cfg.background.type !== 'transparent' && cfg.output.backgroundMode === 'as-configured' && cfg.output.format === 'png' && cfg.output.alphaShadow) {
    // not a problem, just a nudge
  }
  if (cfg.output.format === 'exr' && cfg.render.engine !== 'pathtrace') {
    warn.push('EXR output is most useful from the path tracer, which renders in true linear HDR.');
  }
  if (cfg.camera.dof.enabled && cfg.render.engine === 'raster') {
    warn.push('Raster depth of field is an approximation. The path tracer renders true optical bokeh.');
  }
  return warn;
}

/** Interpolate the filename pattern. */
export function formatName(pattern, vars) {
  return pattern.replace(/\{(\w+)(?::(\d+))?\}/g, (_, key, pad) => {
    let v = vars[key];
    if (v === undefined || v === null) return '';
    if (pad) v = String(v).padStart(Number(pad), '0');
    return String(v);
  });
}
