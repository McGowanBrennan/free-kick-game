// Turns raw touch paths into the compact inputs sent to the server (SPEC §3).
// Runs on the client only, so trig is fine here: the server receives numbers.

import { clamp } from './vec';

export const INPUT = {
  maxAimAngleDeg: 55,
  minAimLen: 0.12,
  maxAimLen: 0.55,
  minSwipeLen: 0.08,
  maxSwipeMs: 600,
  powerWindowMs: 100,
  /** Finger speed (screen heights / s) that maps to power 0 and power 1 */
  minSwipeSpeed: 0.8,
  maxSwipeSpeed: 5.0,
  maxCurve: 0.35,
  tapMaxLen: 0.04,
  tapMaxMs: 200,
  keeperMaxLen: 0.35,
} as const;

/** A touch sample in CSS pixels (y down) with a timestamp in ms. */
export interface SwipeSample {
  x: number;
  y: number;
  t: number;
}

/** Shooter input (SPEC §3.1): aim u ∈ [−1, 1], chord length L, power p ∈ [0, 1], curve c. */
export interface KickInput {
  u: number;
  L: number;
  p: number;
  c: number;
  durMs: number;
}

/**
 * Keeper input (SPEC §3.2): the flick vector in screen heights as seen from the
 * keeper camera (y down), and the sim tick it happened on relative to ball
 * contact (negative during the run-up).
 */
export interface KeeperInput {
  vx: number;
  vy: number;
  durMs: number;
  flickTick: number;
}

export function kickInputFromSwipe(samples: SwipeSample[], screenH: number): KickInput | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dx = (last.x - first.x) / screenH;
  const dy = (last.y - first.y) / screenH;
  const L = Math.sqrt(dx * dx + dy * dy);
  const durMs = last.t - first.t;
  if (L < INPUT.minSwipeLen || durMs > INPUT.maxSwipeMs || dy >= 0) return null;

  const phiDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const u = clamp(phiDeg / INPUT.maxAimAngleDeg, -1, 1);

  // Power: finger speed over the final window of the swipe.
  const windowStart = last.t - INPUT.powerWindowMs;
  let ref = first;
  for (let i = samples.length - 2; i >= 0; i--) {
    ref = samples[i];
    if (samples[i].t <= windowStart) break;
  }
  const dtS = Math.max(last.t - ref.t, 8) / 1000;
  const speed = Math.hypot(last.x - ref.x, last.y - ref.y) / screenH / dtS;
  const p = clamp((speed - INPUT.minSwipeSpeed) / (INPUT.maxSwipeSpeed - INPUT.minSwipeSpeed), 0, 1);

  // Curve: largest signed bulge of the path off the chord, positive = bows right.
  const cx = dx / L;
  const cy = dy / L;
  let bulge = 0;
  for (const s of samples) {
    const rx = (s.x - first.x) / screenH;
    const ry = (s.y - first.y) / screenH;
    const dev = rx * -cy + ry * cx;
    if (Math.abs(dev) > Math.abs(bulge)) bulge = dev;
  }
  const c = clamp(bulge / L, -INPUT.maxCurve, INPUT.maxCurve);

  return { u, L, p, c, durMs };
}

export function keeperInputFromSwipe(samples: SwipeSample[], screenH: number, flickTick: number): KeeperInput {
  const first = samples[0];
  const last = samples[samples.length - 1] ?? first;
  return {
    vx: (last.x - first.x) / screenH,
    vy: (last.y - first.y) / screenH,
    durMs: last.t - first.t,
    flickTick,
  };
}
