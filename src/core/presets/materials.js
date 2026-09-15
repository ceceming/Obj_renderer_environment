/**
 * Material treatments.
 *
 * 'original' respects the MTL/GLTF exactly. Everything else overrides it —
 * which is how you get a usable image out of a model whose materials are
 * missing, broken, or simply not designed for presentation.
 */

export const MATERIAL_PRESETS = {
  original: {
    label: 'Original (as authored)', group: 'Faithful',
    note: 'Uses the MTL / GLTF materials and textures as supplied. Multipliers below still apply.',
    config: {}
  },
  'original-pbr-lift': {
    label: 'Original + PBR Lift', group: 'Faithful',
    note: 'Keeps your textures but converts legacy Phong/Lambert to physically based shading. Fixes most dull OBJ imports.',
    config: { roughness: 0.85, metalness: 1.0, specularIntensity: 1.0, clearcoat: 0.0 }
  },
  clay: {
    label: 'Clay (form study)', group: 'Presentation',
    note: 'Uniform matte grey. Strips colour so you judge silhouette, proportion and lighting alone. The sculptor\'s view.',
    config: { overrideColor: '#c8c4bd', roughness: 0.92, metalness: 0.0, clearcoat: 0 }
  },
  'clay-white': {
    label: 'White Clay', group: 'Presentation',
    note: 'Gallery-white matte. Very clean against a white sweep; relies entirely on shadow for form.',
    config: { overrideColor: '#efeeec', roughness: 0.88, metalness: 0.0 }
  },
  'clay-dark': {
    label: 'Charcoal Clay', group: 'Presentation',
    note: 'Dark matte. Highlights read as bright edges — dramatic and expensive-looking.',
    config: { overrideColor: '#26262a', roughness: 0.78, metalness: 0.0 }
  },
  porcelain: {
    label: 'Porcelain', group: 'Presentation',
    note: 'White body under a glossy clear coat. Soft subsurface-ish falloff with a crisp specular.',
    config: { overrideColor: '#f6f4f1', roughness: 0.28, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.06, sheen: 0.25 }
  },
  'metal-polished': {
    label: 'Polished Metal', group: 'Material',
    note: 'Mirror-bright metal. Almost everything you see is a reflection of the lighting rig, so the rig *is* the look.',
    config: { metalness: 1.0, roughness: 0.04, metalnessOffset: 1.0, overrideColor: '#d8dade' }
  },
  'metal-brushed': {
    label: 'Brushed Metal', group: 'Material',
    note: 'Anisotropic metal — highlights stretch into streaks along the brush direction.',
    config: { metalness: 1.0, roughness: 0.32, metalnessOffset: 1.0, anisotropy: 0.85, anisotropyRotation: 0, overrideColor: '#b9bcc2' }
  },
  'metal-gold': {
    label: 'Gold', group: 'Material',
    note: 'Physically plausible gold (warm, fully metallic, slightly rough).',
    config: { metalness: 1.0, roughness: 0.18, metalnessOffset: 1.0, overrideColor: '#ffc65c' }
  },
  'metal-copper': {
    label: 'Copper', group: 'Material',
    note: 'Warm red metal with a little tooling roughness.',
    config: { metalness: 1.0, roughness: 0.25, metalnessOffset: 1.0, overrideColor: '#e08a5c' }
  },
  'metal-anodised': {
    label: 'Anodised Aluminium', group: 'Material',
    note: 'The consumer-electronics finish: satin, slightly soft, neutral.',
    config: { metalness: 1.0, roughness: 0.42, metalnessOffset: 1.0, overrideColor: '#9fa4ab' }
  },
  'plastic-glossy': {
    label: 'Glossy Plastic', group: 'Material',
    note: 'Injection-moulded look: coloured body, sharp clear-coat highlight.',
    config: { metalness: 0.0, roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.05 }
  },
  'plastic-matte': {
    label: 'Matte Plastic / Soft-touch', group: 'Material',
    note: 'Diffuse rubberised finish. Reads as premium and photographs without glare.',
    config: { metalness: 0.0, roughness: 0.82, clearcoat: 0.1, sheen: 0.15 }
  },
  glass: {
    label: 'Clear Glass', group: 'Material',
    note: 'Real refraction. Looks best in the path tracer — raster transmission is an approximation.',
    config: { transmission: 1.0, roughness: 0.02, metalness: 0.0, ior: 1.52, thickness: 0.6, overrideColor: '#ffffff', specularIntensity: 1.0 }
  },
  'glass-frosted': {
    label: 'Frosted Glass', group: 'Material',
    note: 'Scattering transmission. Softens whatever is behind it.',
    config: { transmission: 1.0, roughness: 0.42, metalness: 0.0, ior: 1.5, thickness: 0.8 }
  },
  'glass-tinted': {
    label: 'Tinted Glass', group: 'Material',
    note: 'Coloured absorption through thickness (Beer-Lambert), so thick parts go darker. Very convincing.',
    config: { transmission: 1.0, roughness: 0.05, ior: 1.5, thickness: 1.2, attenuationColor: '#7fd4c8', attenuationDistance: 0.6 }
  },
  ceramic: {
    label: 'Glazed Ceramic', group: 'Material',
    note: 'Thick uneven glaze over an opaque body.',
    config: { roughness: 0.15, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.12, specularIntensity: 1.0 }
  },
  fabric: {
    label: 'Fabric / Velvet', group: 'Material',
    note: 'Sheen gives the retroreflective rim that cloth has at grazing angles.',
    config: { roughness: 0.95, metalness: 0.0, sheen: 1.0, sheenRoughness: 0.35, sheenColor: '#ffffff' }
  },
  'carbon-fibre': {
    label: 'Carbon Fibre', group: 'Material',
    note: 'Dark anisotropic weave under clear coat.',
    config: { overrideColor: '#1c1e22', roughness: 0.28, metalness: 0.6, clearcoat: 1.0, clearcoatRoughness: 0.04, anisotropy: 0.6 }
  },
  iridescent: {
    label: 'Iridescent / Oil Slick', group: 'Stylised',
    note: 'Thin-film interference shifts hue with viewing angle. Spectacular on curved surfaces.',
    config: { iridescence: 1.0, iridescenceIOR: 1.35, iridescenceThickness: 480, roughness: 0.12, metalness: 0.9 }
  },
  'normal-map': {
    label: 'Normal Visualisation', group: 'Technical',
    note: 'Colours surfaces by their facing direction. Reads geometry and shading errors instantly.',
    config: { mode: 'normal' }
  },
  wireframe: {
    label: 'Wireframe', group: 'Technical',
    note: 'Topology only. Good as a graphic overlay or a technical inset.',
    config: { wireframe: true, overrideColor: '#1a1a1a' }
  },
  matcap: {
    label: 'Matcap (lighting-free)', group: 'Technical',
    note: 'Baked sphere shading. Completely independent of the lighting rig — instant readable form.',
    config: { mode: 'matcap' }
  },
  toon: {
    label: 'Toon / Cel', group: 'Stylised',
    note: 'Banded shading with an optional outline. Illustration rather than photography.',
    config: { mode: 'toon', outline: { enabled: true, color: '#111111', thickness: 1.6 } }
  },
  xray: {
    label: 'X-Ray / Ghost', group: 'Stylised',
    note: 'Additive fresnel transparency — edges glow, interiors show through. Diagrammatic and futuristic.',
    config: { mode: 'xray', overrideColor: '#6fd3ff' }
  },
  'matte-silhouette': {
    label: 'Flat Matte (silhouette)', group: 'Technical',
    note: 'Unlit flat fill — a perfect alpha/selection matte for compositing.',
    config: { mode: 'matte', overrideColor: '#000000' }
  }
};

export function materialPresetList() {
  return Object.entries(MATERIAL_PRESETS).map(([key, p]) => ({ key, label: p.label, group: p.group, note: p.note }));
}

export function getMaterialPreset(key) {
  const p = MATERIAL_PRESETS[key];
  return p ? JSON.parse(JSON.stringify(p.config)) : {};
}
