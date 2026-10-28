// Swept-sphere collision against capsules (posts, bar, wall players, keeper
// limbs). Only + − × ÷ and sqrt, so it is deterministic across engines.

import { addScaled, clamp, dot, sub, type Vec3 } from './vec';

/** Closest point on segment ab to p, and its parameter s ∈ [0, 1]. */
export function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): { point: Vec3; s: number } {
  const ab = sub(b, a);
  const abab = dot(ab, ab);
  const s = abab > 1e-12 ? clamp(dot(sub(p, a), ab) / abab, 0, 1) : 0;
  return { point: addScaled(a, ab, s), s };
}

/** Earliest t ∈ [0, 1] at which a point moving p → p + d enters a sphere; −1 if none or already inside. */
export function sweepSphere(p: Vec3, d: Vec3, c: Vec3, radius: number): number {
  const oc = sub(p, c);
  const a = dot(d, d);
  if (a < 1e-12) return -1;
  const cc = dot(oc, oc) - radius * radius;
  if (cc < 0) return -1;
  const b = dot(oc, d);
  const h = b * b - a * cc;
  if (h < 0) return -1;
  const t = (-b - Math.sqrt(h)) / a;
  return t >= 0 && t <= 1 ? t : -1;
}

/**
 * Earliest t ∈ [0, 1] at which a point moving p → p + d enters the capsule
 * ab of the given radius (callers pass capsule radius + ball radius); −1 if none.
 */
export function sweepCapsule(p: Vec3, d: Vec3, a: Vec3, b: Vec3, radius: number): number {
  const ba = sub(b, a);
  const baba = dot(ba, ba);
  if (baba < 1e-12) return sweepSphere(p, d, a, radius);
  const oa = sub(p, a);
  const bard = dot(ba, d);
  const baoa = dot(ba, oa);
  const rdoa = dot(d, oa);
  const oaoa = dot(oa, oa);
  const rdrd = dot(d, d);
  const A = baba * rdrd - bard * bard;
  const B = baba * rdoa - baoa * bard;
  const C = baba * oaoa - baoa * baoa - radius * radius * baba;
  if (A > 1e-12) {
    const h = B * B - A * C;
    // Missing the infinite cylinder means missing both end caps too.
    if (h < 0) return -1;
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 && t <= 1 ? t : -1;
  }
  const tA = sweepSphere(p, d, a, radius);
  const tB = sweepSphere(p, d, b, radius);
  if (tA < 0) return tB;
  if (tB < 0) return tA;
  return Math.min(tA, tB);
}
