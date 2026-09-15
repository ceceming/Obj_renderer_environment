/**
 * Looks — the post-processing grade applied after the render.
 *
 * Bloom thresholds are expressed in LINEAR light, where 1.0 is a diffuse white
 * surface at correct exposure. Anything at or below 1.0 makes a plain white
 * backdrop bloom and flood the subject, so these sit above it: only genuine
 * highlights — specular hits, emissive surfaces, the sun — should glow.
 *
 * Keep these subtle. A good render needs almost no grading; a heavy grade is
 * usually compensating for a lighting problem. The exception is deliberate
 * stylisation, which is what the bottom half of this list is for.
 */

export const LOOK_PRESETS = {
  clean: {
    label: 'Clean (neutral)', group: 'Neutral',
    note: 'AgX tone mapping, mild AO and bloom, nothing else. Truthful to the lighting.',
    config: {
      tonemap: 'agx', exposure: 1.0, contrast: 1.0, saturation: 1.0,
      bloom: { enabled: true, intensity: 0.18, threshold: 1.15, radius: 0.45 },
      ao: { enabled: true, intensity: 0.85, radius: 0.32 },
      vignette: { enabled: false }, grain: { enabled: false }
    }
  },
  accurate: {
    label: 'Colour Accurate', group: 'Neutral',
    note: 'Khronos Neutral tone mapping, no bloom, no grade. For when the client needs the real product colour.',
    config: {
      tonemap: 'neutral', exposure: 1.0, contrast: 1.0, saturation: 1.0,
      bloom: { enabled: false }, ao: { enabled: true, intensity: 0.6, radius: 0.28 },
      vignette: { enabled: false }, grain: { enabled: false }
    }
  },
  punchy: {
    label: 'Punchy Commercial', group: 'Commercial',
    note: 'More contrast and saturation, brighter bloom. Reads well at small sizes and on social.',
    config: {
      tonemap: 'aces', exposure: 1.08, contrast: 1.16, saturation: 1.14,
      bloom: { enabled: true, intensity: 0.3, threshold: 1.02, radius: 0.55 },
      ao: { enabled: true, intensity: 1.0, radius: 0.35 },
      sharpen: { enabled: true, amount: 0.25 },
      vignette: { enabled: true, amount: 0.22, offset: 1.0 }
    }
  },
  editorial: {
    label: 'Editorial Matte', group: 'Commercial',
    note: 'Lifted blacks and reduced saturation — the "magazine" print feel.',
    config: {
      tonemap: 'agx', exposure: 1.0, contrast: 0.94, saturation: 0.9,
      lift: '#14161a', gain: '#f7f5f2',
      bloom: { enabled: true, intensity: 0.14, threshold: 1.2 },
      ao: { enabled: true, intensity: 0.8 },
      grain: { enabled: true, amount: 0.022, size: 1.2 },
      vignette: { enabled: true, amount: 0.2 }
    }
  },
  cinematic: {
    label: 'Cinematic', group: 'Film',
    note: 'ACES, slight teal in the shadows and warmth in the highlights, letterbox-friendly contrast.',
    config: {
      tonemap: 'aces', exposure: 1.02, contrast: 1.12, saturation: 1.05,
      lift: '#0a1418', gain: '#fff6ec', temperatureShift: 6,
      bloom: { enabled: true, intensity: 0.26, threshold: 1.06, radius: 0.6 },
      halation: { enabled: true, amount: 0.12, threshold: 1.15 },
      ao: { enabled: true, intensity: 1.0 },
      vignette: { enabled: true, amount: 0.34 },
      grain: { enabled: true, amount: 0.028 }
    }
  },
  'film-emulation': {
    label: 'Film Stock', group: 'Film',
    note: 'Cineon-style base with halation, grain and a warm shoulder. Softer highlights than digital.',
    config: {
      tonemap: 'cineon', exposure: 1.12, contrast: 1.08, saturation: 0.96,
      lift: '#12100e', gamma: '#828078', gain: '#fff8ee',
      bloom: { enabled: true, intensity: 0.2, threshold: 1.1 },
      halation: { enabled: true, amount: 0.22, threshold: 1.1, tint: '#ff6a2c' },
      grain: { enabled: true, amount: 0.045, size: 1.35, colored: true },
      ao: { enabled: true, intensity: 0.9 },
      vignette: { enabled: true, amount: 0.3 }
    }
  },
  'high-key-soft': {
    label: 'High-Key Soft', group: 'Commercial',
    note: 'Bright, airy, low contrast. Pairs with the high-key and packshot lighting rigs.',
    config: {
      tonemap: 'agx', exposure: 1.18, contrast: 0.9, saturation: 0.98,
      lift: '#0c0c0e', gain: '#ffffff',
      bloom: { enabled: true, intensity: 0.28, threshold: 1.0, radius: 0.65 },
      ao: { enabled: true, intensity: 0.55, radius: 0.3 },
      vignette: { enabled: false }, grain: { enabled: false }
    }
  },
  noir: {
    label: 'Monochrome Noir', group: 'Stylised',
    note: 'Desaturated to black and white with hard contrast and a heavy vignette.',
    config: {
      tonemap: 'aces', exposure: 0.98, contrast: 1.35, saturation: 0.0,
      bloom: { enabled: true, intensity: 0.18, threshold: 1.12 },
      ao: { enabled: true, intensity: 1.2 },
      vignette: { enabled: true, amount: 0.55, offset: 0.78 },
      grain: { enabled: true, amount: 0.05, size: 1.1 }
    }
  },
  'neon-glow': {
    label: 'Neon Glow', group: 'Stylised',
    note: 'Aggressive bloom and chromatic aberration. Built for the cyberpunk and duotone rigs.',
    config: {
      tonemap: 'aces', exposure: 1.05, contrast: 1.2, saturation: 1.3,
      bloom: { enabled: true, intensity: 0.75, threshold: 0.9, radius: 0.8, smoothing: 0.2 },
      chromaticAberration: { enabled: true, amount: 0.0025 },
      ao: { enabled: true, intensity: 1.1 },
      vignette: { enabled: true, amount: 0.42 },
      grain: { enabled: true, amount: 0.03 }
    }
  },
  'product-crisp': {
    label: 'Product Crisp', group: 'Commercial',
    note: 'Neutral colour, extra micro-contrast and sharpening. Makes edges and textures pop for print.',
    config: {
      tonemap: 'neutral', exposure: 1.0, contrast: 1.06, saturation: 1.04,
      bloom: { enabled: true, intensity: 0.1, threshold: 1.25 },
      ao: { enabled: true, intensity: 1.0, radius: 0.28, denoise: true },
      sharpen: { enabled: true, amount: 0.45 },
      vignette: { enabled: false }, grain: { enabled: false }
    }
  },
  flat: {
    label: 'Flat / No Post', group: 'Technical',
    note: 'Everything off. Raw shaded output for diagrams, textures, or downstream grading.',
    config: {
      tonemap: 'neutral', exposure: 1.0, contrast: 1.0, saturation: 1.0,
      bloom: { enabled: false }, ao: { enabled: false }, vignette: { enabled: false },
      grain: { enabled: false }, chromaticAberration: { enabled: false }, sharpen: { enabled: false }
    }
  },
  'log-for-grading': {
    label: 'Log (for external grading)', group: 'Technical',
    note: 'Low contrast, maximum latitude. Export this when you intend to grade in DaVinci or After Effects.',
    config: {
      tonemap: 'cineon', exposure: 1.0, contrast: 0.82, saturation: 0.85,
      bloom: { enabled: false }, ao: { enabled: true, intensity: 0.7 },
      vignette: { enabled: false }, grain: { enabled: false }
    }
  }
};

export function lookPresetList() {
  return Object.entries(LOOK_PRESETS).map(([key, p]) => ({ key, label: p.label, group: p.group, note: p.note }));
}
export function getLookPreset(key) {
  const p = LOOK_PRESETS[key];
  return p ? JSON.parse(JSON.stringify(p.config)) : {};
}
