// Shooter input → launch state (SPEC §3.1). Runs on the server only and uses
// trig; the resulting plain numbers are broadcast so clients never recompute it.

import { flyToPlane } from './ball';
import { BALL_RADIUS } from './geometry';
import type { KickInput } from './input';
import type { SimParams } from './params';
import { clamp, v3, type Vec3 } from './vec';

export interface LaunchState {
  pos: Vec3;
  vel: Vec3;
  spin: Vec3;
}

export const MAX_AIM_X = 8;
export const MAX_AIM_Y = 5;

/** How high a kick may be aimed and how steeply it may be struck. */
export interface LaunchLimits {
  maxAimY: number;
  /** Radians: a strike too weak to reach its target below this falls short */
  maxElevation: number;
}

/** Free kicks: aimed at most a little over the bar, struck at most ≈ 34°. */
export const FREE_KICK_LIMITS: LaunchLimits = { maxAimY: MAX_AIM_Y, maxElevation: 0.6 };
/** The start line may point well outside the posts: a big bend round the wall. */
export const MAX_START_X = 14;

/** Point on the goal plane the shooter aimed at. */
export function targetFromInput(input: KickInput, limits: LaunchLimits = FREE_KICK_LIMITS): { x: number; y: number } {
  return { x: clamp(input.x, -MAX_AIM_X, MAX_AIM_X), y: clamp(input.y, BALL_RADIUS, limits.maxAimY) };
}

export function speedFromPower(power: number, p: SimParams): number {
  return p.minSpeed + (p.maxSpeed - p.minSpeed) * Math.pow(clamp(power, 0, 1), p.powerExponent);
}

export function powerForSpeed(speed: number, p: SimParams): number {
  return Math.pow(clamp((speed - p.minSpeed) / (p.maxSpeed - p.minSpeed), 0, 1), 1 / p.powerExponent);
}

/**
 * Highest elevation a shot aimed at height y may take. Low aims are driven or
 * rolled: they skim, bounce and skid in rather than looping up and dropping
 * onto the target (a soft low shot from 25 m would otherwise need a 17° lob).
 * The allowed peak grows with the aim height and stops mattering by ~1 m.
 */
function lowShotMaxElevation(y: number, speed: number, p: SimParams): number {
  const over = Math.max(0, y - p.lowShotHeight);
  const apex = 0.25 + 0.5 * y + 30 * over * over;
  const vy = Math.sqrt(2 * p.gravity * Math.max(0.05, apex - BALL_RADIUS));
  return vy >= speed ? Infinity : Math.asin(vy / speed);
}

/**
 * Spin of a strike with sidespin s heading along (dx, dz): a curler is struck
 * across the ball and up its side, so it carries topspin too (axis ŷ × d),
 * which makes curled shots dip.
 */
function strikeSpin(dx: number, dz: number, s: number, p: SimParams): Vec3 {
  const l = Math.sqrt(dx * dx + dz * dz);
  const t = Math.abs(s) * p.topspinPerSidespin;
  return v3((dz / l) * t, s, (-dx / l) * t);
}

/**
 * Most sidespin a strike can carry. Spin comes from foot speed, so harder
 * strikes can carry more (a powerful curler still bends); the outside of the
 * boot (a trivela) gets less than the instep.
 */
function maxSpinFor(speed: number, trivela: boolean, p: SimParams): number {
  return p.maxSpin * clamp(speed / p.vRef, 0.7, 1.15) * (trivela ? p.trivelaSpinScale : 1);
}

/**
 * Our shooter is right-footed: a ball bending right (negative spin about y)
 * is struck with the outside of the boot, a trivela.
 */
function isTrivela(spinY: number, p: SimParams): boolean {
  return spinY < -0.1 * p.maxSpin;
}

export type KickStyle = 'instep' | 'curler' | 'trivela' | 'chip';

/** How a launch was struck, for the read-out and the shooter's animation. */
export function kickStyle(input: KickInput, launch: LaunchState, p: SimParams): KickStyle {
  if (input.chip) return 'chip';
  if (isTrivela(launch.spin.y, p)) return 'trivela';
  return launch.spin.y > 0.1 * p.maxSpin ? 'curler' : 'instep';
}

/** Off-centre contact trades pace for spin. */
function paceFor(spinY: number, p: SimParams): number {
  return 1 - p.curvePaceLoss * Math.min(1, Math.abs(spinY) / p.maxSpin);
}

const SOLVER_ITERATIONS = 14;

function direction(fx: number, fz: number, yaw: number, elev: number, speed: number): Vec3 {
  // Rotate the forward direction toward the shooter's right (−fz, fx) by yaw, then pitch up.
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const ce = Math.cos(elev);
  return v3((fx * cy - fz * sy) * ce * speed, Math.sin(elev) * speed, (fz * cy + fx * sy) * ce * speed);
}

/** No-drag projectile elevation that reaches height y at range dist: the solvers' starting guess. */
function guessElevation(dist: number, y: number, speed: number, p: SimParams): number {
  const k = (p.gravity * dist * dist) / (2 * speed * speed);
  const disc = dist * dist - 4 * k * (k + y - BALL_RADIUS);
  return Math.atan(disc >= 0 ? (dist - Math.sqrt(disc)) / (2 * k) : dist / (2 * k));
}

interface Frame {
  start: Vec3;
  fx: number;
  fz: number;
  dist: number;
}

function frameToward(spot: { x: number; z: number }, x: number): Frame {
  const start = v3(spot.x, BALL_RADIUS, spot.z);
  const dx = x - start.x;
  const dz = -start.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  return { start, fx: dx / dist, fz: dz / dist, dist };
}

/**
 * Newton's method with a finite-difference Jacobian on two launch unknowns
 * (a, elevation) so the ball crosses the goal plane at the target. `launch`
 * builds the velocity and spin from them; `aMax` bounds a (when a is pinned
 * at its bound only the elevation is solved). With `fixedElev` the elevation
 * is held and only a is solved, for the across-goal position.
 */
function solve(
  target: { x: number; y: number },
  start: Vec3,
  launch: (a: number, elev: number) => { vel: Vec3; spin: Vec3 },
  a0: number,
  elev0: number,
  ha: number,
  aStep: number,
  aMax: number,
  p: SimParams,
  maxElev: number,
  fixedElev?: number,
): { a: number; elev: number } {
  const cross = (a: number, e: number) => {
    const l = launch(a, e);
    return flyToPlane(start, l.vel, l.spin, p, 0);
  };
  const he = 1e-4;
  let a = a0;
  let elev = fixedElev ?? elev0;
  for (let i = 0; i < SOLVER_ITERATIONS; i++) {
    const c0 = cross(a, elev);
    if (!c0) {
      if (fixedElev !== undefined) break;
      elev = Math.min(maxElev, elev + 0.1); // fell short: loft it
      continue;
    }
    if (fixedElev !== undefined) {
      const ex = target.x - c0.x;
      if (Math.abs(ex) < 1e-4 || aMax === 0) break;
      const ca = cross(a + ha, elev);
      if (!ca || Math.abs(ca.x - c0.x) < 1e-12) break;
      a = clamp(a + clamp((ex * ha) / (ca.x - c0.x), -aStep, aStep), -aMax, aMax);
      continue;
    }
    const ex = target.x - c0.x;
    const ey = target.y - c0.y;
    if (Math.abs(ex) < 1e-4 && Math.abs(ey) < 1e-4) break;
    const ca = cross(a + ha, elev);
    const ce = cross(a, elev + he);
    if (!ca || !ce) break;
    const j11 = (ca.x - c0.x) / ha;
    const j12 = (ce.x - c0.x) / he;
    const j21 = (ca.y - c0.y) / ha;
    const j22 = (ce.y - c0.y) / he;
    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-12) break;
    let da = clamp((ex * j22 - ey * j12) / det, -aStep, aStep);
    let de = clamp((ey * j11 - ex * j21) / det, -0.2, 0.2);
    if (Math.abs(a + da) > aMax) {
      // Out of range for a: pin it and solve the height alone.
      da = clamp(a + da, -aMax, aMax) - a;
      de = Math.abs(j22) > 1e-9 ? clamp((ey - j21 * da) / j22, -0.2, 0.2) : 0;
    }
    a += da;
    elev = clamp(elev + de, -0.2, maxElev);
  }
  return { a, elev };
}

/**
 * The launch for a flick (SPEC §3.1). The ball leaves along the start line
 * (toward sx on the goal line, the direction the flick set off in) and the
 * solver finds the sidespin that bends it onto the aim point, plus the
 * elevation for the aimed height at the pace struck. Low aims are capped to a
 * skimming elevation (see lowShotMaxElevation). Spin is capped at maxSpin: for
 * a bend tighter than a boot can give, the aim point wins and the ball starts
 * as far out as full curl still brings back onto it. Past the overhit
 * threshold the strike rises. This is the strike as intended; the server
 * then applies applyStrikeError.
 */
export function computeLaunch(
  spot: { x: number; z: number },
  input: KickInput,
  p: SimParams,
  limits: LaunchLimits = FREE_KICK_LIMITS,
): LaunchState {
  const target = targetFromInput(input, limits);
  if (input.chip) return chipLaunch(spot, target, input.p, p);
  const sx = clamp(input.sx, -MAX_START_X, MAX_START_X);
  const { start, fx, fz, dist } = frameToward(spot, sx);
  const base = speedFromPower(input.p, p);
  const launch = (spinY: number, elev: number) => {
    const speed = base * paceFor(spinY, p);
    return { vel: direction(fx, fz, 0, elev, speed), spin: strikeSpin(fx, fz, spinY, p) };
  };
  const straight = Math.abs(sx - target.x) < 1e-6;
  // Bending right (the aim is right of the start line) means a trivela.
  const spinCap = maxSpinFor(base, target.x > sx, p);
  const solveBend = (fixedElev?: number) =>
    solve(target, start, launch, 0, guessElevation(dist, target.y, base, p), 0.05, straight ? 0 : 25, straight ? 0 : spinCap, p, limits.maxElevation, fixedElev);
  let { a: spinY, elev } = solveBend();
  const cap = lowShotMaxElevation(target.y, base, p);
  if (elev > cap) ({ a: spinY, elev } = solveBend(cap));
  const lift = input.p > p.overhitThreshold ? ((input.p - p.overhitThreshold) * p.overhitDeg * Math.PI) / 180 : 0;
  if (Math.abs(spinY) >= spinCap - 1e-6) {
    const a = aimWithSpin(spot, target, base, Math.sign(spinY) * spinCap, p, limits.maxElevation);
    return { pos: a.start, vel: direction(a.fx, a.fz, a.yaw, a.elev + lift, a.speed), spin: a.spin };
  }
  return { pos: start, ...launch(spinY, elev + lift) };
}

/** Yaw and elevation that land a strike of base speed with sidespin spinY on the target. */
function aimWithSpin(
  spot: { x: number; z: number },
  target: { x: number; y: number },
  base: number,
  spinY: number,
  p: SimParams,
  maxElev: number,
) {
  const { start, fx, fz, dist } = frameToward(spot, target.x);
  const speed = base * paceFor(spinY, p);
  const spinFor = (vel: Vec3) => strikeSpin(vel.x, vel.z, spinY, p);
  const launch = (yaw: number, elev: number) => {
    const vel = direction(fx, fz, yaw, elev, speed);
    return { vel, spin: spinFor(vel) };
  };
  const solveAim = (fixedElev?: number) =>
    solve(target, start, launch, 0, guessElevation(dist, target.y, speed, p), 1e-4, 0.2, 1.2, p, maxElev, fixedElev);
  let { a: yaw, elev } = solveAim();
  const cap = lowShotMaxElevation(target.y, speed, p);
  if (elev > cap) ({ a: yaw, elev } = solveAim(cap));
  return { start, fx, fz, yaw, elev, speed, spin: spinFor(direction(fx, fz, yaw, elev, speed)) };
}

/**
 * A chip (SPEC §3.1): scooped up steeply with backspin and floated onto the
 * aim point. Power sets how driven it is: soft is a steep, floating Panenka
 * (45°), hard a flatter, quicker lob (28°). The pace is whatever carries the
 * ball to the aimed height at the goal line at that angle.
 */
function chipLaunch(spot: { x: number; z: number }, target: { x: number; y: number }, power: number, p: SimParams): LaunchState {
  const { start, fx, fz } = frameToward(spot, target.x);
  const elev = ((p.chipElevMaxDeg + (p.chipElevMinDeg - p.chipElevMaxDeg) * clamp(power, 0, 1)) * Math.PI) / 180;
  // Backspin: axis −(ŷ × d), so the Magnus force lifts and the ball floats.
  const spin = v3(-fz * p.chipBackspin, 0, fx * p.chipBackspin);
  // On a launch this steep, a faster ball is higher as it crosses the line: bisect for the aimed height.
  let lo = 4;
  let hi = p.maxSpeed;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const c = flyToPlane(start, direction(fx, fz, 0, elev, mid), spin, p, 0);
    if (!c || c.y < target.y) lo = mid;
    else hi = mid;
  }
  return { pos: start, vel: direction(fx, fz, 0, elev, hi), spin };
}

/**
 * Execution error (SPEC §3.1): no strike comes off the foot exactly as meant.
 * Studies of free kicks find players must hold the launch angles within about
 * 3° to hit a 1 m² target from 20 m; here the spread grows with power and
 * spin, so a well-drawn shot placed safely inside the frame nearly always
 * goes in, one shaved right into the corner sometimes misses, and a blast is
 * wilder than a placed shot (and the outside of the boot wilder than the
 * inside). `rand` is the server's seeded source, so every
 * client replays the same result.
 */
export function applyStrikeError(launch: LaunchState, input: KickInput, rand: () => number, p: SimParams): LaunchState {
  const power = clamp(input.p, 0, 1);
  const curl = Math.min(1, Math.abs(launch.spin.y) / p.maxSpin);
  const outside = isTrivela(launch.spin.y, p) ? p.trivelaErrorScale : 1;
  const sigma = ((p.aimErrorBaseDeg + p.aimErrorPowerDeg * power * power + p.aimErrorCurlDeg * curl) * outside * Math.PI) / 180;
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand());
  const dYaw = normal() * sigma;
  const dElev = normal() * sigma * p.aimErrorVerticalScale;
  const v = launch.vel;
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const h = Math.sqrt(v.x * v.x + v.z * v.z);
  const heading = Math.atan2(v.x, v.z) + dYaw;
  const elev = Math.atan2(v.y, h) + dElev;
  const hs = Math.cos(elev) * speed;
  const k = 1 + normal() * p.spinErrorFrac;
  const s = launch.spin;
  // The spin axis turns with the heading, so topspin stays topspin.
  const c = Math.cos(dYaw);
  const sn = Math.sin(dYaw);
  return {
    pos: launch.pos,
    vel: v3(Math.sin(heading) * hs, Math.sin(elev) * speed, Math.cos(heading) * hs),
    spin: v3((s.x * c + s.z * sn) * k, s.y * k, (s.z * c - s.x * sn) * k),
  };
}

/**
 * The input that strikes with a given curl (−1 … 1 of maxSpin; positive bends
 * left) and lands on (x, y): solves the start line for that spin. Used by the
 * AI, the tuning checks and the harness, which think in curl rather than in
 * start lines.
 */
export function kickInputForTarget(
  spot: { x: number; z: number },
  x: number,
  y: number,
  power: number,
  curl: number,
  p: SimParams,
  limits: LaunchLimits = FREE_KICK_LIMITS,
): KickInput {
  const pw = clamp(power, 0, 1);
  const target = targetFromInput({ x, y, p: pw, sx: x, durMs: 0 }, limits);
  const spinY = clamp(curl, -1, 1) * p.maxSpin;
  if (spinY === 0) return { x, y, p: pw, sx: target.x, durMs: 150 };
  const { start, fx, fz, yaw } = aimWithSpin(spot, target, speedFromPower(pw, p), spinY, p, limits.maxElevation);
  const d = direction(fx, fz, yaw, 0, 1);
  return { x, y, p: pw, sx: start.x + (d.x * -start.z) / d.z, durMs: 150 };
}
