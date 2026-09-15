import * as THREE from 'three';
import { placeOnSphere, resolveLightColor } from './environment.js';
import { ContactShadows } from './contactShadows.js';

/**
 * The lighting rig.
 *
 * Two cooperating systems produce the final illumination:
 *
 *  1. The *environment* (built in environment.js) supplies almost all of the
 *     light. Because it is a pre-filtered IBL, it gives physically plausible
 *     soft diffuse falloff and — the part that sells the image — specular
 *     reflections shaped exactly like the softboxes you placed.
 *
 *  2. A small number of *real* three.js lights, created here, supply the
 *     things an IBL cannot: cast shadows and crisp directional definition.
 *     They run at a fraction of full strength (`directBalance`) so the two
 *     systems sum to roughly one correct exposure rather than double-counting.
 *
 * Shadow softness is driven by the source's angular size, exactly as in
 * reality: a wide softbox close to the subject produces a soft-edged shadow,
 * a small distant source produces a hard one.
 */

const DEG = Math.PI / 180;

/**
 * Calibration for the direct lights.
 *
 * These stand-ins exist to cast shadows and add crispness, not to carry the
 * exposure — the environment already does that. Left at full strength they
 * double-count every source and blow the image out by several stops.
 */
const DIRECT_ENERGY_SCALE = 0.70;

export class LightRig {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'LightRig';
    this.lights = [];
    this.contactShadows = null;
    this.shadowCatcher = null;
    this._subjectSize = 1;
  }

  /**
   * Rebuild every real light from the config.
   * @param {object} cfg        full RenderConfig
   * @param {number} subjectSize normalised subject size (usually 1)
   * @param {THREE.Vector3} center subject centre, for aiming
   */
  build(cfg, subjectSize = 1, center = new THREE.Vector3(0, 0.5, 0)) {
    this.clear();
    this._subjectSize = subjectSize;

    const L = cfg.lighting;
    const shadows = L.shadows;
    const globalIntensity = L.intensity ?? 1;
    const directBalance = L.directBalance ?? 0.45;

    // ── Sun (from the procedural sky) ───────────────────────────────────────
    const sky = L.environment.sky || {};
    if (sky.sunEnabled && L.environment.type === 'procedural') {
      const sun = new THREE.DirectionalLight(
        new THREE.Color(sky.sunColor || '#fff4e0'),
        (sky.sunIntensity ?? 6) * globalIntensity * directBalance * DIRECT_ENERGY_SCALE
      );
      placeOnSphere(sun.position, sky.sunAzimuth ?? 130, sky.sunElevation ?? 35, 12 * subjectSize);
      sun.target.position.copy(center);
      sun.castShadow = shadows.enabled && shadows.type !== 'none' && shadows.type !== 'contact';
      // The sun's angular diameter (0.53° in reality) sets shadow edge softness.
      this._configureShadow(sun, shadows, subjectSize, sky.sunAngularSize ?? 0.53, 12);
      sun.userData.role = 'sun';
      this.group.add(sun, sun.target);
      this.lights.push({ def: { id: '__sun', role: 'sun', name: 'Sun' }, light: sun });
    }

    // ── Area lights ─────────────────────────────────────────────────────────
    for (const def of L.environment.lights || []) {
      if (def.enabled === false) continue;
      const color = resolveLightColor(def);
      const distance = (def.distance ?? 3) * subjectSize;
      const power = (def.intensity ?? 1) * globalIntensity * directBalance;
      if (power <= 0.0001) continue;

      // Role weighting mirrors how a photographer balances a rig: the key
      // carries contrast, the fill deliberately does not.
      const roleScale =
        def.role === 'key' ? 1.0 :
        def.role === 'fill' ? 1.0 / Math.max(0.2, (L.keyToFill ?? 4) / 4) :
        def.role === 'rim' || def.role === 'kick' ? (L.rimStrength ?? 1) :
        def.role === 'bounce' ? (L.bounceStrength ?? 0.5) * 2 :
        1.0;

      const light = new THREE.DirectionalLight(color, power * roleScale * DIRECT_ENERGY_SCALE);
      placeOnSphere(light.position, def.azimuth, def.elevation, distance);
      light.target.position.copy(center);
      light.castShadow = Boolean(def.castShadow) && shadows.enabled && shadows.type !== 'none' && shadows.type !== 'contact';

      // Angular size of this source as seen from the subject, in degrees.
      const sourceSize = Math.max(def.width ?? 2, def.height ?? 2) * subjectSize;
      const angularSize = 2 * Math.atan(sourceSize / (2 * distance)) / DEG;
      this._configureShadow(light, shadows, subjectSize, angularSize, distance);

      light.userData.role = def.role;
      light.userData.lightId = def.id;
      this.group.add(light, light.target);
      this.lights.push({ def, light });
    }

    // ── Ambient floor bounce ────────────────────────────────────────────────
    if ((L.bounceStrength ?? 0) > 0) {
      const hemi = new THREE.HemisphereLight(
        0xffffff,
        new THREE.Color(L.bounceColor || '#ffffff'),
        L.bounceStrength * globalIntensity * 0.25
      );
      this.group.add(hemi);
      this.lights.push({ def: { id: '__bounce', role: 'bounce', name: 'Bounce' }, light: hemi });
    }

    this._buildShadowCatcher(cfg, subjectSize);
    return this.group;
  }

  _configureShadow(light, shadows, subjectSize, angularSizeDeg, distance) {
    if (!light.castShadow) return;
    const s = light.shadow;
    s.mapSize.setScalar(Math.min(4096, shadows.resolution || 2048));
    s.bias = shadows.bias ?? -0.0005;
    s.normalBias = (shadows.normalBias ?? 0.02) * subjectSize;

    // Shadow radius from the source's angular size — this is the physical link
    // between "how big is the softbox" and "how soft is the shadow".
    const softnessScale = shadows.softness ?? 1;
    const base = shadows.type === 'hard' ? 0.35 : 1.0;
    s.radius = Math.max(0.5, angularSizeDeg * 0.9 * softnessScale * base);
    s.blurSamples = shadows.type === 'hard' ? 4 : 16;

    const extent = subjectSize * 3.2;
    const cam = s.camera;
    cam.left = -extent; cam.right = extent;
    cam.top = extent; cam.bottom = -extent;
    cam.near = Math.max(0.01, distance - subjectSize * 4);
    cam.far = distance + subjectSize * 6;
    cam.updateProjectionMatrix();
  }

  _buildShadowCatcher(cfg, subjectSize) {
    const shadows = cfg.lighting.shadows;

    // Shadow-map catcher: an invisible plane that renders *only* the shadow
    // falling on it. With a transparent background this writes straight into
    // the alpha channel.
    if (shadows.catcher && shadows.enabled && shadows.type !== 'none' && shadows.type !== 'contact') {
      const geo = new THREE.PlaneGeometry(
        (shadows.catcherSize ?? 12) * subjectSize,
        (shadows.catcherSize ?? 12) * subjectSize
      );
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.ShadowMaterial({
        opacity: shadows.opacity ?? 0.45,
        color: 0x000000,
        transparent: true,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.position.y = 0;
      mesh.name = 'ShadowCatcher';
      mesh.userData.isShadowCatcher = true;
      mesh.userData.excludeFromContactShadow = true;
      this.shadowCatcher = mesh;
      this.group.add(mesh);
    }

    // Contact shadows are independent of the shadow maps and always help.
    const cs = shadows.contactShadow;
    if (cs?.enabled && shadows.type !== 'none') {
      this.contactShadows = new ContactShadows({
        // Sized to the subject, not to the catcher plane. A contact shadow only
        // ever occupies the object's own footprint plus a little spill, so a
        // huge plane just spends the shadow texture's resolution on empty space.
        size: subjectSize * 3.2,
        // A contact shadow should fall off within the lowest part of the object:
        // spread over the whole height it becomes a faint wash instead of the
        // dark pool that actually grounds the subject.
        height: (cs.height ?? 0.35) * subjectSize,
        resolution: cs.resolution ?? 512,
        darkness: cs.darkness ?? 1.1,
        blur: cs.blur ?? 2.2,
        opacity: shadows.opacity ? Math.min(1, shadows.opacity * 2.2) : 0.8
      });
      this.group.add(this.contactShadows.group);
    }
  }

  /** Spin the whole rig — used by envRotation and the light-sweep animation. */
  setRotation(degrees) {
    this.group.rotation.y = degrees * DEG;
  }

  /** Update contact shadows. Must run before the beauty pass each frame. */
  updateContactShadows(renderer, scene) {
    if (this.contactShadows) this.contactShadows.update(renderer, scene);
  }

  /** Toggle the catcher planes — e.g. to render a shadow-only pass. */
  setCatcherVisible(visible) {
    if (this.shadowCatcher) this.shadowCatcher.visible = visible;
    if (this.contactShadows) this.contactShadows.group.visible = visible;
  }

  clear() {
    for (const { light } of this.lights) {
      if (light.shadow?.map) light.shadow.map.dispose();
      light.dispose?.();
      this.group.remove(light);
      if (light.target) this.group.remove(light.target);
    }
    this.lights = [];
    if (this.shadowCatcher) {
      this.shadowCatcher.geometry.dispose();
      this.shadowCatcher.material.dispose();
      this.group.remove(this.shadowCatcher);
      this.shadowCatcher = null;
    }
    if (this.contactShadows) {
      this.group.remove(this.contactShadows.group);
      this.contactShadows.dispose();
      this.contactShadows = null;
    }
  }

  dispose() { this.clear(); }
}

/** Map the config's shadow type onto a three.js shadow map algorithm. */
export function shadowMapTypeFor(type) {
  switch (type) {
    case 'hard': return THREE.PCFShadowMap;
    case 'soft': return THREE.PCFSoftShadowMap;
    default: return THREE.PCFSoftShadowMap;
  }
}
