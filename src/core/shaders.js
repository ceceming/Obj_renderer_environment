import * as THREE from 'three';

/**
 * Custom grading shaders.
 *
 * Order matters and follows how a colourist works:
 *   linear HDR  →  exposure, white balance, lift/gamma/gain, contrast, saturation
 *   tone map    →  (OutputPass)
 *   display     →  LUT, chromatic aberration, sharpen, vignette, grain
 *
 * Grading before the tone map means highlights roll off gracefully instead of
 * clipping; grading after it would bake the display curve into your adjustments.
 */

const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Linear-space primary grade. */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.0 },
    uContrast: { value: 1.0 },
    uSaturation: { value: 1.0 },
    uTemperature: { value: 0.0 },     // -1 cool .. +1 warm
    uTint: { value: 0.0 },            // -1 green .. +1 magenta
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) }
  },
  vertexShader: FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uExposure, uContrast, uSaturation, uTemperature, uTint;
    uniform vec3 uLift, uGamma, uGain;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;

      // Exposure is a straight multiply in linear light — exactly like opening
      // the aperture a stop.
      c *= uExposure;

      // White balance: push red against blue for temperature, green against
      // magenta for tint. Applied multiplicatively so it behaves like a filter.
      c.r *= 1.0 + uTemperature * 0.28;
      c.b *= 1.0 - uTemperature * 0.28;
      c.g *= 1.0 - uTint * 0.22;
      c.r *= 1.0 + uTint * 0.10;
      c.b *= 1.0 + uTint * 0.10;

      // Lift / gamma / gain — the standard three-way colour corrector.
      c = c * uGain + uLift;
      c = max(c, vec3(0.0));
      c = pow(c, 1.0 / max(uGamma, vec3(0.01)));

      // Contrast pivots around mid-grey in linear light (0.18), not 0.5,
      // which is why this stays natural at high settings.
      c = (c - 0.18) * uContrast + 0.18;
      c = max(c, vec3(0.0));

      float luma = dot(c, LUMA);
      c = mix(vec3(luma), c, uSaturation);

      gl_FragColor = vec4(max(c, 0.0), texel.a);
    }`
};

/** Display-space finishing: chromatic aberration, sharpen, vignette, grain. */
export const FilmicShader = {
  name: 'FilmicShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1024, 1024) },
    uTime: { value: 0 },
    uCA: { value: 0.0 },
    uSharpen: { value: 0.0 },
    uVignette: { value: 0.0 },
    uVignetteOffset: { value: 0.9 },
    uVignetteRoundness: { value: 1.0 },
    uGrain: { value: 0.0 },
    uGrainSize: { value: 1.0 },
    uGrainColored: { value: 0.0 }
  },
  vertexShader: FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime, uCA, uSharpen, uVignette, uVignetteOffset, uVignetteRoundness;
    uniform float uGrain, uGrainSize, uGrainColored;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.8975, 397.2973));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 texel = 1.0 / uResolution;
      vec2 centered = vUv - 0.5;
      vec4 color;

      // Chromatic aberration: sample the channels at slightly different
      // magnifications, growing towards the edge of the frame like a real lens.
      if (uCA > 0.0) {
        vec2 offset = centered * uCA * length(centered) * 2.0;
        color.r = texture2D(tDiffuse, vUv - offset).r;
        color.g = texture2D(tDiffuse, vUv).g;
        color.b = texture2D(tDiffuse, vUv + offset).b;
        color.a = texture2D(tDiffuse, vUv).a;
      } else {
        color = texture2D(tDiffuse, vUv);
      }

      // Unsharp mask.
      if (uSharpen > 0.0) {
        vec3 blur =
          texture2D(tDiffuse, vUv + vec2( texel.x, 0.0)).rgb +
          texture2D(tDiffuse, vUv + vec2(-texel.x, 0.0)).rgb +
          texture2D(tDiffuse, vUv + vec2(0.0,  texel.y)).rgb +
          texture2D(tDiffuse, vUv + vec2(0.0, -texel.y)).rgb;
        blur *= 0.25;
        color.rgb += (color.rgb - blur) * uSharpen * 2.0;
      }

      // Vignette.
      if (uVignette > 0.0) {
        vec2 v = centered * 2.0;
        v.x *= mix(1.0, uResolution.x / uResolution.y, uVignetteRoundness);
        float d = length(v) * uVignetteOffset;
        float fall = smoothstep(0.8, 1.6, d);
        color.rgb *= mix(1.0, 1.0 - uVignette, fall);
      }

      // Film grain, scaled so it stays the same apparent size at any resolution.
      if (uGrain > 0.0) {
        vec2 gUv = vUv * uResolution / max(uGrainSize, 0.01) * 0.5;
        float n = hash(gUv + fract(uTime) * 71.3) - 0.5;
        vec3 noise = vec3(n);
        if (uGrainColored > 0.5) {
          noise = vec3(n, hash(gUv + 13.7 + fract(uTime) * 41.1) - 0.5, hash(gUv + 51.3 + fract(uTime) * 17.7) - 0.5);
        }
        // Grain is strongest in the midtones, as it is on film.
        float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
        float weight = 4.0 * luma * (1.0 - luma);
        color.rgb += noise * uGrain * mix(0.35, 1.0, weight);
      }

      gl_FragColor = color;
    }`
};

/**
 * Halation — the warm bleed real film shows around very bright areas, caused by
 * light scattering off the film base. Subtler and more organic than bloom.
 */
export const HalationShader = {
  name: 'HalationShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1024, 1024) },
    uAmount: { value: 0.0 },
    uThreshold: { value: 0.9 },
    uTint: { value: new THREE.Color(0xff7a3c) }
  },
  vertexShader: FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uAmount, uThreshold;
    uniform vec3 uTint;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uAmount <= 0.0) { gl_FragColor = base; return; }

      vec2 texel = 1.0 / uResolution;
      vec3 bleed = vec3(0.0);
      float total = 0.0;
      // Wide, cheap radial gather — halation is low frequency by nature.
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 0.5236;              // 30 degrees
        for (int r = 1; r <= 3; r++) {
          float radius = float(r) * 6.0;
          vec2 o = vec2(cos(a), sin(a)) * texel * radius;
          vec3 s = texture2D(tDiffuse, vUv + o).rgb;
          float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
          float w = 1.0 / float(r);
          bleed += max(s - uThreshold, 0.0) * step(uThreshold, lum) * w;
          total += w;
        }
      }
      bleed /= max(total, 0.001);
      gl_FragColor = vec4(base.rgb + bleed * uTint * uAmount * 3.0, base.a);
    }`
};

/**
 * Restores the alpha channel after passes that destroy it (bloom, DOF, AO).
 * Without this, transparent PNG output is impossible once post is enabled.
 *
 * It also clamps colour to coverage. Bloom happily deposits light into pixels
 * the subject barely covers, and once that pixel is composited over a
 * background the extra energy shows up as a bright halo instead of the soft
 * shadow that belongs there. Capping brightness at the pixel's own alpha keeps
 * fully opaque pixels untouched while stopping partially covered ones from
 * glowing brighter than they are present.
 */
export const AlphaRestoreShader = {
  name: 'AlphaRestoreShader',
  uniforms: {
    tDiffuse: { value: null },
    tAlpha: { value: null },
    uStrength: { value: 1.0 },
    uClampGlow: { value: 1.0 }
  },
  vertexShader: FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tAlpha;
    uniform float uStrength;
    uniform float uClampGlow;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float a = clamp(texture2D(tAlpha, vUv).a * uStrength, 0.0, 1.0);
      vec3 rgb = mix(min(color.rgb, vec3(a)), color.rgb, uClampGlow > 0.5 ? 0.0 : 1.0);
      gl_FragColor = vec4(rgb, a);
    }`
};

/** Renders a solid colour silhouette of whatever is in the depth buffer. */
export const MatteShader = {
  name: 'MatteShader',
  uniforms: { tDiffuse: { value: null }, uColor: { value: new THREE.Color(0x000000) } },
  vertexShader: FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
      float a = texture2D(tDiffuse, vUv).a;
      gl_FragColor = vec4(uColor, a);
    }`
};
