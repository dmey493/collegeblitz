export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const len = (x, z) => Math.sqrt(x * x + z * z);
export const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function turnToward(cur, target, maxStep) {
  const d = wrapAngle(target - cur);
  return wrapAngle(cur + clamp(d, -maxStep, maxStep));
}

// Facing angle convention: 0 faces +z, +PI/2 faces +x (matches three.js rotation.y).
export const angleOf = (x, z) => Math.atan2(x, z);

export const round2 = (v) => Math.round(v * 100) / 100;
