// Shooter input → launch state (SPEC §3.1). Runs on the server only and uses
// trig; the resulting plain numbers are broadcast so clients never recompute it.

import { flyToPlane } from './ball';
import { BALL_RADIUS, GOAL_HALF_WIDTH } from './geometry';
import { INPUT, type KickInput } from './input';
import type { SimParams } from './params';
import { clamp, v3, type Vec3 } from './vec';

export interface LaunchState {
  pos: Vec3;
  vel: Vec3;
  spin: Vec3;
}

/** Point on the goal plane the shooter aimed at. */
export function targetFromInput(input: KickInput, p: SimParams): { x: number; y: number } {
  const x = clamp(input.u, -1, 1) * (GOAL_HALF_WIDTH + p.aimOutsidePost);
  const hFrac = clamp((input.L - INPUT.minAimLen) / (INPUT.maxAimLen - INPUT.minAimLen), 0, 1);
  return { x, y: Math.max(BALL_RADIUS, hFrac * p.maxTargetHeight) };
}

export function speedFromPower(power: number, p: SimParams): number {
  return p.minSpeed + (p.maxSpeed - p.minSpeed) * Math.pow(clamp(power, 0, 1), p.powerExponent);
}

export function powerForSpeed(speed: number, p: SimParams): number {
  return Math.pow(clamp((speed - p.minSpeed) / (p.maxSpeed - p.minSpeed), 0, 1), 1 / p.powerExponent);
}

const SOLVER_ITERATIONS = 8;

function direction(fx: number, fz: number, yaw: number, elev: number): Vec3 {
  // Rotate the forward direction toward the shooter's right (−fz, fx) by yaw, then pitch up.
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const hx = fx * cy - fz * sy;
  const hz = fz * cy + fx * sy;
  const ce = Math.cos(elev);
  return v3(hx * ce, Math.sin(elev), hz * ce);
}

/**
 * Solves the yaw and elevation that put a ball struck at the reference speed on
 * the aimed point (curl included), then applies the actual power. So the aim is
 * exact at v_ref, overhit shots rise and underhit shots dip (SPEC §3.1).
 */
export function computeLaunch(spot: { x: number; z: number }, input: KickInput, p: SimParams): LaunchState {
  const start = v3(spot.x, BALL_RADIUS, spot.z);
  const target = targetFromInput(input, p);
  const dx = target.x - start.x;
  const dz = -start.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const fx = dx / dist;
  const fz = dz / dist;

  const curve = clamp(input.c, -INPUT.maxCurve, INPUT.maxCurve) / INPUT.maxCurve;
  const spin = v3(0, curve * p.maxSpin, 0);

  // Starting guess: no-drag projectile; the solver corrects drag and curl.
  const k = (p.gravity * dist * dist) / (2 * p.vRef * p.vRef);
  const disc = dist * dist - 4 * k * (k + target.y - BALL_RADIUS);
  let elev = Math.atan(disc >= 0 ? (dist - Math.sqrt(disc)) / (2 * k) : dist / (2 * k));
  let yaw = 0;
  for (let i = 0; i < SOLVER_ITERATIONS; i++) {
    const cross = flyToPlane(start, scaleDir(direction(fx, fz, yaw, elev), p.vRef), spin, p, 0);
    if (!cross) break;
    yaw += ((target.x - cross.x) * -fz) / dist;
    elev += ((target.y - cross.y) * Math.cos(elev)) / dist;
  }
  yaw *= p.curlCompensation;
  if (input.p > p.overhitThreshold) elev += ((input.p - p.overhitThreshold) * p.overhitDeg * Math.PI) / 180;

  return { pos: start, vel: scaleDir(direction(fx, fz, yaw, elev), speedFromPower(input.p, p)), spin };
}

function scaleDir(d: Vec3, s: number): Vec3 {
  return v3(d.x * s, d.y * s, d.z * s);
}
