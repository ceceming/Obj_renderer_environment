/**
 * Camera / shot presets.
 *
 * Focal length is the aesthetic control that matters most after position:
 * short lenses (24-35mm) exaggerate depth and make objects feel monumental,
 * long lenses (85-200mm) compress and flatter. Product photography lives at
 * 85-135mm for a reason — it removes the perspective distortion that makes a
 * render read as "CG".
 */

export const CAMERA_PRESETS = {
  'three-quarter': {
    label: 'Three-Quarter Hero', group: 'Product',
    note: 'Slightly above and to the side. Shows two faces plus the top — the most informative single view.',
    config: { azimuth: 35, elevation: 12, focalLength: 85, framing: 0.85, roll: 0, projection: 'perspective' }
  },
  'three-quarter-low': {
    label: 'Three-Quarter Low (heroic)', group: 'Product',
    note: 'Camera below the object\'s midline so it towers. Makes small objects feel large and important.',
    config: { azimuth: 38, elevation: -8, focalLength: 50, framing: 0.88, target: { x: 0, y: 0.42, z: 0 } }
  },
  'front': {
    label: 'Front Elevation', group: 'Orthographic',
    note: 'Dead-on front. Symmetric and graphic. Use with orthographic for a true technical elevation.',
    config: { azimuth: 0, elevation: 0, focalLength: 135, framing: 0.9 }
  },
  'side': {
    label: 'Side Profile', group: 'Orthographic',
    note: 'Pure profile. The cleanest read of silhouette — good source for a matte or a logo lockup.',
    config: { azimuth: 90, elevation: 0, focalLength: 135, framing: 0.9 }
  },
  'back': {
    label: 'Rear', group: 'Orthographic',
    note: 'Straight back view.',
    config: { azimuth: 180, elevation: 0, focalLength: 135, framing: 0.9 }
  },
  'top-down': {
    label: 'Top-Down / Flatlay', group: 'Orthographic',
    note: 'Straight overhead. Pairs with the Flatlay lighting preset for knolling layouts.',
    config: { azimuth: 0, elevation: 89.9, focalLength: 60, framing: 0.9, target: { x: 0, y: 0.5, z: 0 } }
  },
  'iso-technical': {
    label: 'Isometric (technical)', group: 'Orthographic',
    note: 'True 45°/35.264° isometric in orthographic projection. Parallel edges, no perspective. Diagram-ready.',
    config: { azimuth: 45, elevation: 35.264, projection: 'orthographic', framing: 0.82, orthoZoom: 1 }
  },
  'iso-dimetric': {
    label: 'Dimetric (game/UI)', group: 'Orthographic',
    note: 'The 2:1 pixel-art / strategy-game angle. Reads as an icon.',
    config: { azimuth: 45, elevation: 26.565, projection: 'orthographic', framing: 0.85 }
  },
  'macro-detail': {
    label: 'Macro Detail', group: 'Detail',
    note: 'Very close, long lens, shallow depth of field. Shows material and craftsmanship rather than shape.',
    config: { azimuth: 28, elevation: 8, focalLength: 135, framing: 1.45, dof: { enabled: true, fStop: 2.0, maxBlur: 0.018, focusMode: 'subject' } }
  },
  'wide-environment': {
    label: 'Wide Establishing', group: 'Editorial',
    note: 'Short lens, object small in a big frame. Leaves negative space for type in a layout.',
    config: { azimuth: 30, elevation: 6, focalLength: 28, framing: 0.42 }
  },
  'dramatic-low': {
    label: 'Dramatic Low Angle', group: 'Editorial',
    note: 'Wide lens looking up. Aggressive perspective, strong verticals. Very editorial.',
    config: { azimuth: 25, elevation: -25, focalLength: 24, framing: 0.95, target: { x: 0, y: 0.35, z: 0 } }
  },
  'birds-eye': {
    label: "Bird's Eye", group: 'Editorial',
    note: 'High three-quarter looking down. Shows layout and footprint.',
    config: { azimuth: 40, elevation: 55, focalLength: 50, framing: 0.8 }
  },
  'dutch': {
    label: 'Dutch Tilt', group: 'Editorial',
    note: 'Rolled horizon. Instant dynamism — use sparingly and commit to the angle.',
    config: { azimuth: 30, elevation: 10, focalLength: 50, roll: -12, framing: 0.86 }
  },
  'tilt-shift': {
    label: 'Architectural (tilt-shift)', group: 'Editorial',
    note: 'Lens shifted up instead of tilting the camera, so vertical lines stay vertical. The architecture look.',
    config: { azimuth: 25, elevation: 0, focalLength: 35, shift: { x: 0, y: 0.25 }, framing: 0.8 }
  },
  'packshot': {
    label: 'E-commerce Packshot', group: 'Product',
    note: 'Slight elevation, long lens, generous margin. Meets most marketplace listing specs.',
    config: { azimuth: 20, elevation: 8, focalLength: 100, framing: 0.72 }
  },
  'closeup-corner': {
    label: 'Corner Close-up', group: 'Detail',
    note: 'Tight on an edge or corner. Abstracts the object into a graphic form.',
    config: { azimuth: 52, elevation: 22, focalLength: 85, framing: 1.7, dof: { enabled: true, fStop: 2.8 } }
  }
};

export function cameraPresetList() {
  return Object.entries(CAMERA_PRESETS).map(([key, p]) => ({ key, label: p.label, group: p.group, note: p.note }));
}

export function getCameraPreset(key) {
  const p = CAMERA_PRESETS[key];
  return p ? JSON.parse(JSON.stringify(p.config)) : {};
}

/** Standard multi-angle batches for turnaround sheets. */
export const ANGLE_SETS = {
  'four-view': { label: '4 views (F/R/B/L)', angles: [0, 90, 180, 270].map((a) => ({ azimuth: a, elevation: 0 })) },
  'six-view': { label: '6 views (orthographic box)', angles: [
    { azimuth: 0, elevation: 0 }, { azimuth: 90, elevation: 0 }, { azimuth: 180, elevation: 0 },
    { azimuth: 270, elevation: 0 }, { azimuth: 0, elevation: 89.9 }, { azimuth: 0, elevation: -89.9 }
  ] },
  'eight-turn': { label: '8-step turnaround', angles: Array.from({ length: 8 }, (_, i) => ({ azimuth: i * 45, elevation: 12 })) },
  'sixteen-turn': { label: '16-step turnaround', angles: Array.from({ length: 16 }, (_, i) => ({ azimuth: i * 22.5, elevation: 12 })) },
  'hero-set': { label: 'Hero set (5 art-directed)', angles: [
    { azimuth: 35, elevation: 12 }, { azimuth: -40, elevation: 18 }, { azimuth: 0, elevation: 0 },
    { azimuth: 45, elevation: 35.264 }, { azimuth: 25, elevation: -20 }
  ] }
};
