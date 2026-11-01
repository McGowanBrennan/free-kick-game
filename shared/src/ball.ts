// Ball flight forces, shared by the full sim and the launch solver.

import { DT, MAX_SIM_TICKS } from './geometry';
import type { SimParams } from './params';
import { lerpNum, v3, type Vec3 } from './vec';

/**
 * Drag multiplier for the drag crisis: a football's drag coefficient roughly
 * halves once the airflow turns turbulent (~10–16 m/s), so slow balls hang
 * and brake harder than driven ones.
 */
export function dragScale(speed: number, p: SimParams): number {
  if (speed >= p.dragCrisisHigh) return 1;
  if (speed <= p.dragCrisisLow) return p.dragLowScale;
  return lerpNum(p.dragLowScale, 1, (speed - p.dragCrisisLow) / (p.dragCrisisHigh - p.dragCrisisLow));
}

/** Airborne acceleration: gravity, quadratic drag (with drag crisis) and Magnus (ω × v). */
export function ballAccel(vel: Vec3, spin: Vec3, p: SimParams): Vec3 {
  const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  const k = p.dragK * dragScale(speed, p);
  return v3(
    -k * speed * vel.x + p.magnusK * (spin.y * vel.z - spin.z * vel.y),
    -p.gravity - k * speed * vel.y + p.magnusK * (spin.z * vel.x - spin.x * vel.z),
    -k * speed * vel.z + p.magnusK * (spin.x * vel.y - spin.y * vel.x),
  );
}

export interface FlightPoint {
  tick: number;
  x: number;
  y: number;
  z: number;
  speed: number;
}

const CALM = v3();

/**
 * Free flight (no collisions, no ground) until `stop` says so, using the same
 * integrator as the sim (in a horizontal `wind`). Returns the interpolated
 * crossing point.
 */
function fly(
  pos: Vec3,
  vel: Vec3,
  spin: Vec3,
  p: SimParams,
  /** Fraction of the step at which the stop condition is met, null to keep going, 'abort' to give up */
  crossed: (prev: Vec3, next: Vec3) => number | null | 'abort',
  wind: Vec3 = CALM,
): FlightPoint | null {
  let pp = pos;
  let v = vel;
  let s = spin;
  for (let tick = 1; tick <= MAX_SIM_TICKS; tick++) {
    const a = ballAccel(v3(v.x - wind.x, v.y - wind.y, v.z - wind.z), s, p);
    v = v3(v.x + a.x * DT, v.y + a.y * DT, v.z + a.z * DT);
    s = v3(s.x * p.spinDecayPerTick, s.y * p.spinDecayPerTick, s.z * p.spinDecayPerTick);
    const next = v3(pp.x + v.x * DT, pp.y + v.y * DT, pp.z + v.z * DT);
    const f = crossed(pp, next);
    if (f === 'abort') return null;
    if (f !== null) {
      return {
        tick,
        x: lerpNum(pp.x, next.x, f),
        y: lerpNum(pp.y, next.y, f),
        z: lerpNum(pp.z, next.z, f),
        speed: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
      };
    }
    pp = next;
  }
  return null;
}

/** Free flight until the ball crosses the plane z = zPlane heading toward the goal. */
export function flyToPlane(pos: Vec3, vel: Vec3, spin: Vec3, p: SimParams, zPlane: number, wind: Vec3 = CALM): FlightPoint | null {
  return fly(
    pos,
    vel,
    spin,
    p,
    (a, b) => {
      if (a.z > zPlane && b.z <= zPlane) return (a.z - zPlane) / (a.z - b.z);
      return b.z >= a.z ? 'abort' : null;
    },
    wind,
  );
}

/** Free flight until the ball comes back down to height y (used for range checks). */
export function flyToGround(pos: Vec3, vel: Vec3, spin: Vec3, p: SimParams, y = pos.y): FlightPoint | null {
  return fly(pos, vel, spin, p, (a, b) => (a.y >= y && b.y < y && b.y < a.y ? (a.y - y) / (a.y - b.y) : null));
}
