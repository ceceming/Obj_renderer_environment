/**
 * Lighting moods.
 *
 * Each preset is a real photographic/cinematographic setup expressed as area
 * lights in spherical coordinates around the subject, plus a description of the
 * surrounding environment (which becomes the IBL). We synthesise the
 * environment map from these lights rather than shipping fixed HDRIs, so every
 * source stays movable, resizable and re-colourable — and the specular
 * highlights in the render are the actual shape of the actual softbox.
 *
 * Coordinate convention
 *   azimuth   degrees around the vertical axis. 0 = front of subject, +ve = to
 *             the subject's right (clockwise seen from above).
 *   elevation degrees above the horizon. 0 = eye level, 90 = straight overhead.
 *   distance  multiples of the subject's size (which is normalised to 1.0).
 *   width/height  size of the emitting rectangle, in the same units.
 *
 * The single most important quality lever is the *ratio of source size to
 * subject size*: a 4x4 softbox at 2 units away produces gentle wraparound
 * shadows; a 0.3 unit source at the same distance produces hard, crisp ones.
 */

let uid = 0;
const L = (role, o = {}) => ({
  id: `l${++uid}`,
  role,
  name: o.name || role,
  enabled: o.enabled !== false,
  type: o.type || 'area',
  shape: o.shape || 'rect',       // 'rect' | 'disc' | 'strip' | 'ring'
  azimuth: o.az ?? 0,
  elevation: o.el ?? 20,
  distance: o.dist ?? 3,
  width: o.w ?? 3,
  height: o.h ?? 3,
  intensity: o.intensity ?? 1,
  color: o.color ?? '#ffffff',
  temperature: o.temp ?? 6500,
  spread: o.spread ?? 1.0,        // 0 = focused/hard, 1 = fully diffused
  falloff: o.falloff ?? 'inverse-square',
  visible: o.visible ?? false,    // does the source show up in the background plate
  castShadow: o.castShadow ?? (role === 'key'),
  relativeTo: o.relativeTo || 'world',  // 'world' | 'camera'
  barnDoors: o.barnDoors ?? 0,    // 0..1 tightens the beam
  gel: o.gel ?? null
});

export const LIGHTING_PRESETS = {
  // ────────────────────────────────────────────── STUDIO ──────────────────
  'studio-softbox': {
    label: 'Studio Softbox',
    group: 'Studio',
    note: 'The safe, beautiful default. Big key camera-left, large fill opposite, subtle top. Flatters almost any product.',
    config: {
      temperature: 6000, keyToFill: 3.0, rimStrength: 0.6, bounceStrength: 0.55,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#e8ecf2', horizon: '#f6f7f9', ground: '#b8bcc4', sunEnabled: false },
        lights: [
          L('key',    { name: 'Key softbox',  az: -42, el: 28, dist: 2.6, w: 4.0, h: 4.0, intensity: 8.889, temp: 6000, castShadow: true }),
          L('fill',   { name: 'Fill panel',   az: 58,  el: 12, dist: 3.2, w: 5.0, h: 3.5, intensity: 2.917, temp: 6500 }),
          L('top',    { name: 'Overhead',     az: 0,   el: 78, dist: 2.8, w: 4.5, h: 3.0, intensity: 2.7, temp: 6200 }),
          L('rim',    { name: 'Edge strip',   az: 165, el: 26, dist: 2.6, w: 0.5, h: 3.2, intensity: 0.391, temp: 6800, shape: 'strip' })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 1.15, opacity: 0.38, contactShadow: { enabled: true, darkness: 1.0, blur: 2.4, height: 0.35 } }
    }
  },

  'three-point': {
    label: 'Classic Three-Point',
    group: 'Studio',
    note: 'Key / fill / backlight at textbook angles. Readable form, clear separation from the background.',
    config: {
      temperature: 5600, keyToFill: 4.0, rimStrength: 1.2,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#d9dee6', horizon: '#eceef2', ground: '#9aa0a8', sunEnabled: false },
        lights: [
          L('key',  { name: 'Key',       az: -45, el: 35, dist: 2.8, w: 2.2, h: 2.2, intensity: 3.227, temp: 5600, castShadow: true }),
          L('fill', { name: 'Fill',      az: 50,  el: 10, dist: 3.4, w: 3.6, h: 3.0, intensity: 1.8, temp: 6200 }),
          L('rim',  { name: 'Backlight', az: 160, el: 42, dist: 2.6, w: 1.4, h: 1.4, intensity: 0.98, temp: 7000 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 0.8, opacity: 0.5 }
    }
  },

  'high-key': {
    label: 'High Key (bright, shadowless)',
    group: 'Studio',
    note: 'Wraparound light from every side, near-zero shadow. The e-commerce / catalogue standard.',
    config: {
      temperature: 6500, keyToFill: 1.2, bounceStrength: 1.0,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#ffffff', horizon: '#ffffff', ground: '#f0f0f2', sunEnabled: false },
        lights: [
          L('key',    { name: 'Front-left',  az: -35, el: 22, dist: 2.6, w: 6, h: 6, intensity: 16.8, temp: 6500, castShadow: true }),
          L('fill',   { name: 'Front-right', az: 35,  el: 22, dist: 2.6, w: 6, h: 6, intensity: 14.4, temp: 6500 }),
          L('top',    { name: 'Overhead',    az: 0,   el: 85, dist: 2.6, w: 7, h: 7, intensity: 17.422, temp: 6500 }),
          L('bounce', { name: 'Floor bounce',az: 0,   el: -60,dist: 2.2, w: 6, h: 6, intensity: 6.4, temp: 6500 }),
          L('rim',    { name: 'Back wash',   az: 180, el: 25, dist: 3.0, w: 6, h: 4, intensity: 5.333, temp: 6800 })
        ]
      },
      shadows: { enabled: true, type: 'contact', softness: 1.6, opacity: 0.16, contactShadow: { enabled: true, darkness: 0.7, blur: 3.2, height: 0.3 } }
    }
  },

  'low-key': {
    label: 'Low Key (dark, dramatic)',
    group: 'Studio',
    note: 'One hard key, almost no fill, deep falloff into black. Shape is carried entirely by the highlight edge.',
    config: {
      temperature: 5200, keyToFill: 16.0, rimStrength: 1.6, bounceStrength: 0.05,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#0a0b0e', horizon: '#111318', ground: '#050506', sunEnabled: false },
        lights: [
          L('key', { name: 'Hard key',    az: -55, el: 38, dist: 2.4, w: 0.9, h: 0.9, intensity: 0.81, temp: 5200, castShadow: true, spread: 0.3 }),
          L('rim', { name: 'Rim right',   az: 135, el: 22, dist: 2.4, w: 0.35, h: 3.0, intensity: 0.7, temp: 7600, shape: 'strip' }),
          L('fill',{ name: 'Whisper fill',az: 70,  el: 8,  dist: 3.0, w: 2.5, h: 2.5, intensity: 0.243, temp: 6800 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 0.35, opacity: 0.85 }
    }
  },

  'rembrandt': {
    label: 'Rembrandt',
    group: 'Studio',
    note: '45° up and 45° across. Creates the signature triangle of light on the shadow side. Sculptural.',
    config: {
      temperature: 5400, keyToFill: 6.0,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#1b1d22', horizon: '#26282e', ground: '#101114', sunEnabled: false },
        lights: [
          L('key',  { name: 'Rembrandt key', az: -45, el: 45, dist: 2.5, w: 1.6, h: 1.6, intensity: 1.991, temp: 5400, castShadow: true, spread: 0.55 }),
          L('fill', { name: 'Negative-side fill', az: 65, el: 12, dist: 3.2, w: 2.4, h: 2.4, intensity: 0.576, temp: 6400 }),
          L('rim',  { name: 'Hair light', az: 155, el: 55, dist: 2.4, w: 1.0, h: 1.0, intensity: 0.333, temp: 7200 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 0.6, opacity: 0.68 }
    }
  },

  'clamshell': {
    label: 'Clamshell / Beauty',
    group: 'Studio',
    note: 'Big source above, bright bounce below. Glossy, symmetric, almost no downward shadow. Cosmetics look.',
    config: {
      temperature: 6200, keyToFill: 1.8,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#f4f6fa', horizon: '#e6e9ee', ground: '#d6d9df', sunEnabled: false },
        lights: [
          L('key',    { name: 'Beauty dish', az: 0, el: 58, dist: 2.2, w: 3.4, h: 3.4, intensity: 6.053, temp: 6200, shape: 'disc', castShadow: true }),
          L('bounce', { name: 'Under-bounce',az: 0, el: -32,dist: 1.9, w: 3.4, h: 2.4, intensity: 2.176, temp: 6400 }),
          L('rim',    { name: 'Left kick',   az: -120, el: 18, dist: 2.6, w: 0.4, h: 2.6, intensity: 0.231, temp: 7000, shape: 'strip' }),
          L('rim',    { name: 'Right kick',  az: 120,  el: 18, dist: 2.6, w: 0.4, h: 2.6, intensity: 0.231, temp: 7000, shape: 'strip' })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 1.3, opacity: 0.3 }
    }
  },

  'split': {
    label: 'Split Light',
    group: 'Studio',
    note: 'Single source at 90°. Half lit, half black. Graphic and severe — great for silhouette-forward design work.',
    config: {
      temperature: 5600, keyToFill: 20.0,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#0d0e11', horizon: '#141619', ground: '#08090b', sunEnabled: false },
        lights: [
          L('key', { name: 'Side key', az: -90, el: 8, dist: 2.3, w: 2.2, h: 3.4, intensity: 6.233, temp: 5600, castShadow: true })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 0.5, opacity: 0.9 }
    }
  },

  'product-white': {
    label: 'Packshot White',
    group: 'Studio',
    note: 'Pure white sweep, even light, tiny contact shadow. Built for cut-out PNGs and marketplace listings.',
    config: {
      temperature: 6500, keyToFill: 1.5, bounceStrength: 0.9,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#ffffff', horizon: '#fbfbfc', ground: '#f4f4f6', sunEnabled: false },
        lights: [
          L('key',  { name: 'Left bank',  az: -50, el: 30, dist: 2.8, w: 5, h: 5, intensity: 10.556, temp: 6500, castShadow: true }),
          L('fill', { name: 'Right bank', az: 50,  el: 30, dist: 2.8, w: 5, h: 5, intensity: 8.889, temp: 6500 }),
          L('top',  { name: 'Top bank',   az: 0,   el: 82, dist: 2.6, w: 6, h: 6, intensity: 12.0, temp: 6500 }),
          L('rim',  { name: 'Rear fill',  az: 180, el: 20, dist: 3.2, w: 5, h: 4, intensity: 3.556, temp: 6500 })
        ]
      },
      shadows: { enabled: true, type: 'contact', softness: 1.4, opacity: 0.2, contactShadow: { enabled: true, darkness: 0.85, blur: 2.6, height: 0.28 } }
    }
  },

  'jewelry-sparkle': {
    label: 'Jewellery / Sparkle',
    group: 'Studio',
    note: 'Many small hard sources so faceted and polished surfaces throw sharp specular glints. Use with high metalness.',
    config: {
      temperature: 6800, keyToFill: 2.5, rimStrength: 1.5,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#101318', horizon: '#1a1e25', ground: '#0a0c0f', sunEnabled: false },
        lights: [
          L('key',    { name: 'Glint 1', az: -38, el: 46, dist: 2.4, w: 0.35, h: 0.35, intensity: 2.4, temp: 6800, castShadow: true, spread: 0.15 }),
          L('accent', { name: 'Glint 2', az: 42,  el: 32, dist: 2.4, w: 0.3,  h: 0.3,  intensity: 1.7, temp: 7200, spread: 0.15 }),
          L('accent', { name: 'Glint 3', az: 118, el: 55, dist: 2.4, w: 0.28, h: 0.28, intensity: 1.2,  temp: 6400, spread: 0.15 }),
          L('accent', { name: 'Glint 4', az: -140,el: 18, dist: 2.4, w: 0.25, h: 0.25, intensity: 0.9,  temp: 7600, spread: 0.15 }),
          L('fill',   { name: 'Soft base', az: 0, el: 20, dist: 3.4, w: 4, h: 4, intensity: 2.2, temp: 6600 })
        ]
      },
      shadows: { enabled: true, type: 'hard', softness: 0.25, opacity: 0.7 }
    }
  },

  'automotive-strips': {
    label: 'Automotive Strip Lights',
    group: 'Studio',
    note: 'Long narrow sources that draw continuous highlight lines along curved bodywork. The car-photography trick.',
    config: {
      temperature: 6400, keyToFill: 2.0, rimStrength: 1.4,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#15171c', horizon: '#20242b', ground: '#0c0d10', sunEnabled: false },
        lights: [
          L('key',    { name: 'Top strip L', az: -30, el: 62, dist: 2.6, w: 6.0, h: 0.35, intensity: 1.867, temp: 6400, shape: 'strip', castShadow: true }),
          L('accent', { name: 'Top strip R', az: 30,  el: 62, dist: 2.6, w: 6.0, h: 0.35, intensity: 1.517, temp: 6600, shape: 'strip' }),
          L('rim',    { name: 'Side strip L',az: -95, el: 20, dist: 2.4, w: 0.3, h: 4.5, intensity: 0.75, temp: 7000, shape: 'strip' }),
          L('rim',    { name: 'Side strip R',az: 95,  el: 20, dist: 2.4, w: 0.3, h: 4.5, intensity: 0.75, temp: 7000, shape: 'strip' }),
          L('fill',   { name: 'Ambient',     az: 0,   el: 10, dist: 4.0, w: 6, h: 4, intensity: 1.333, temp: 6500 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 0.7, opacity: 0.6 }
    }
  },

  'ring-light': {
    label: 'Ring Light',
    group: 'Studio',
    note: 'On-axis circular source. Flat, shadowless, with a distinctive round catchlight. Very modern/graphic.',
    config: {
      temperature: 6500, keyToFill: 1.1,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#191b20', horizon: '#232730', ground: '#101216', sunEnabled: false },
        lights: [
          L('key', { name: 'Ring', az: 0, el: 6, dist: 2.2, w: 3.2, h: 3.2, intensity: 6.255, temp: 6500, shape: 'ring', relativeTo: 'camera', castShadow: true }),
          L('fill',{ name: 'Ambient lift', az: 0, el: 40, dist: 3.4, w: 4, h: 4, intensity: 0.889, temp: 6500 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 1.0, opacity: 0.35 }
    }
  },

  // ────────────────────────────────────────────── OUTDOOR ─────────────────
  'golden-hour': {
    label: 'Golden Hour',
    group: 'Outdoor',
    note: 'Low warm sun, long soft shadows, cool sky fill. The most universally flattering natural light.',
    config: {
      temperature: 3400, keyToFill: 5.0, rimStrength: 1.3, bounceStrength: 0.4, bounceColor: '#ffd9a8',
      environment: {
        type: 'procedural',
        sky: { mode: 'sunset', zenith: '#2e5f96', horizon: '#ffb264', ground: '#6b5540',
               sunEnabled: true, sunAzimuth: -62, sunElevation: 8, sunAngularSize: 1.2, sunIntensity: 9.0, sunColor: '#ffb066', turbidity: 4.0 },
        lights: [
          L('fill', { name: 'Sky dome fill', az: 90, el: 45, dist: 5, w: 10, h: 10, intensity: 11.111, temp: 9500 }),
          L('bounce',{ name: 'Ground bounce', az: -62, el: -35, dist: 3, w: 6, h: 6, intensity: 3.2, temp: 4200 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 0.55, opacity: 0.55 }
    }
  },

  'blue-hour': {
    label: 'Blue Hour',
    group: 'Outdoor',
    note: 'Sun just below the horizon. Deep blue ambient, no direct key, gentle everywhere. Moody but readable.',
    config: {
      temperature: 8800, keyToFill: 1.6, bounceStrength: 0.3,
      environment: {
        type: 'procedural',
        sky: { mode: 'night', zenith: '#101c3a', horizon: '#3b5f9e', ground: '#0d1526',
               sunEnabled: true, sunAzimuth: -80, sunElevation: -4, sunAngularSize: 6, sunIntensity: 1.6, sunColor: '#ff9a5c', turbidity: 3.0 },
        lights: [
          L('key',  { name: 'Sky bank',   az: -70, el: 30, dist: 4.5, w: 9, h: 9, intensity: 19.8, temp: 9200, castShadow: true }),
          L('rim',  { name: 'Warm accent',az: 140, el: 14, dist: 3.0, w: 1.2, h: 2.0, intensity: 0.427, temp: 2800 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 1.5, opacity: 0.3 }
    }
  },

  'overcast': {
    label: 'Overcast Daylight',
    group: 'Outdoor',
    note: 'The whole sky is one giant softbox. Zero harsh shadow, perfectly even, true colours. Ideal for material study.',
    config: {
      temperature: 7000, keyToFill: 1.3, bounceStrength: 0.5,
      environment: {
        type: 'procedural',
        sky: { mode: 'overcast', zenith: '#c9d4e2', horizon: '#e8edf3', ground: '#7d8188', sunEnabled: false, turbidity: 8 },
        lights: [
          L('key', { name: 'Cloud dome', az: -25, el: 55, dist: 5, w: 12, h: 12, intensity: 48.0, temp: 7000, castShadow: true }),
          L('fill',{ name: 'Opposite sky', az: 155, el: 40, dist: 5, w: 10, h: 10, intensity: 20.0, temp: 7400 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 2.0, opacity: 0.25, contactShadow: { enabled: true, darkness: 0.9, blur: 3.0, height: 0.4 } }
    }
  },

  'midday-sun': {
    label: 'Harsh Midday Sun',
    group: 'Outdoor',
    note: 'Small, high, brutal source. Crisp black shadows and blown highlights. Deliberately graphic.',
    config: {
      temperature: 5600, keyToFill: 8.0, bounceStrength: 0.35,
      environment: {
        type: 'procedural',
        sky: { mode: 'daylight', zenith: '#2a6fd6', horizon: '#b9d6f2', ground: '#9a9284',
               sunEnabled: true, sunAzimuth: -20, sunElevation: 68, sunAngularSize: 0.53, sunIntensity: 14, sunColor: '#fff6e8', turbidity: 2.0 },
        lights: [
          L('fill', { name: 'Sky fill', az: 160, el: 50, dist: 6, w: 12, h: 12, intensity: 17.6, temp: 11000 })
        ]
      },
      shadows: { enabled: true, type: 'hard', softness: 0.12, opacity: 0.8 }
    }
  },

  'backlit-sunset': {
    label: 'Backlit Sunset',
    group: 'Outdoor',
    note: 'Sun behind the subject. Blazing rim, silhouette body, warm haze. Very strong for hero shots.',
    config: {
      temperature: 3000, keyToFill: 10.0, rimStrength: 2.0,
      environment: {
        type: 'procedural',
        sky: { mode: 'sunset', zenith: '#1f3a6b', horizon: '#ff8a3c', ground: '#4a3626',
               sunEnabled: true, sunAzimuth: 175, sunElevation: 6, sunAngularSize: 1.6, sunIntensity: 18, sunColor: '#ff9a45', turbidity: 6.0 },
        lights: [
          L('fill',  { name: 'Front lift', az: 0, el: 18, dist: 3.4, w: 4, h: 4, intensity: 1.422, temp: 7200 }),
          L('bounce',{ name: 'Warm bounce',az: 20, el: -30, dist: 2.6, w: 4, h: 4, intensity: 1.067, temp: 3600 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 0.7, opacity: 0.6 }
    }
  },

  'window-light': {
    label: 'North Window (interior)',
    group: 'Indoor',
    note: 'Single large soft window to one side, warm room bounce on the other. The classic still-life interior.',
    config: {
      temperature: 6400, keyToFill: 4.5, bounceStrength: 0.6, bounceColor: '#f3e2cd',
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#3a3d44', horizon: '#4d5158', ground: '#2b2d31', sunEnabled: false },
        lights: [
          L('key',    { name: 'Window',      az: -78, el: 26, dist: 2.4, w: 3.0, h: 4.2, intensity: 9.1, temp: 6600, castShadow: true }),
          L('bounce', { name: 'Wall bounce', az: 95,  el: 14, dist: 2.8, w: 4.0, h: 3.0, intensity: 1.467, temp: 4200 }),
          L('fill',   { name: 'Ceiling',     az: 0,   el: 80, dist: 3.0, w: 5, h: 5, intensity: 1.667, temp: 4800 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 1.1, opacity: 0.5 }
    }
  },

  'warm-interior': {
    label: 'Warm Interior (tungsten)',
    group: 'Indoor',
    note: 'Practical tungsten lamps, warm and pooled, with cool window spill. Homely, editorial.',
    config: {
      temperature: 3200, keyToFill: 3.5, bounceStrength: 0.5, bounceColor: '#ffd9ae',
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#2a2119', horizon: '#3d3025', ground: '#1c1712', sunEnabled: false },
        lights: [
          L('key',   { name: 'Lamp',        az: -50, el: 42, dist: 2.2, w: 1.4, h: 1.4, intensity: 1.307, temp: 3000, castShadow: true }),
          L('fill',  { name: 'Second lamp', az: 70,  el: 30, dist: 2.8, w: 1.6, h: 1.6, intensity: 0.512, temp: 2800 }),
          L('rim',   { name: 'Window spill',az: 150, el: 22, dist: 3.0, w: 2.0, h: 3.0, intensity: 0.933, temp: 8000 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 0.9, opacity: 0.55 }
    }
  },

  'gallery': {
    label: 'Gallery / Museum',
    group: 'Indoor',
    note: 'Narrow overhead spots on a neutral grey room. Object glows, surroundings fall away. Very "exhibit".',
    config: {
      temperature: 4200, keyToFill: 7.0,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#34363b', horizon: '#3e4046', ground: '#232428', sunEnabled: false },
        lights: [
          L('key',    { name: 'Spot front', az: -22, el: 62, dist: 2.6, w: 0.8, h: 0.8, intensity: 4.2, temp: 4200, castShadow: true, spread: 0.35, barnDoors: 0.5 }),
          L('accent', { name: 'Spot side',  az: 58,  el: 58, dist: 2.6, w: 0.7, h: 0.7, intensity: 1.7, temp: 4000, spread: 0.35, barnDoors: 0.5 }),
          L('fill',   { name: 'Room ambient', az: 0, el: 25, dist: 4.5, w: 8, h: 6, intensity: 1.867, temp: 5000 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 0.5, opacity: 0.65 }
    }
  },

  // ────────────────────────────────────────────── STYLISED ────────────────
  'neon-cyberpunk': {
    label: 'Neon / Cyberpunk',
    group: 'Stylised',
    note: 'Magenta key against cyan rim on near-black. Extremely strong on screens; pairs well with bloom.',
    config: {
      temperature: 6500, keyToFill: 2.0, rimStrength: 1.8,
      environment: {
        type: 'procedural',
        sky: { mode: 'night', zenith: '#07060f', horizon: '#150a22', ground: '#04030a', sunEnabled: false },
        lights: [
          L('key',    { name: 'Magenta bank', az: -55, el: 22, dist: 2.4, w: 3.0, h: 4.0, intensity: 8.667, color: '#ff2d95', temp: 6500, castShadow: true }),
          L('rim',    { name: 'Cyan rim',     az: 125, el: 28, dist: 2.4, w: 0.4, h: 4.0, intensity: 1.244, color: '#12e8ff', shape: 'strip' }),
          L('accent', { name: 'Violet top',   az: 20,  el: 72, dist: 2.6, w: 3.0, h: 3.0, intensity: 2.2, color: '#8a3cff' }),
          L('fill',   { name: 'Deep blue fill', az: 60, el: 6, dist: 3.2, w: 3, h: 3, intensity: 0.8, color: '#1b3cff' })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 0.8, opacity: 0.7 }
    }
  },

  'duotone-gel': {
    label: 'Duotone Gels',
    group: 'Stylised',
    note: 'Two complementary gelled sources from opposite sides. Colour does the modelling instead of brightness.',
    config: {
      temperature: 6500, keyToFill: 1.3, rimStrength: 1.0,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#0e0f14', horizon: '#16171e', ground: '#08090c', sunEnabled: false },
        lights: [
          L('key',  { name: 'Warm gel', az: -65, el: 24, dist: 2.5, w: 3.2, h: 3.2, intensity: 6.258, color: '#ff7a3c', castShadow: true }),
          L('fill', { name: 'Cool gel', az: 75,  el: 20, dist: 2.5, w: 3.2, h: 3.2, intensity: 5.12, color: '#2f7bff' }),
          L('top',  { name: 'Neutral top', az: 0, el: 80, dist: 2.8, w: 3, h: 3, intensity: 0.9, temp: 6500 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 1.0, opacity: 0.55 }
    }
  },

  'teal-orange': {
    label: 'Teal & Orange (cinematic)',
    group: 'Stylised',
    note: 'Warm key, teal ambient and rim. The blockbuster grade, done in-camera rather than in post.',
    config: {
      temperature: 4000, keyToFill: 3.2, rimStrength: 1.4,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#0d1f26', horizon: '#14323d', ground: '#081318', sunEnabled: false },
        lights: [
          L('key',  { name: 'Warm key',  az: -48, el: 30, dist: 2.5, w: 2.6, h: 2.6, intensity: 4.882, color: '#ffb173', castShadow: true }),
          L('fill', { name: 'Teal fill', az: 62,  el: 14, dist: 3.0, w: 4.0, h: 3.2, intensity: 2.702, color: '#3fbdc9' }),
          L('rim',  { name: 'Teal rim',  az: 155, el: 32, dist: 2.4, w: 0.5, h: 3.4, intensity: 0.756, color: '#6fe6f0', shape: 'strip' })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 0.85, opacity: 0.58 }
    }
  },

  'silhouette': {
    label: 'Silhouette',
    group: 'Stylised',
    note: 'Bright background, nothing on the front. Pure shape. Superb as a design element or a matte source.',
    config: {
      temperature: 6500, keyToFill: 40.0, bounceStrength: 0.0,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#f4f6f8', horizon: '#ffffff', ground: '#e6e8ec', sunEnabled: false },
        lights: [
          L('rim', { name: 'Back wall', az: 180, el: 18, dist: 3.0, w: 9, h: 7, intensity: 63.0, temp: 6500, visible: true }),
          L('fill',{ name: 'Trace fill', az: 0, el: 20, dist: 3.0, w: 2, h: 2, intensity: 0.053, temp: 6500 })
        ]
      },
      shadows: { enabled: false, type: 'none', opacity: 0 }
    }
  },

  'topdown-flat': {
    label: 'Top-Down Flatlay',
    group: 'Stylised',
    note: 'Even overhead light for knolling / flatlay layouts. Pair with the top-down camera preset.',
    config: {
      temperature: 6000, keyToFill: 1.4,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#ffffff', horizon: '#f2f3f5', ground: '#e2e3e7', sunEnabled: false },
        lights: [
          L('key',  { name: 'Overhead bank', az: -20, el: 78, dist: 2.8, w: 7, h: 7, intensity: 24.5, temp: 6000, castShadow: true }),
          L('fill', { name: 'Side fill',     az: 160, el: 48, dist: 3.2, w: 5, h: 5, intensity: 5.556, temp: 6400 })
        ]
      },
      shadows: { enabled: true, type: 'soft', softness: 1.2, opacity: 0.32 }
    }
  },

  'technical-even': {
    label: 'Technical / Documentation',
    group: 'Utility',
    note: 'Completely even, colour-neutral, shadow-free. Not pretty — accurate. For spec sheets and diagrams.',
    config: {
      temperature: 6500, keyToFill: 1.0, bounceStrength: 1.0,
      environment: {
        type: 'procedural',
        sky: { mode: 'studio', zenith: '#ffffff', horizon: '#ffffff', ground: '#ffffff', sunEnabled: false },
        lights: [
          L('key',  { name: 'Ambient dome', az: 0, el: 45, dist: 4, w: 12, h: 12, intensity: 51.2, temp: 6500, castShadow: false })
        ]
      },
      shadows: { enabled: false, type: 'none', opacity: 0 }
    }
  }
};

export const LIGHTING_GROUPS = ['Studio', 'Indoor', 'Outdoor', 'Stylised', 'Utility'];

export function lightingPresetList() {
  return Object.entries(LIGHTING_PRESETS).map(([key, p]) => ({
    key, label: p.label, group: p.group, note: p.note
  }));
}

/** Returns a deep copy so callers can mutate the rig freely. */
export function getLightingPreset(key) {
  const p = LIGHTING_PRESETS[key] || LIGHTING_PRESETS['studio-softbox'];
  return JSON.parse(JSON.stringify(p.config));
}
