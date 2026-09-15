/** Colour utilities: Kelvin↔RGB, hex helpers, and grading maths. */

/**
 * Tanner Helland / Neil Bartlett approximation of blackbody colour.
 * Returns linear-ish sRGB in 0..1, normalised so 6500K ≈ white.
 */
export function kelvinToRGB(kelvin) {
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
  return {
    r: clamp01(r / 255),
    g: clamp01(g / 255),
    b: clamp01(b / 255)
  };
}

export function kelvinToHex(kelvin) {
  const { r, g, b } = kelvinToRGB(kelvin);
  return rgbToHex(r, g, b);
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function rgbToHex(r, g, b) {
  const h = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRGB(hex) {
  const s = String(hex || '#000000').replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Multiply a hex colour by a white-balance Kelvin value. */
export function applyTemperature(hex, kelvin, referenceK = 6500) {
  const c = hexToRGB(hex);
  const k = kelvinToRGB(kelvin);
  const ref = kelvinToRGB(referenceK);
  return rgbToHex(
    (c.r * k.r) / (ref.r || 1),
    (c.g * k.g) / (ref.g || 1),
    (c.b * k.b) / (ref.b || 1)
  );
}

export function mixHex(a, b, t) {
  const ca = hexToRGB(a), cb = hexToRGB(b);
  return rgbToHex(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t);
}
