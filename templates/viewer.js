/**
 * Portable viewer
 * ---------------
 * A self-contained three.js scene exported from OBJ Render Studio.
 *
 * It reproduces the look you approved in the studio: the same procedural
 * environment built from your light rig, the same camera framing, the same
 * tone mapping and grade. It is deliberately dependency-light and readable so
 * you can drop it into a site and keep editing it by hand.
 *
 * Files next to this one:
 *   model.glb      your model with its materials baked in
 *   config.json    the render recipe (also inlined below as CONFIG)
 *
 * Edit CONFIG and the page updates — every value maps to a control in the studio.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEG = Math.PI / 180;

// ── helpers ─────────────────────────────────────────────────────────────────

function placeOnSphere(target, azimuthDeg, elevationDeg, distance) {
  const az = azimuthDeg * DEG, el = elevationDeg * DEG;
  return target.set(
    distance * Math.cos(el) * Math.sin(az),
    distance * Math.sin(el),
    distance * Math.cos(el) * Math.cos(az)
  );
}

function kelvinToRGB(kelvin) {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v) => Math.min(1, Math.max(0, v / 255));
  return { r: c(r), g: c(g), b: c(b) };
}

function lightColor(light) {
  const base = new THREE.Color(light.color || '#ffffff');
  const k = kelvinToRGB(light.temperature ?? 6500);
  const ref = kelvinToRGB(6500);
  return new THREE.Color(base.r * k.r / ref.r, base.g * k.g / ref.g, base.b * k.b / ref.b);
}

const TONEMAPS = {
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  linear: THREE.LinearToneMapping
};

// ── the environment: a gradient sky plus one emissive plane per softbox ─────

const SKY_VERT = `
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SKY_FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uGround, uSunColor, uSunDir;
uniform float uSunIntensity, uSunSize, uSunEnabled, uTurbidity, uGradientPower;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col;
  if (h >= 0.0) {
    col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), uGradientPower));
    float haze = exp(-h * (12.0 / max(uTurbidity, 0.3)));
    col = mix(col, uHorizon * 1.15, haze * 0.35);
  } else {
    col = mix(uHorizon, uGround, pow(clamp(-h, 0.0, 1.0), 0.55));
  }
  if (uSunEnabled > 0.5) {
    float cosAngle = dot(d, normalize(uSunDir));
    float sunCos = cos(radians(uSunSize));
    float disc = smoothstep(sunCos - 0.0006, sunCos + 0.0012, cosAngle);
    float glow = pow(max(cosAngle, 0.0), 220.0 / max(uTurbidity, 0.5)) * 0.55
               + pow(max(cosAngle, 0.0), 8.0) * 0.05 * uTurbidity;
    col += uSunColor * (disc * uSunIntensity + glow * uSunIntensity * 0.18);
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

function buildEnvironment(renderer, cfg, subjectSize) {
  const L = cfg.lighting;
  const sky = L.environment.sky || {};
  const scene = new THREE.Scene();

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    uniforms: {
      uZenith: { value: new THREE.Color(sky.zenith || '#dfe7f2').convertSRGBToLinear() },
      uHorizon: { value: new THREE.Color(sky.horizon || '#ffffff').convertSRGBToLinear() },
      uGround: { value: new THREE.Color(sky.ground || '#8a8a8a').convertSRGBToLinear() },
      uSunColor: { value: new THREE.Color(sky.sunColor || '#fff4e0').convertSRGBToLinear() },
      uSunDir: { value: placeOnSphere(new THREE.Vector3(), sky.sunAzimuth ?? 130, sky.sunElevation ?? 35, 1) },
      uSunIntensity: { value: (sky.sunIntensity ?? 6) * (L.intensity ?? 1) },
      uSunSize: { value: Math.max(0.05, sky.sunAngularSize ?? 2) },
      uSunEnabled: { value: sky.sunEnabled ? 1 : 0 },
      uTurbidity: { value: sky.turbidity ?? 2.5 },
      uGradientPower: { value: sky.mode === 'overcast' ? 1.6 : sky.mode === 'studio' ? 0.9 : 0.55 }
    }
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 32), skyMat));

  for (const light of L.environment.lights || []) {
    if (light.enabled === false) continue;
    const w = (light.width ?? 2) * subjectSize;
    const h = (light.height ?? 2) * subjectSize;
    const geo = light.shape === 'disc' || light.shape === 'ring'
      ? new THREE.CircleGeometry(Math.max(w, h) / 2, 64)
      : new THREE.PlaneGeometry(w, h);
    const color = lightColor(light).convertSRGBToLinear()
      .multiplyScalar((light.intensity ?? 1) * (L.intensity ?? 1));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true
    }));
    placeOnSphere(mesh.position, light.azimuth, light.elevation, (light.distance ?? 3) * subjectSize);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  }

  const cubeTarget = new THREE.WebGLCubeRenderTarget(512, {
    type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter
  });
  const cubeCam = new THREE.CubeCamera(0.1, 1000, cubeTarget);
  cubeCam.position.set(0, subjectSize * 0.5, 0);

  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  cubeCam.update(renderer, scene);
  renderer.toneMapping = prevTone;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromCubemap(cubeTarget.texture).texture;
  pmrem.dispose();

  return { envMap, backgroundCube: cubeTarget.texture };
}

// ── main ────────────────────────────────────────────────────────────────────

export async function createViewer({ container, config, modelUrl }) {
  const cfg = config;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONEMAPS[cfg.look.tonemap] ?? THREE.AgXToneMapping;
  renderer.toneMappingExposure = cfg.look.exposure ?? 1;
  renderer.shadowMap.enabled = cfg.lighting.shadows.enabled;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });

  const scene = new THREE.Scene();

  // Model
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const model = gltf.scene;
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const subjectSize = Math.max(size.x, size.y, size.z) || 1;
  const center = box.getCenter(new THREE.Vector3());

  // Environment
  const { envMap, backgroundCube } = buildEnvironment(renderer, cfg, subjectSize);
  scene.environment = envMap;
  scene.environmentIntensity = cfg.lighting.envIntensity ?? 1;
  scene.environmentRotation = new THREE.Euler(0, (cfg.lighting.envRotation ?? 0) * DEG, 0);
  scene.backgroundRotation = scene.environmentRotation;

  // Background
  const bg = cfg.background;
  if (bg.type === 'transparent') {
    renderer.setClearColor(0x000000, 0);
  } else if (bg.type === 'environment') {
    scene.background = backgroundCube;
    scene.backgroundBlurriness = bg.envBlur ?? 0;
  } else if (bg.type === 'gradient') {
    scene.background = gradientTexture(bg.gradient);
  } else {
    scene.background = new THREE.Color(bg.color || bg.cyc?.color || '#f2f2f4');
  }

  // Shadow-casting stand-ins, matching the studio's rig
  const directBalance = cfg.lighting.directBalance ?? 0.45;
  for (const def of cfg.lighting.environment.lights || []) {
    if (def.enabled === false || !def.castShadow) continue;
    const light = new THREE.DirectionalLight(
      lightColor(def),
      (def.intensity ?? 1) * (cfg.lighting.intensity ?? 1) * directBalance * 0.5
    );
    placeOnSphere(light.position, def.azimuth, def.elevation, (def.distance ?? 3) * subjectSize);
    light.castShadow = cfg.lighting.shadows.enabled;
    light.shadow.mapSize.setScalar(2048);
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.02 * subjectSize;
    light.shadow.radius = 4 * (cfg.lighting.shadows.softness ?? 1);
    const e = subjectSize * 3;
    Object.assign(light.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 0.1, far: subjectSize * 20 });
    light.shadow.camera.updateProjectionMatrix();
    scene.add(light);
  }

  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  if (cfg.lighting.shadows.catcher && cfg.lighting.shadows.enabled) {
    const geo = new THREE.PlaneGeometry(subjectSize * 12, subjectSize * 12).rotateX(-Math.PI / 2);
    const catcher = new THREE.Mesh(geo, new THREE.ShadowMaterial({
      opacity: cfg.lighting.shadows.opacity ?? 0.45, transparent: true
    }));
    catcher.receiveShadow = true;
    catcher.position.y = box.min.y;
    scene.add(catcher);
  }

  // Camera
  const camera = new THREE.PerspectiveCamera(
    2 * Math.atan(24 / (2 * (cfg.camera.focalLength || 85))) / DEG,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.01, subjectSize * 200
  );
  const target = center.clone();
  const dir = placeOnSphere(new THREE.Vector3(), cfg.camera.azimuth, cfg.camera.elevation, 1).normalize();
  const fitDistance = (subjectSize * 1.1) / Math.tan((camera.fov * DEG) / 2) / (cfg.camera.framing ?? 0.85);
  camera.position.copy(target).addScaledVector(dir, fitDistance);
  camera.lookAt(target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = subjectSize * 0.4;
  controls.maxDistance = subjectSize * 40;
  controls.update();

  // Optional auto-turntable, matching the studio's animation settings
  const spin = cfg.animation?.enabled && cfg.animation.type === 'turntable';
  const spinSpeed = spin ? (360 / Math.max(0.1, cfg.animation.duration)) * DEG : 0;

  function resize() {
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);
  resize();

  const clock = new THREE.Clock();
  let running = true;
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = clock.getDelta();
    if (spin) model.rotation.y += spinSpeed * dt;
    controls.update();
    renderer.render(scene, camera);
  }
  loop();

  return {
    scene, camera, renderer, controls, model,
    /** Download the current view as a PNG. */
    snapshot(filename = 'view.png') {
      renderer.render(scene, camera);
      renderer.domElement.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      });
    },
    dispose() { running = false; window.removeEventListener('resize', resize); renderer.dispose(); }
  };
}

function gradientTexture(g = {}) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  const grad = g.style === 'radial'
    ? ctx.createRadialGradient(256, 230, 0, 256, 230, 380)
    : ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, g.top || '#ffffff');
  grad.addColorStop(1, g.bottom || '#cccccc');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
