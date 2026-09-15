/** Background / backdrop presets. */

export const BACKDROP_PRESETS = {
  transparent: {
    label: 'Transparent (alpha)', group: 'Cut-out',
    note: 'No background at all. PNG keeps a real alpha channel — including a soft shadow that composites over any colour.',
    config: { type: 'transparent' }
  },
  white: {
    label: 'Pure White', group: 'Cut-out',
    note: '#FFFFFF sweep. The marketplace / catalogue default.',
    config: { type: 'solid', color: '#ffffff' }
  },
  'off-white': {
    label: 'Off White', group: 'Cut-out',
    note: 'A hair of warmth so the product edge does not disappear into the page.',
    config: { type: 'solid', color: '#f4f2ef' }
  },
  black: {
    label: 'Pure Black', group: 'Cut-out',
    note: 'Maximum drama. Works with rim-heavy lighting.',
    config: { type: 'solid', color: '#000000' }
  },
  'studio-grey': {
    label: 'Studio Grey', group: 'Cut-out',
    note: '18% grey. Neutral reference that flatters both light and dark products.',
    config: { type: 'solid', color: '#7d7d80' }
  },
  'gradient-soft': {
    label: 'Soft Gradient', group: 'Gradient',
    note: 'Light at the top falling to a deeper tone. Adds depth without competing with the object.',
    config: { type: 'gradient', gradient: { top: '#ffffff', bottom: '#c6ccd6', angle: 180, style: 'linear' } }
  },
  'gradient-radial': {
    label: 'Radial Spotlight', group: 'Gradient',
    note: 'Bright pool behind the subject fading to the corners. Focuses the eye.',
    config: { type: 'gradient', gradient: { top: '#ffffff', bottom: '#9aa2ae', style: 'radial' } }
  },
  'gradient-dark': {
    label: 'Dark Gradient', group: 'Gradient',
    note: 'Near-black vignette gradient for low-key and neon rigs.',
    config: { type: 'gradient', gradient: { top: '#2a2d33', bottom: '#08090b', angle: 180, style: 'linear' } }
  },
  'gradient-duotone': {
    label: 'Duotone Gradient', group: 'Gradient',
    note: 'Two-colour blend. Set these to your brand palette.',
    config: { type: 'gradient', gradient: { top: '#ff7a3c', bottom: '#2f7bff', angle: 160, style: 'linear' } }
  },
  cyc: {
    label: 'Infinite Cyclorama', group: 'Set',
    note: 'A curved wall-to-floor sweep with no visible seam — a real photographic cyc. Catches the shadow properly.',
    config: { type: 'studio-cyc', cyc: { color: '#ededf0', curveRadius: 1.6, roughness: 0.85, size: 20, receiveShadow: true } }
  },
  'cyc-dark': {
    label: 'Dark Cyclorama', group: 'Set',
    note: 'The same sweep in charcoal.',
    config: { type: 'studio-cyc', cyc: { color: '#1d1e22', curveRadius: 1.6, roughness: 0.7, size: 20, receiveShadow: true } }
  },
  'plinth-gloss': {
    label: 'Glossy Plinth', group: 'Set',
    note: 'Reflective floor with a fading reflection. The classic phone/watch launch shot.',
    config: {
      type: 'gradient',
      gradient: { top: '#24262c', bottom: '#0b0c0e', angle: 180 },
      floor: { enabled: true, type: 'glossy', color: '#0e0e10', roughness: 0.1, reflectivity: 0.75, fadeDistance: 5 }
    }
  },
  'plinth-white': {
    label: 'White Gloss Plinth', group: 'Set',
    note: 'Bright reflective surface under the object with a white sweep behind.',
    config: {
      type: 'gradient',
      gradient: { top: '#ffffff', bottom: '#e7e9ed', angle: 180 },
      floor: { enabled: true, type: 'glossy', color: '#f2f3f5', roughness: 0.14, reflectivity: 0.5, fadeDistance: 5 }
    }
  },
  environment: {
    label: 'Show Environment', group: 'Environment',
    note: 'Display the actual lighting environment behind the object, so reflections and backdrop agree.',
    config: { type: 'environment', envBlur: 0.0, envIntensity: 1.0 }
  },
  'environment-blurred': {
    label: 'Blurred Environment', group: 'Environment',
    note: 'The environment defocused into soft colour — context without distraction.',
    config: { type: 'environment', envBlur: 0.45, envIntensity: 1.0 }
  }
};

export function backdropPresetList() {
  return Object.entries(BACKDROP_PRESETS).map(([key, p]) => ({ key, label: p.label, group: p.group, note: p.note }));
}
export function getBackdropPreset(key) {
  const p = BACKDROP_PRESETS[key];
  return p ? JSON.parse(JSON.stringify(p.config)) : {};
}
