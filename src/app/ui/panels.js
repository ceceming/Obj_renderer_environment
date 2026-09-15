import { el, ControlBuilder, getPath } from './controls.js';
import { lightingPresetList, getLightingPreset } from '../../core/presets/lighting.js';
import { cameraPresetList, getCameraPreset, ANGLE_SETS } from '../../core/presets/cameras.js';
import { materialPresetList, getMaterialPreset } from '../../core/presets/materials.js';
import { lookPresetList, getLookPreset } from '../../core/presets/looks.js';
import { backdropPresetList, getBackdropPreset } from '../../core/presets/backdrops.js';
import { animationPresetList, EASINGS, frameCount } from '../../core/animation.js';
import { SENSORS, RESOLUTION_PRESETS, TONEMAPS, UP_AXES } from '../../core/schema.js';
import { OUTPUT_FORMATS } from '../../core/exporters.js';

const opts = (obj, labelKey = 'label') =>
  Object.entries(obj).map(([value, v]) => ({ value, label: typeof v === 'string' ? v : v[labelKey] }));

/**
 * Builds the whole control rail.
 * `app` supplies the actions that need more than a config patch — loading a
 * file, kicking off a render, exporting.
 */
export function buildPanels(rail, engine, app) {
  const builder = new ControlBuilder(() => engine.config, app.onChange);
  rail.textContent = '';
  const B = builder;

  // ═══ MODEL ════════════════════════════════════════════════════════════════
  const model = B.section('Model', { open: true });
  {
    const b = model.body;
    b.append(B.row(
      B.button('Open model…', () => app.pickFiles(), { variant: 'primary' }),
      B.button('Sample', () => app.loadSample(), { title: 'Load a test object' })
    ));
    b.append(el('div', { class: 'hint', text: 'Drop an .obj with its .mtl and textures anywhere on the viewport. GLTF/GLB, FBX, STL, PLY, DAE and 3MF also work.' }));

    app.statsEl = el('div', { class: 'stat-grid', style: 'margin:10px 0' });
    b.append(app.statsEl);
    app.warnEl = el('div', {});
    b.append(app.warnEl);

    b.append(B.select('model.upAxis', {
      label: 'Up axis',
      options: UP_AXES.map((v) => ({ value: v, label: v.toUpperCase().replace('-', ' ') })),
      hint: 'CAD and 3ds Max exports are usually Z-up. If your model lies on its side, change this first.'
    }));
    b.append(B.toggle('model.autoCenter', { label: 'Centre on origin' }));
    b.append(B.toggle('model.autoGround', { label: 'Sit on the ground plane', hint: 'Needed for a contact shadow to land where you expect.' }));
    b.append(B.toggle('model.autoScale', { label: 'Normalise size', hint: 'Fits the model to a unit box so one lighting rig works for a ring and for a building.' }));
    b.append(B.slider('model.scale', { label: 'Extra scale', min: 0.05, max: 5, step: 0.01, unit: '×' }));
    b.append(B.vector('model.rotation', { label: 'Rotation', min: -360, max: 360, step: 1, unit: '°' }));
    b.append(B.vector('model.position', { label: 'Offset', min: -5, max: 5, step: 0.01 }));
    b.append(B.select('model.smoothing', {
      label: 'Shading',
      options: [
        { value: 'auto', label: 'As authored' },
        { value: 'smooth', label: 'Force smooth' },
        { value: 'flat', label: 'Force flat / faceted' }
      ],
      hint: 'Force smooth fixes faceted-looking OBJs that shipped without normals.'
    }));
    b.append(B.toggle('model.doubleSided', { label: 'Double-sided', hint: 'Turn on if parts of the model look see-through or inside-out.' }));
  }
  rail.append(model);

  // ═══ CAMERA ═══════════════════════════════════════════════════════════════
  const camera = B.section('Camera', { open: true });
  {
    const b = camera.body;
    const picker = B.presets(cameraPresetList(), {
      current: engine.config.camera.preset,
      onPick: (key) => app.applyPreset('camera', key, getCameraPreset(key))
    });
    app.cameraPresetPicker = picker;
    b.append(picker);

    b.append(B.select('camera.projection', {
      label: 'Projection',
      options: [
        { value: 'perspective', label: 'Perspective' },
        { value: 'orthographic', label: 'Orthographic (no convergence)' }
      ],
      hint: 'Orthographic keeps parallel edges parallel — the look of a technical drawing or an isometric icon.'
    }));
    b.append(B.select('camera.sensor', { label: 'Sensor', options: opts(SENSORS) }));
    b.append(B.slider('camera.focalLength', {
      label: 'Focal length', min: 12, max: 300, step: 1, unit: 'mm',
      hint: 'Short lenses exaggerate depth; long lenses compress and flatter. Product work lives at 85–135mm.'
    }));
    b.append(B.slider('camera.azimuth', { label: 'Orbit', min: -180, max: 180, step: 0.5, unit: '°' }));
    b.append(B.slider('camera.elevation', { label: 'Height', min: -89, max: 89, step: 0.5, unit: '°' }));
    b.append(B.slider('camera.framing', {
      label: 'Fill frame', min: 0.2, max: 2, step: 0.01,
      hint: 'How much of the frame the subject occupies. Below 1 leaves margin for type.'
    }));
    b.append(B.slider('camera.target.y', {
      label: 'Aim height', min: 0, max: 1, step: 0.01,
      hint: '0 = base of the object, 1 = top. Raising it on a tall object stops the camera tipping down.'
    }));
    b.append(B.slider('camera.roll', { label: 'Roll (dutch)', min: -45, max: 45, step: 0.5, unit: '°' }));
    b.append(B.vector('camera.shift', {
      label: 'Lens shift', keys: ['x', 'y'], min: -1, max: 1, step: 0.01
    }));
    b.append(el('div', { class: 'hint', text: 'Lens shift moves the frame without tilting, so verticals stay vertical — the architectural photographer\'s trick.' }));

    const dof = B.section('Depth of field');
    dof.body.append(B.toggle('camera.dof.enabled', { label: 'Enable' }));
    dof.body.append(B.slider('camera.dof.fStop', {
      label: 'Aperture', min: 0.7, max: 22, step: 0.1, format: (v) => `f/${v.toFixed(1)}`,
      hint: 'Lower numbers blur more. The path tracer renders this as real optics; the raster preview approximates it.'
    }));
    dof.body.append(B.select('camera.dof.focusMode', {
      label: 'Focus on',
      options: [
        { value: 'subject', label: 'Subject centre' },
        { value: 'nearest', label: 'Nearest surface' },
        { value: 'manual', label: 'Manual distance' }
      ]
    }));
    dof.body.append(B.slider('camera.dof.focusDistance', { label: 'Focus distance', min: 0.1, max: 20, step: 0.01 }));
    dof.body.append(B.slider('camera.dof.bokehBlades', {
      label: 'Aperture blades', min: 0, max: 12, step: 1,
      hint: 'Shapes out-of-focus highlights. 0 = perfectly round, 6 = hexagonal like most lenses. Path tracer only.'
    }));
    b.append(dof);
  }
  rail.append(camera);

  // ═══ LIGHTING ═════════════════════════════════════════════════════════════
  const lighting = B.section('Lighting', { open: true });
  {
    const b = lighting.body;
    const picker = B.presets(lightingPresetList(), {
      current: engine.config.lighting.preset,
      onPick: (key) => app.applyPreset('lighting', key, getLightingPreset(key))
    });
    app.lightingPresetPicker = picker;
    b.append(picker);

    b.append(B.slider('lighting.intensity', {
      label: 'Overall level', min: 0, max: 4, step: 0.01, unit: '×',
      hint: 'Scales every source at once. Use exposure in the Look section to fine-tune brightness without changing the ratios.'
    }));
    b.append(B.slider('lighting.envIntensity', { label: 'Environment level', min: 0, max: 4, step: 0.01, unit: '×' }));
    b.append(B.slider('lighting.envRotation', {
      label: 'Rotate rig', min: -180, max: 180, step: 1, unit: '°',
      hint: 'Spins the whole environment. The fastest way to move every highlight at once.'
    }));
    b.append(B.slider('lighting.keyToFill', {
      label: 'Key-to-fill ratio', min: 1, max: 24, step: 0.1, format: (v) => `${v.toFixed(1)}:1`,
      hint: 'Contrast of the rig. 2:1 is soft and commercial; 8:1 and above is dramatic.'
    }));
    b.append(B.slider('lighting.rimStrength', { label: 'Rim / edge light', min: 0, max: 3, step: 0.01, unit: '×' }));
    b.append(B.slider('lighting.bounceStrength', { label: 'Ambient bounce', min: 0, max: 2, step: 0.01, unit: '×' }));
    b.append(B.color('lighting.bounceColor', { label: 'Bounce colour', hint: 'The colour of the imaginary room. Warm bounce reads as interior, cool as open shade.' }));
    b.append(B.slider('lighting.directBalance', {
      label: 'Direct / ambient split', min: 0, max: 1, step: 0.01,
      hint: 'How much light comes from crisp shadow-casting sources versus the soft environment. Higher = harder shadows.'
    }));

    // ── individual lights ──
    const rig = B.section('Light rig');
    app.lightListEl = el('div', {});
    rig.body.append(app.lightListEl);
    rig.body.append(B.row(
      B.button('Add softbox', () => app.addLight('rect'), { variant: 'sm' }),
      B.button('Add strip', () => app.addLight('strip'), { variant: 'sm' }),
      B.button('Add disc', () => app.addLight('disc'), { variant: 'sm' })
    ));
    app.lightEditorEl = el('div', {});
    rig.body.append(app.lightEditorEl);
    b.append(rig);

    // ── sun / sky ──
    const sky = B.section('Sun & sky');
    sky.body.append(B.select('lighting.environment.sky.mode', {
      label: 'Sky model',
      options: [
        { value: 'studio', label: 'Studio (enclosed)' },
        { value: 'daylight', label: 'Clear daylight' },
        { value: 'overcast', label: 'Overcast' },
        { value: 'sunset', label: 'Sunset / sunrise' },
        { value: 'night', label: 'Night' }
      ]
    }));
    sky.body.append(B.toggle('lighting.environment.sky.sunEnabled', { label: 'Sun' }));
    sky.body.append(B.slider('lighting.environment.sky.sunAzimuth', { label: 'Sun direction', min: -180, max: 180, step: 1, unit: '°' }));
    sky.body.append(B.slider('lighting.environment.sky.sunElevation', { label: 'Sun height', min: -15, max: 90, step: 0.5, unit: '°' }));
    sky.body.append(B.slider('lighting.environment.sky.sunAngularSize', {
      label: 'Sun size', min: 0.1, max: 20, step: 0.1, unit: '°',
      hint: 'The real sun is 0.53°, which is why its shadows are crisp. Larger values soften the shadow edge.'
    }));
    sky.body.append(B.slider('lighting.environment.sky.sunIntensity', { label: 'Sun strength', min: 0, max: 30, step: 0.1 }));
    sky.body.append(B.color('lighting.environment.sky.sunColor', { label: 'Sun colour' }));
    sky.body.append(B.slider('lighting.environment.sky.turbidity', {
      label: 'Haze', min: 1, max: 12, step: 0.1,
      hint: 'Atmospheric thickness. Higher spreads a broad glow around the sun and lifts the horizon.'
    }));
    sky.body.append(B.color('lighting.environment.sky.zenith', { label: 'Sky top' }));
    sky.body.append(B.color('lighting.environment.sky.horizon', { label: 'Horizon' }));
    sky.body.append(B.color('lighting.environment.sky.ground', { label: 'Ground' }));
    b.append(sky);

    // ── HDRI ──
    const hdri = B.section('Custom HDRI');
    hdri.body.append(el('div', { class: 'hint', text: 'Prefer your own environment map? Load a .hdr or .exr and it replaces the procedural rig. Everything else — camera, grade, output — works the same.' }));
    hdri.body.append(B.row(
      B.button('Load .hdr / .exr…', () => app.pickHDRI()),
      B.button('Back to procedural', () => app.clearHDRI(), { variant: 'ghost' })
    ));
    hdri.body.append(B.slider('lighting.environment.hdriExposure', { label: 'HDRI exposure', min: 0, max: 5, step: 0.01, unit: '×' }));
    b.append(hdri);

    // ── shadows ──
    const shadows = B.section('Shadows', { open: true });
    shadows.body.append(B.select('lighting.shadows.type', {
      label: 'Type',
      options: [
        { value: 'soft', label: 'Soft (area sources)' },
        { value: 'hard', label: 'Hard (point sources)' },
        { value: 'contact', label: 'Contact only' },
        { value: 'none', label: 'None' }
      ],
      hint: 'Shadow softness follows source size, exactly as in reality: a big close softbox is soft, a small distant light is crisp.'
    }));
    shadows.body.append(B.slider('lighting.shadows.softness', { label: 'Softness', min: 0, max: 4, step: 0.01, unit: '×' }));
    shadows.body.append(B.slider('lighting.shadows.opacity', { label: 'Darkness', min: 0, max: 1, step: 0.01 }));
    shadows.body.append(B.select('lighting.shadows.resolution', {
      label: 'Shadow map',
      options: [512, 1024, 2048, 4096].map((v) => ({ value: v, label: `${v} px` }))
    }));
    shadows.body.append(B.toggle('lighting.shadows.contactShadow.enabled', {
      label: 'Contact shadow',
      hint: 'The dark pool right under the object. This is what stops a render looking like it floats — and it survives into the alpha channel.'
    }));
    shadows.body.append(B.slider('lighting.shadows.contactShadow.darkness', { label: 'Contact darkness', min: 0, max: 3, step: 0.01 }));
    shadows.body.append(B.slider('lighting.shadows.contactShadow.blur', { label: 'Contact blur', min: 0, max: 8, step: 0.05 }));
    shadows.body.append(B.slider('lighting.shadows.contactShadow.height', { label: 'Contact falloff', min: 0.05, max: 2, step: 0.01 }));
    shadows.body.append(B.toggle('lighting.shadows.catcher', { label: 'Shadow catcher plane', hint: 'An invisible floor that receives cast shadows. Keep on for transparent output.' }));
    b.append(shadows);
  }
  rail.append(lighting);

  // ═══ MATERIAL ═════════════════════════════════════════════════════════════
  const material = B.section('Material');
  {
    const b = material.body;
    const picker = B.presets(materialPresetList(), {
      current: engine.config.material.mode,
      onPick: (key) => app.applyPreset('material', key, { mode: key })
    });
    app.materialPresetPicker = picker;
    b.append(picker);

    b.append(B.slider('material.roughness', { label: 'Roughness', min: 0, max: 2, step: 0.01, unit: '×', hint: 'Below 0.2 reflects the lighting rig sharply; above 0.7 scatters it into a soft sheen.' }));
    b.append(B.slider('material.metalness', { label: 'Metalness', min: 0, max: 2, step: 0.01, unit: '×' }));
    b.append(B.slider('material.roughnessOffset', { label: 'Roughness offset', min: -1, max: 1, step: 0.01 }));
    b.append(B.color('material.overrideColor', { label: 'Override colour', allowNull: true, hint: 'Replaces the base colour entirely. Clear to return to the authored textures.' }));
    b.append(B.color('material.tint', { label: 'Tint', allowNull: true, hint: 'Multiplies the existing colour — keeps texture detail while shifting hue.' }));
    b.append(B.slider('material.clearcoat', { label: 'Clear coat', min: 0, max: 1, step: 0.01, hint: 'A second glossy layer over the surface: car paint, lacquer, glazed ceramic.' }));
    b.append(B.slider('material.clearcoatRoughness', { label: 'Coat roughness', min: 0, max: 1, step: 0.01 }));
    b.append(B.slider('material.sheen', { label: 'Sheen', min: 0, max: 1, step: 0.01, hint: 'The soft rim cloth and velvet show at grazing angles.' }));
    b.append(B.slider('material.transmission', { label: 'Transmission', min: 0, max: 1, step: 0.01, hint: 'Light passing through the body — glass, resin, liquid. Most convincing in the path tracer.' }));
    b.append(B.slider('material.ior', { label: 'Index of refraction', min: 1, max: 2.5, step: 0.01, hint: 'Water 1.33, glass 1.52, sapphire 1.77, diamond 2.42.' }));
    b.append(B.slider('material.thickness', { label: 'Thickness', min: 0, max: 5, step: 0.01 }));
    b.append(B.slider('material.iridescence', { label: 'Iridescence', min: 0, max: 1, step: 0.01, hint: 'Thin-film interference: oil slicks, soap bubbles, anodised titanium.' }));
    b.append(B.slider('material.anisotropy', { label: 'Anisotropy', min: 0, max: 1, step: 0.01, hint: 'Stretches highlights along one direction — brushed metal, satin, hair.' }));
    b.append(B.slider('material.normalScale', { label: 'Normal map strength', min: 0, max: 4, step: 0.01, unit: '×' }));
    b.append(B.slider('material.emissiveIntensity', { label: 'Emission', min: 0, max: 10, step: 0.01, unit: '×' }));
    b.append(B.slider('material.uvScale', { label: 'Texture tiling', min: 0.1, max: 10, step: 0.1, unit: '×' }));
    b.append(B.toggle('material.wireframe', { label: 'Wireframe' }));
  }
  rail.append(material);

  // ═══ BACKGROUND ═══════════════════════════════════════════════════════════
  const background = B.section('Background');
  {
    const b = background.body;
    const picker = B.presets(backdropPresetList(), {
      current: null,
      onPick: (key) => app.applyPreset('background', key, getBackdropPreset(key))
    });
    app.backdropPresetPicker = picker;
    b.append(picker);

    b.append(B.color('background.color', { label: 'Solid colour' }));
    b.append(B.color('background.gradient.top', { label: 'Gradient top' }));
    b.append(B.color('background.gradient.bottom', { label: 'Gradient bottom' }));
    b.append(B.slider('background.gradient.angle', { label: 'Gradient angle', min: 0, max: 360, step: 1, unit: '°' }));
    b.append(B.slider('background.envBlur', { label: 'Environment blur', min: 0, max: 1, step: 0.01, hint: 'Only applies when the background shows the environment.' }));
    b.append(B.color('background.cyc.color', { label: 'Cyclorama colour' }));
    b.append(B.toggle('background.floor.enabled', { label: 'Reflective floor', hint: 'Adds a plinth with a real planar reflection that fades with distance.' }));
    b.append(B.slider('background.floor.roughness', { label: 'Floor roughness', min: 0, max: 1, step: 0.01 }));
    b.append(B.slider('background.floor.reflectivity', { label: 'Reflection strength', min: 0, max: 1, step: 0.01 }));
    b.append(B.color('background.floor.color', { label: 'Floor colour' }));
  }
  rail.append(background);

  // ═══ LOOK ═════════════════════════════════════════════════════════════════
  const look = B.section('Look & grade');
  {
    const b = look.body;
    const picker = B.presets(lookPresetList(), {
      current: engine.config.look.preset,
      onPick: (key) => app.applyPreset('look', key, getLookPreset(key))
    });
    app.lookPresetPicker = picker;
    b.append(picker);

    b.append(B.select('look.tonemap', {
      label: 'Tone mapping',
      options: Object.entries(TONEMAPS).map(([value, v]) => ({ value, label: v.label })),
      hint: 'How the renderer squeezes high dynamic range into a displayable image. AgX handles bright highlights most gracefully.'
    }));
    b.append(B.slider('look.exposure', { label: 'Exposure', min: 0, max: 4, step: 0.01, unit: '×' }));
    b.append(B.slider('look.contrast', { label: 'Contrast', min: 0.3, max: 2.5, step: 0.01, unit: '×' }));
    b.append(B.slider('look.saturation', { label: 'Saturation', min: 0, max: 2.5, step: 0.01, unit: '×' }));
    b.append(B.slider('look.temperatureShift', { label: 'Warmth', min: -100, max: 100, step: 1 }));
    b.append(B.slider('look.tintShift', { label: 'Tint (green ↔ magenta)', min: -100, max: 100, step: 1 }));
    b.append(B.color('look.lift', { label: 'Lift (shadows)' }));
    b.append(B.color('look.gamma', { label: 'Gamma (midtones)' }));
    b.append(B.color('look.gain', { label: 'Gain (highlights)' }));

    const fx = B.section('Effects');
    fx.body.append(B.toggle('look.ao.enabled', { label: 'Ambient occlusion', hint: 'Darkens creases and contact points. Adds a great deal of perceived depth for very little cost.' }));
    fx.body.append(B.slider('look.ao.intensity', { label: 'AO strength', min: 0, max: 2, step: 0.01 }));
    fx.body.append(B.slider('look.ao.radius', { label: 'AO radius', min: 0.02, max: 2, step: 0.01 }));
    fx.body.append(B.toggle('look.bloom.enabled', { label: 'Bloom' }));
    fx.body.append(B.slider('look.bloom.intensity', { label: 'Bloom strength', min: 0, max: 2, step: 0.01 }));
    fx.body.append(B.slider('look.bloom.threshold', {
      label: 'Bloom threshold', min: 0.2, max: 4, step: 0.01,
      hint: 'In linear light, where 1.0 is a white surface at correct exposure. Below 1.0 a white backdrop starts to glow and wash out the subject.'
    }));
    fx.body.append(B.toggle('look.halation.enabled', { label: 'Halation', hint: 'The warm bleed film shows around bright areas. Subtler and more organic than bloom.' }));
    fx.body.append(B.slider('look.halation.amount', { label: 'Halation', min: 0, max: 1, step: 0.01 }));
    fx.body.append(B.toggle('look.vignette.enabled', { label: 'Vignette' }));
    fx.body.append(B.slider('look.vignette.amount', { label: 'Vignette amount', min: 0, max: 1, step: 0.01 }));
    fx.body.append(B.toggle('look.grain.enabled', { label: 'Film grain' }));
    fx.body.append(B.slider('look.grain.amount', { label: 'Grain', min: 0, max: 0.2, step: 0.001 }));
    fx.body.append(B.slider('look.grain.size', { label: 'Grain size', min: 0.3, max: 4, step: 0.05 }));
    fx.body.append(B.toggle('look.chromaticAberration.enabled', { label: 'Chromatic aberration' }));
    fx.body.append(B.slider('look.chromaticAberration.amount', { label: 'CA amount', min: 0, max: 0.01, step: 0.0001, format: (v) => v.toFixed(4) }));
    fx.body.append(B.toggle('look.sharpen.enabled', { label: 'Sharpen' }));
    fx.body.append(B.slider('look.sharpen.amount', { label: 'Sharpen amount', min: 0, max: 1, step: 0.01 }));
    b.append(fx);
  }
  rail.append(look);

  // ═══ RENDER ═══════════════════════════════════════════════════════════════
  const render = B.section('Render quality');
  {
    const b = render.body;
    b.append(B.select('render.engine', {
      label: 'Engine',
      options: [
        { value: 'raster', label: 'Real-time (instant)' },
        { value: 'pathtrace', label: 'Path traced (photoreal)' }
      ],
      hint: 'Art-direct in real time, then switch to path tracing for the frame you deliver. It adds true light bounces, real refraction and optical bokeh.'
    }));
    b.append(B.select('render.antialias', {
      label: 'Anti-aliasing',
      options: [
        { value: 'smaa', label: 'SMAA (fast, good)' },
        { value: 'msaa', label: 'MSAA 4× (geometry edges)' },
        { value: 'ssaa2', label: 'Supersample 2× (slow, best)' },
        { value: 'ssaa4', label: 'Supersample 4× (very slow)' },
        { value: 'taa', label: 'Temporal' },
        { value: 'none', label: 'None' }
      ]
    }));
    b.append(B.slider('render.pathtrace.samples', {
      label: 'Path trace samples', min: 8, max: 4096, step: 8,
      hint: 'More samples = less noise. 64 previews, 256 is usually clean, 1000+ for glass and caustics.'
    }));
    b.append(B.slider('render.pathtrace.bounces', { label: 'Light bounces', min: 1, max: 20, step: 1, hint: 'How many times light reflects before it is dropped. 4–6 suits most products; raise it for interiors and glass.' }));
    b.append(B.slider('render.pathtrace.transmissiveBounces', { label: 'Transmissive bounces', min: 1, max: 20, step: 1 }));
    b.append(B.slider('render.pathtrace.filterGlossy', { label: 'Glossy filter', min: 0, max: 1, step: 0.01, hint: 'Softens fireflies on sharp reflections. A little goes a long way.' }));
    b.append(B.toggle('render.accumulate.enabled', { label: 'Progressive accumulation (raster)', hint: 'Averages many jittered frames for very clean edges without paying for a path trace.' }));
    b.append(B.slider('render.accumulate.frames', { label: 'Accumulation frames', min: 4, max: 512, step: 4 }));
  }
  rail.append(render);

  // ═══ ANIMATION ════════════════════════════════════════════════════════════
  const animation = B.section('Animation');
  {
    const b = animation.body;
    b.append(B.toggle('animation.enabled', { label: 'Animate' }));
    b.append(B.presets(animationPresetList(), {
      current: engine.config.animation.type,
      onPick: (key) => app.onChange({ animation: { type: key, enabled: true } }, { commit: true, structural: true })
    }));
    b.append(B.slider('animation.duration', { label: 'Duration', min: 0.5, max: 60, step: 0.1, unit: 's' }));
    b.append(B.select('animation.fps', {
      label: 'Frame rate',
      options: [12, 24, 25, 30, 50, 60].map((v) => ({ value: v, label: `${v} fps` }))
    }));
    b.append(B.select('animation.easing', {
      label: 'Easing',
      options: Object.keys(EASINGS).map((v) => ({ value: v, label: v.replace(/-/g, ' ') })),
      hint: 'Linear keeps a turntable perfectly even. Ease in-out makes a camera move feel deliberate.'
    }));
    b.append(B.toggle('animation.pingPong', { label: 'Ping-pong', hint: 'Plays forward then backward, so any move loops seamlessly.' }));
    b.append(B.slider('animation.turntable.revolutions', { label: 'Revolutions', min: 0.1, max: 5, step: 0.1 }));
    b.append(B.select('animation.turntable.direction', {
      label: 'Direction', options: [{ value: 1, label: 'Clockwise' }, { value: -1, label: 'Anticlockwise' }]
    }));
    b.append(B.toggle('animation.turntable.spinObject', {
      label: 'Spin object (not camera)',
      hint: 'Spinning the object keeps the lighting fixed in the world, so highlights sweep across the surface like a real turntable.'
    }));
    app.frameCountEl = el('div', { class: 'hint' });
    b.append(app.frameCountEl);
    b.append(B.row(
      B.button('Preview loop', () => app.togglePreview(), { variant: 'primary' }),
      B.button('Scrub to start', () => app.scrubTo(0))
    ));
  }
  rail.append(animation);

  // ═══ OUTPUT ═══════════════════════════════════════════════════════════════
  const output = B.section('Output', { open: true });
  {
    const b = output.body;
    b.append(B.select('render.resolutionPreset', {
      label: 'Resolution',
      options: opts(RESOLUTION_PRESETS),
      hint: 'Changing this re-frames the shot for the new aspect ratio automatically.'
    }));
    b.append(el('div', { class: 'grid-2' }, [
      B.slider('render.width', { label: 'Width', min: 64, max: 8192, step: 1, unit: 'px', format: (v) => String(Math.round(v)) }),
      B.slider('render.height', { label: 'Height', min: 64, max: 8192, step: 1, unit: 'px', format: (v) => String(Math.round(v)) })
    ]));
    b.append(B.select('output.format', {
      label: 'Format',
      options: Object.entries(OUTPUT_FORMATS).map(([value, v]) => ({ value, label: v.label, group: v.group })),
      hint: 'PNG keeps transparency. EXR keeps the full dynamic range for grading. The HTML export is an interactive page you can send to a client.'
    }));
    b.append(B.select('output.backgroundMode', {
      label: 'Background on export',
      options: [
        { value: 'as-configured', label: 'As configured' },
        { value: 'transparent', label: 'Transparent (alpha)' },
        { value: 'white', label: 'Force white' },
        { value: 'black', label: 'Force black' },
        { value: 'custom', label: 'Custom colour' }
      ],
      hint: 'Overrides the backdrop at export time, so one look can ship as both a cut-out and a packshot.'
    }));
    b.append(B.color('output.customBackground', { label: 'Custom background' }));
    b.append(B.toggle('output.alphaShadow', {
      label: 'Keep shadow in alpha',
      hint: 'Writes the contact and cast shadows into the alpha channel so the cut-out still grounds itself over any colour in Photoshop.'
    }));
    b.append(B.slider('output.alphaShadowStrength', { label: 'Alpha shadow strength', min: 0, max: 2, step: 0.01 }));
    b.append(B.toggle('output.trim', { label: 'Trim transparent edges', hint: 'Crops empty margins — handy when packing cut-outs into a layout.' }));
    b.append(B.text('output.namePattern', {
      label: 'Filename pattern',
      hint: 'Tokens: {name} {preset} {camera} {look} {material} {w} {h}'
    }));
    b.append(B.text('output.frameNamePattern', { label: 'Frame pattern', hint: 'Use {frame:04} for zero-padded numbering.' }));

    b.append(el('div', { style: 'height:6px' }));
    b.append(B.row(
      B.button('Render & save', () => app.exportNow(), { variant: 'primary' }),
      B.button('Quick PNG', () => app.quickPNG(), { title: 'Save the viewport as it is' })
    ));

    const batch = B.section('Batch & turnaround');
    batch.body.append(el('div', { class: 'hint', text: 'Render a whole set of angles in one go — a turnaround sheet for a deck, or every view a marketplace listing needs.' }));
    const angleSel = el('select', {});
    for (const [key, set] of Object.entries(ANGLE_SETS)) {
      angleSel.append(el('option', { value: key, text: set.label }));
    }
    batch.body.append(el('div', { class: 'ctrl' }, [el('label', {}, [el('span', { text: 'Angle set' })]), angleSel]));
    batch.body.append(B.button('Render angle set → ZIP', () => app.exportAngleSet(angleSel.value), { variant: 'primary' }));
    b.append(batch);

    const share = B.section('Share & handoff');
    share.body.append(B.button('Interactive HTML (single file)', () => app.exportHTML(), {}));
    share.body.append(el('div', { class: 'hint', text: 'One file with the model inside it. Opens straight from the desktop, no server needed.' }));
    share.body.append(el('div', { style: 'height:8px' }));
    share.body.append(B.button('three.js project (ZIP)', () => app.exportProject(), {}));
    share.body.append(el('div', { class: 'hint', text: 'index.html + a commented viewer.js + model.glb + config.json, ready to fold into a site.' }));
    share.body.append(el('div', { style: 'height:8px' }));
    share.body.append(B.row(
      B.button('Save .render.json', () => app.exportConfigFile()),
      B.button('Load…', () => app.importConfigFile())
    ));
    share.body.append(el('div', { class: 'hint', text: 'The config is the whole recipe in a few kilobytes. Keep it beside the model to reproduce this exact image later.' }));
    share.body.append(el('div', { style: 'height:8px' }));
    share.body.append(B.button('Export GLB', () => app.exportGLBFile(), {}));
    b.append(share);
  }
  rail.append(output);

  app.builder = builder;
  return builder;
}

/** Renders the editable list of lights. Rebuilt whenever the rig changes. */
export function renderLightList(app, engine) {
  const listEl = app.lightListEl;
  const editorEl = app.lightEditorEl;
  if (!listEl) return;
  listEl.textContent = '';
  editorEl.textContent = '';

  const lights = engine.config.lighting.environment.lights || [];
  if (!lights.length) {
    listEl.append(el('div', { class: 'hint', text: 'This rig has no area lights — it is lit by the sky and sun alone.' }));
  }

  lights.forEach((light, index) => {
    const row = el('div', { class: `light-row${app.selectedLight === light.id ? ' selected' : ''}` });
    row.append(el('span', { class: 'swatch', style: `background:${light.color || '#ffffff'}` }));
    row.append(el('div', {}, [
      el('div', { class: 'name', text: light.name || light.role }),
      el('div', { class: 'role', text: `${light.role} · ${Math.round(light.intensity * 10) / 10}×` })
    ]));
    const vis = el('button', { text: light.enabled === false ? '○' : '●', title: 'Solo / mute this light' });
    vis.addEventListener('click', (e) => {
      e.stopPropagation();
      app.updateLight(index, { enabled: light.enabled === false });
    });
    const del = el('button', { text: '×', title: 'Remove' });
    del.addEventListener('click', (e) => { e.stopPropagation(); app.removeLight(index); });
    row.append(vis, del);
    row.addEventListener('click', () => {
      app.selectedLight = app.selectedLight === light.id ? null : light.id;
      renderLightList(app, engine);
    });
    listEl.append(row);

    if (app.selectedLight === light.id) {
      editorEl.append(buildLightEditor(app, engine, light, index));
    }
  });
}

function buildLightEditor(app, engine, light, index) {
  const wrap = el('div', { style: 'padding:9px;margin:6px 0 10px;border:1px solid var(--line);border-radius:7px;background:var(--panel-2)' });
  const set = (patch) => app.updateLight(index, patch);

  const sliderRow = (label, key, min, max, step, unit = '', hint = null) => {
    const out = el('span', { class: 'value', text: `${Number(light[key] ?? 0).toFixed(step >= 1 ? 0 : 2)}${unit}` });
    const input = el('input', { type: 'range', min, max, step, value: light[key] ?? 0 });
    input.addEventListener('input', () => {
      out.textContent = `${Number(input.value).toFixed(step >= 1 ? 0 : 2)}${unit}`;
      set({ [key]: Number(input.value) });
    });
    return el('div', { class: 'ctrl' }, [
      el('label', {}, [el('span', { text: label }), out]), input,
      hint ? el('div', { class: 'hint', text: hint }) : null
    ]);
  };

  const name = el('input', { type: 'text', value: light.name || '' });
  name.addEventListener('change', () => set({ name: name.value }));
  wrap.append(el('div', { class: 'ctrl' }, [el('label', {}, [el('span', { text: 'Name' })]), name]));

  wrap.append(sliderRow('Intensity', 'intensity', 0, 20, 0.1, '×'));
  wrap.append(sliderRow('Direction', 'azimuth', -180, 180, 1, '°'));
  wrap.append(sliderRow('Height', 'elevation', -89, 89, 1, '°'));
  wrap.append(sliderRow('Distance', 'distance', 0.6, 12, 0.05, '', 'Closer sources are softer and fall off faster across the subject.'));
  wrap.append(sliderRow('Width', 'width', 0.05, 12, 0.05));
  wrap.append(sliderRow('Height (size)', 'height', 0.05, 12, 0.05, '', 'Size relative to the subject is what controls shadow softness.'));
  wrap.append(sliderRow('Diffusion', 'spread', 0, 1, 0.01, '', '0 gives a hard-edged source, 1 feathers it like heavy diffusion cloth.'));
  wrap.append(sliderRow('Temperature', 'temperature', 1800, 12000, 50, 'K'));

  const color = el('input', { type: 'color', value: light.color || '#ffffff' });
  color.addEventListener('input', () => set({ color: color.value }));
  wrap.append(el('div', { class: 'ctrl' }, [el('label', {}, [el('span', { text: 'Gel colour' })]), color]));

  const shapeSel = el('select', {});
  for (const s of ['rect', 'strip', 'disc', 'ring']) {
    shapeSel.append(el('option', { value: s, text: s, selected: light.shape === s ? '' : null }));
  }
  shapeSel.value = light.shape || 'rect';
  shapeSel.addEventListener('change', () => set({ shape: shapeSel.value }));
  wrap.append(el('div', { class: 'ctrl' }, [
    el('label', {}, [el('span', { text: 'Shape' })]), shapeSel,
    el('div', { class: 'hint', text: 'The shape you choose is the shape of the highlight on a glossy surface. Strips draw long highlight lines along curves.' })
  ]));

  const shadow = el('input', { type: 'checkbox' });
  shadow.checked = Boolean(light.castShadow);
  shadow.addEventListener('change', () => set({ castShadow: shadow.checked }));
  wrap.append(el('div', { class: 'ctrl' }, [
    el('label', { class: 'switch' }, [shadow, el('span', { class: 'track' }), el('span', { text: 'Casts shadow' })])
  ]));

  return wrap;
}

export { frameCount };
