// Ball flight forces, shared by the full sim and the launch solver.

import { DT, MAX_SIM_TICKS } from './geometry';
import type { SimParams } from './params';
import { lerpNum, v3, type Vec3 } from './vec';

/** Airborne acceleration: gravity, quadratic drag and Magnus (ω × v). */
export function ballAccel(vel: Vec3, spin: Vec3, p: SimParams): Vec3 {
  const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  return v3(
    -p.dragK * speed * vel.x + p.magnusK * (spin.y * vel.z - spin.z * vel.y),
    -p.gravity - p.dragK * speed * vel.y + p.magnusK * (spin.z * vel.x - spin.x * vel.z),
    -p.dragK * speed * vel.z + p.magnusK * (spin.x * vel.y - spin.y * vel.x),
  );
}

/**
 * Free flight (no collisions, no ground) until the ball crosses the plane
 * z = zPlane heading toward the goal. Same integrator as the sim.
 */
export function flyToPlane(
  pos: Vec3,
  vel: Vec3,
  spin: Vec3,
  p: SimParams,
  zPlane: number,
): { tick: number; x: number; y: number } | null {
  let px = pos.x;
  let py = pos.y;
  let pz = pos.z;
  let v = vel;
  let s = spin;
  for (let tick = 1; tick <= MAX_SIM_TICKS; tick++) {
    const a = ballAccel(v, s, p);
    v = v3(v.x + a.x * DT, v.y + a.y * DT, v.z + a.z * DT);
    s = v3(s.x * p.spinDecayPerTick, s.y * p.spinDecayPerTick, s.z * p.spinDecayPerTick);
    const nx = px + v.x * DT;
    const ny = py + v.y * DT;
    const nz = pz + v.z * DT;
    if (pz > zPlane && nz <= zPlane) {
      const f = (pz - zPlane) / (pz - nz);
      return { tick, x: lerpNum(px, nx, f), y: lerpNum(py, ny, f) };
    }
    if (v.z >= 0) return null;
    px = nx;
    py = ny;
    pz = nz;
  }
  return null;
}
