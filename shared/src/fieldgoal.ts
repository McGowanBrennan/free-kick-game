// Field goals (SPEC §15): kick it over the crossbar and between the uprights,
// from the hash marks, against the wind, over the rush and round the cable
// cam. The kicker's swipe calls for the snap; the ball is snapped and held 7
// yards behind the line and kicked a fixed operation time later. Defenders
// jump at the line with their arms up (a low kick is blocked), and from round
// 2 the broadcast's cable cam swings across the field in the ball's path. The
// per-tick step follows the same determinism rules as the free-kick sim (only
// + − × ÷, floor and sqrt).

import type { AiProfile } from './ai';
import { gaussian } from './ai';
import { ballAccel } from './ball';
import { closestOnSegment, sweepCapsule } from './collide';
import { BALL_RADIUS, DT, MAX_SIM_TICKS } from './geometry';
import type { KickInput } from './input';
import { computeLaunch, kickInputForTarget, powerForSpeed, type LaunchLimits, type LaunchState } from './launch';
import type { SimParams } from './params';
import type { PlaneCrossing, SimEvent } from './sim';
import { makeSpot, type Spot } from './spots';
import { add, addScaled, clamp, dot, length, lerpNum, normalize, scale, sub, v3, type Vec3 } from './vec';

/** Inner edge of each upright (18 ft 6 in apart). */
export const FG_HALF_WIDTH = 2.82;
/** Top of the crossbar (10 ft). */
export const FG_BAR_Y = 3.05;
/** Uprights stand 35 ft above the bar. */
export const FG_UPRIGHT_TOP = FG_BAR_Y + 10.67;
export const FG_POST_RADIUS = 0.06;
/** The gooseneck rises behind the bar and bends forward to hold it. */
export const FG_NECK_Z = -1.2;
const NECK_RADIUS = 0.1;
export const NECK_ARM_Y = FG_BAR_Y - 0.25;
const UPRIGHT_X = FG_HALF_WIDTH + FG_POST_RADIUS;

/** Field goals are aimed high and may be struck steeply (≈ 54°). */
export const FIELD_GOAL_LIMITS: LaunchLimits = { maxAimY: 20, maxElevation: 0.95 };

export interface FieldGoalSetup {
  spot: Spot;
  /** Horizontal wind, m/s (blows the ball: drag and lift act on the air speed) */
  wind: Vec3;
  /** Operation time: seconds from the snap to the kick (real kickers aim for ≈ 1.3 s) */
  opTime: number;
  /** The cable cam over the field this round, if there is one */
  cam?: CableCam | null;
  /** Where the cam is in its swing at contact: seconds on the round's clock */
  clock?: number;
}

export type FieldGoalTag = 'good' | 'doink_in' | 'wide_left' | 'wide_right' | 'short' | 'doink_out' | 'blocked' | 'cam';

// ── The cable cam ──────────────────────────────────────────────────────────

/**
 * The broadcast's camera on wires, flying low for the shot: it swings from
 * side to side across the field at a fixed height and distance, easing at
 * each end.
 */
export interface CableCam {
  /** Middle of its swing (x), distance from the posts (z) and height (y), m */
  x: number;
  z: number;
  y: number;
  /** Half the swing, m, and seconds for a full there-and-back */
  amp: number;
  period: number;
}

/** The pod is a capsule across the field: this half-length and radius, m. */
export const CAM_HALF = 0.5;
export const CAM_RADIUS = 0.5;

/** The cam's position `t` seconds into the round. */
export function cableCamAt(cam: CableCam, t: number): Vec3 {
  const u = t / cam.period - Math.floor(t / cam.period);
  // A triangle wave, eased at the ends (no trig: it's part of the sim).
  const tri = u < 0.5 ? 4 * u - 1 : 3 - 4 * u;
  const s = tri * (1.5 - 0.5 * tri * tri);
  return v3(cam.x + cam.amp * s, cam.y, cam.z);
}

// ── The snap, the hold and the rush ────────────────────────────────────────

/** The line of scrimmage is 7 yards in front of the hold. */
export const LOS_DISTANCE = 6.4;
/** When the holder has the ball down, seconds after the snap. */
export const HOLD_TIME = 0.55;
/** The kicker's two-step approach, from the hold to contact. */
export const APPROACH_TIME = 0.6;
/** Snap to kick: the swipe calls for the snap, and the ball's away this long after (real units aim for ≈ 1.3 s). */
export const FG_OP_TIME = HOLD_TIME + APPROACH_TIME + 0.1;
/** Defenders on the line, by lateral offset from the kick line (m); the outside pair rush off the edge. */
const RUSHERS = [-4.6, -2.3, -0.9, 0, 0.9, 2.3, 4.6];
export const RUSHER_COUNT = RUSHERS.length;
const EDGE = 3;

/**
 * Each man in the middle reads the snap his own way: when he leaves the
 * ground (s after the snap) and how high he gets (m). They peak around when
 * a kick crosses the line (≈ 1.55–1.65 s), not all at once.
 */
const JUMPS: Record<number, [number, number]> = {
  1: [1.12, 0.52],
  2: [1.22, 0.68],
  3: [1.27, 0.6],
  4: [1.18, 0.7],
  5: [1.3, 0.48],
};
const G = 9.81;
/** Standing body: pelvis height, pelvis to shoulders, and how far the hands reach above the shoulders with the arms up (elbows soft). */
export const RUSH_PELVIS_Y = 0.97;
export const RUSH_SHOULDER = 0.48;
export const RUSH_REACH = 0.56;
/** Edge rushers: acceleration, top speed (m/s), and where they're headed: just in front of the kick point. */
const EDGE_ACCEL = 6.5;
const EDGE_TOP = 7.2;
const EDGE_END_FWD = 1.4;

export interface RusherState {
  /** Across the kick line (+ = the kicker's right) and forward from the hold toward the posts, m */
  lat: number;
  fwd: number;
  /** Height of the hands, how far the feet are off the ground, and how far the hips have sunk (loading or landing), m */
  armTop: number;
  lift: number;
  crouch: number;
  /** Arms: 0 = hands on the blocker at chest height, 1 = straight up */
  armUp: number;
  /** Edge rushers: distance run (m) and speed (m/s), for the stride */
  run: number;
  speed: number;
  edge: boolean;
}

const smooth01 = (x: number) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/**
 * Rusher i, τ seconds after the snap. The middle of the line is held up by
 * the blockers: they fight into them for a step, then each loads and jumps
 * (a real jump: up, over the top, down, and absorbing the landing), arms
 * going up as he leaves the ground. The edges come off a stance,
 * accelerating round the end at the kick point, and get there after the
 * ball's gone (≈ 1.7 s).
 */
export function rusherAt(i: number, tau: number): RusherState {
  const lat0 = RUSHERS[i];
  const edge = Math.abs(lat0) > EDGE;
  const t = Math.max(0, tau - 0.1);
  if (!edge) {
    const fwd = LOS_DISTANCE + 0.55 - Math.min(0.9, 0.7 * t);
    const [t0, h] = JUMPS[i];
    const v0 = Math.sqrt(2 * G * h);
    const air = (2 * v0) / G;
    const dt = tau - t0;
    const lift = dt > 0 && dt < air ? v0 * dt - 0.5 * G * dt * dt : 0;
    // Hips sink to load the jump, and again to soak up the landing; set low before the snap.
    const load = dt > -0.22 && dt <= 0 ? 0.14 * smooth01((dt + 0.22) / 0.16) : 0;
    const land = dt >= air && dt < air + 0.45 ? 0.16 * (1 - smooth01((dt - air - 0.08) / 0.37)) * smooth01((dt - air) / 0.06) : 0;
    const stance = tau < 0.05 ? 0.22 : 0.22 * (1 - smooth01((tau - 0.05) / 0.25));
    const crouch = Math.max(load, land, stance);
    const armUp = smooth01((dt + 0.3) / 0.38) * (1 - smooth01((dt - air - 0.35) / 0.5));
    const shoulder = RUSH_PELVIS_Y - crouch + lift + RUSH_SHOULDER;
    const armTop = shoulder - 0.15 + (RUSH_REACH + 0.15) * armUp + 0.05;
    return { lat: lat0, fwd, armTop, lift, crouch, armUp, run: 0, speed: 0, edge };
  }
  // Off the edge: accelerate, then flat out, along a straight line at the kick point.
  const side = lat0 > 0 ? 1 : -1;
  const dl = side * 0.2 - lat0;
  const df = EDGE_END_FWD - LOS_DISTANCE - 0.55;
  const len = Math.sqrt(dl * dl + df * df);
  const tAcc = EDGE_TOP / EDGE_ACCEL;
  const run0 = t < tAcc ? 0.5 * EDGE_ACCEL * t * t : 0.5 * EDGE_ACCEL * tAcc * tAcc + EDGE_TOP * (t - tAcc);
  const run = run0 < len ? run0 : len;
  const speed = run0 >= len ? 0 : t < tAcc ? EDGE_ACCEL * t : EDGE_TOP;
  const u = run / len;
  const crouch = tau < 0.05 ? 0.3 : 0.3 * (1 - smooth01((tau - 0.05) / 0.35));
  return {
    lat: lat0 + dl * u,
    fwd: LOS_DISTANCE + 0.55 + df * u,
    armTop: RUSH_PELVIS_Y - crouch + RUSH_SHOULDER + 0.1,
    lift: 0,
    crouch,
    armUp: 0,
    run,
    speed,
    edge,
  };
}

/** The world position of a point (lat, fwd) in the kick's frame. */
export function kickFrame(spot: Spot, lat: number, fwd: number): { x: number; z: number } {
  const fx = -spot.x / spot.distance;
  const fz = -spot.z / spot.distance;
  return { x: spot.x + fx * fwd - fz * lat, z: spot.z + fz * fwd + fx * lat };
}

const RUSHER_BODY = 0.3;

export interface FieldGoalResult {
  good: boolean;
  tag: FieldGoalTag;
  /** Last simulated tick (the kick is decided by then, with a moment of flight after) */
  ticks: number;
  /** When it was decided (through, off the woodwork, blocked, down short…) */
  decidedTick: number;
  events: SimEvent[];
  /** Where the ball crossed the plane of the posts, if it did */
  crossing: PlaneCrossing | null;
  hash: number;
  frames?: { ball: Float64Array };
}

interface Bar {
  kind: 'post' | 'bar' | 'rusher' | 'cam';
  a: Vec3;
  b: Vec3;
  r: number;
}

const POSTS: Bar[] = [
  { kind: 'post', a: v3(-UPRIGHT_X, FG_BAR_Y, 0), b: v3(-UPRIGHT_X, FG_UPRIGHT_TOP, 0), r: FG_POST_RADIUS },
  { kind: 'post', a: v3(UPRIGHT_X, FG_BAR_Y, 0), b: v3(UPRIGHT_X, FG_UPRIGHT_TOP, 0), r: FG_POST_RADIUS },
  { kind: 'bar', a: v3(-UPRIGHT_X, FG_BAR_Y, 0), b: v3(UPRIGHT_X, FG_BAR_Y, 0), r: FG_POST_RADIUS },
  // The gooseneck's arm runs under the bar, so a kick just over the middle clears it.
  { kind: 'post', a: v3(0, NECK_ARM_Y, 0), b: v3(0, NECK_ARM_Y, FG_NECK_Z), r: NECK_RADIUS },
  { kind: 'post', a: v3(0, 0, FG_NECK_Z), b: v3(0, NECK_ARM_Y, FG_NECK_Z), r: NECK_RADIUS },
];

/** Ticks of flight kept after the kick is decided (it sails on into the stand, or bounces back). */
const AFTER_TICKS = 72;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
function hashNum(h: number, x: number): number {
  f64[0] = x;
  h = Math.imul(h ^ u32[0], 16777619) >>> 0;
  return Math.imul(h ^ u32[1], 16777619) >>> 0;
}

function bounce(vel: Vec3, n: Vec3, restitution: number, tangentKeep: number): Vec3 {
  const vn = dot(vel, n);
  if (vn >= 0) return vel;
  const vt = addScaled(vel, n, -vn);
  return add(scale(n, -vn * restitution), scale(vt, tangentKeep));
}

/** The launch for a field goal: the free-kick model with the field goal's limits. */
export function fieldGoalLaunch(spot: Spot, input: KickInput, p: SimParams): LaunchState {
  return computeLaunch(spot, input, p, FIELD_GOAL_LIMITS);
}

export function simulateFieldGoal(
  setup: FieldGoalSetup,
  launch: LaunchState,
  p: SimParams,
  opts: { record?: boolean; noRush?: boolean } = {},
): FieldGoalResult {
  const r = BALL_RADIUS;
  const wind = setup.wind;
  let pos = launch.pos;
  let vel = launch.vel;
  let spin = launch.spin;
  let rolling = false;
  let hit = false;
  let decided: FieldGoalTag | null = null;
  let decidedTick = 0;
  let crossing: PlaneCrossing | null = null;
  const events: SimEvent[] = [];
  let blocked = false;
  let hash = 2166136261;
  const frames: number[] = [];
  const record = () => {
    if (opts.record) frames.push(pos.x, pos.y, pos.z);
  };
  record();

  let tick = 0;
  while (tick < MAX_SIM_TICKS && (decided === null || tick - decidedTick < AFTER_TICKS)) {
    tick++;
    const prev = pos;
    // Drag and lift act on the ball's speed through the air.
    const acc = ballAccel(sub(vel, wind), spin, p);
    if (rolling) {
      const hs = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      const dec = hs > 1e-6 ? Math.min(p.rollDecel, hs / DT) / hs : 0;
      vel = v3(vel.x - vel.x * dec * DT, 0, vel.z - vel.z * dec * DT);
    } else {
      vel = v3(vel.x + acc.x * DT, vel.y + acc.y * DT, vel.z + acc.z * DT);
    }
    spin = scale(spin, rolling ? p.rollSpinDecayPerTick : p.spinDecayPerTick);

    // The rush: each defender is a capsule from the waist to the hands this tick.
    const tau = setup.opTime + tick * DT;
    const bars: Bar[] = POSTS.slice();
    if (!opts.noRush && !blocked && decided === null) {
      for (let i = 0; i < RUSHER_COUNT; i++) {
        const rs = rusherAt(i, tau);
        const at = kickFrame(setup.spot, rs.lat, rs.fwd);
        // Waist to fingertips (the capsule's cap reaches just past the hands).
        bars.push({ kind: 'rusher', a: v3(at.x, 0.6 + rs.lift, at.z), b: v3(at.x, rs.armTop - RUSHER_BODY + 0.05, at.z), r: RUSHER_BODY });
      }
    }
    if (setup.cam && decided === null) {
      const c = cableCamAt(setup.cam, (setup.clock ?? 0) + tick * DT);
      bars.push({ kind: 'cam', a: v3(c.x - CAM_HALF, c.y, c.z), b: v3(c.x + CAM_HALF, c.y, c.z), r: CAM_RADIUS });
    }
    // Uprights, crossbar, gooseneck and rushers: sweep to the earliest contact this tick.
    const d = scale(vel, DT);
    let bestT = 2;
    let best: Bar | null = null;
    for (const c of bars) {
      const t = sweepCapsule(pos, d, c.a, c.b, c.r + r);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = c;
      }
    }
    if (best) {
      const at = addScaled(pos, d, bestT);
      const n = normalize(sub(at, closestOnSegment(at, best.a, best.b).point));
      const speed = length(vel);
      if (best.kind === 'rusher') {
        // Got a hand to it: knocked down, and the kick is no good.
        vel = bounce(vel, n, 0.3, 0.4);
        spin = scale(spin, 0.2);
        events.push({ tick, kind: 'wall', detail: 'block', speed, pos: at });
        blocked = true;
        decided = 'blocked';
        decidedTick = tick;
      } else if (best.kind === 'cam') {
        // Clattered the camera: knocked out of the sky, no good.
        vel = bounce(vel, n, 0.45, 0.6);
        spin = scale(spin, 0.3);
        events.push({ tick, kind: 'post', detail: 'cam', speed, pos: at });
        decided = 'cam';
        decidedTick = tick;
      } else {
        vel = bounce(vel, n, p.postRestitution, p.postTangential);
        spin = scale(spin, p.postSpinRetain);
        events.push({ tick, kind: best.kind, speed, pos: at });
        hit = true;
      }
      pos = addScaled(at, vel, DT * (1 - bestT));
    } else {
      pos = add(pos, d);
    }

    // Ground.
    if (pos.y < r) {
      pos = v3(pos.x, r, pos.z);
      if (vel.y < -0.8) {
        events.push({ tick, kind: 'ground', speed: -vel.y, pos });
        const hs = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        const loss = Math.min(p.groundFriction * (1 + p.groundRestitution) * -vel.y, (1 - p.groundTangential) * hs);
        const keep = hs > 1e-9 ? 1 - loss / hs : 1;
        vel = v3(vel.x * keep, -vel.y * p.groundRestitution, vel.z * keep);
        if (decided === null) {
          decided = 'short';
          decidedTick = tick;
        }
      } else if (vel.y <= 0) {
        vel = v3(vel.x, 0, vel.z);
        rolling = true;
      }
    }
    if (rolling && (pos.y > r + 1e-3 || vel.y > 0.05)) rolling = false;

    // Through the plane of the posts.
    if (!crossing && prev.z > 0 && pos.z <= 0) {
      const f = prev.z / (prev.z - pos.z);
      const cx = lerpNum(prev.x, pos.x, f);
      const cy = lerpNum(prev.y, pos.y, f);
      crossing = { tick, x: cx, y: cy };
      if (decided === null) {
        decided =
          cy <= FG_BAR_Y ? 'short' : cx <= -FG_HALF_WIDTH ? 'wide_left' : cx >= FG_HALF_WIDTH ? 'wide_right' : hit ? 'doink_in' : 'good';
        decidedTick = tick;
      }
    }
    // Knocked back off the woodwork without getting through.
    if (decided === null && hit && vel.z > 0.5 && pos.z > 0.3) {
      decided = 'doink_out';
      decidedTick = tick;
    }

    hash = hashNum(hashNum(hashNum(hash, pos.x), pos.y), pos.z);
    record();
  }
  const tag = decided ?? 'short';
  const good = tag === 'good' || tag === 'doink_in';
  hash = hashNum(hash, good ? 1 : 0);
  return { good, tag, ticks: tick, decidedTick: decided === null ? tick : decidedTick, events, crossing, hash, frames: opts.record ? { ball: Float64Array.from(frames) } : undefined };
}

/** High school hash marks, splitting the field in thirds (53 ft 4 in apart): wide, so most kicks come in at a sharp angle. */
export const HASH_X = 8.13;
const YARD = 0.9144;

/**
 * The spot for a round: on the left or right hash (sometimes the middle),
 * further out each round: 30–36 yards in round 1, 54–60 by round 5, up to 63
 * in sudden death (field goal distances: 7 yards behind the line plus the end
 * zone).
 */
export function fieldGoalSpot(rand: () => number, round: number): Spot {
  const yards = Math.min(63, 24 + round * 6 + rand() * 6);
  const r = rand();
  const x = r < 0.46 ? -HASH_X : r < 0.92 ? HASH_X : 0;
  const d = yards * YARD;
  return makeSpot('field_goal', x, Math.sqrt(d * d - x * x));
}

/** The round's wind: light early, up to ~9 m/s (20 mph) later, from any direction. */
export function fieldGoalWind(rand: () => number, round: number): Vec3 {
  const speed = (0.3 + 0.7 * rand()) * Math.min(9, 2 + round * 1.5);
  const a = rand() * Math.PI * 2;
  return v3(Math.cos(a) * speed, 0, Math.sin(a) * speed);
}

/** The launch angle a kick needs to clear the jumping line, degrees (with a little margin). */
export const CLEAR_RUSH_DEG = 26;

/** The standard kick: the lowest aim over the bar that clears the rush at this power. */
function standardAimY(spot: Spot, power: number, p: SimParams): number {
  let y = FG_BAR_Y + 1.5;
  for (; y < FIELD_GOAL_LIMITS.maxAimY; y += 0.5) {
    const l = fieldGoalLaunch(spot, kickInputForTarget(spot, 0, y, power, 0, p, FIELD_GOAL_LIMITS), p);
    const deg = (Math.atan2(l.vel.y, Math.sqrt(l.vel.x * l.vel.x + l.vel.z * l.vel.z)) * 180) / Math.PI;
    if (deg >= CLEAR_RUSH_DEG + 1) break;
  }
  return y;
}

function standardPower(spot: Spot, p: SimParams): number {
  return powerForSpeed(clamp(21 + spot.distance * 0.3, 23, 35), p);
}

/**
 * The round's cable cam: none in round 1, usually one in round 2, always
 * after. It hangs across the path of a standard kick, around its height (a
 * little over or under), somewhere in the middle of the flight, and swings
 * wider and quicker in later rounds. So: go under it, over it, bend it round
 * it, or pick your moment.
 */
export function fieldGoalCam(rand: () => number, round: number, spot: Spot, p: SimParams): CableCam | null {
  const r = rand();
  if (round < 2 || (round === 2 && r < 0.3)) return null;
  const power = standardPower(spot, p);
  const y = standardAimY(spot, power, p);
  const plain = simulateFieldGoal(
    { spot, wind: v3(), opTime: FG_OP_TIME },
    fieldGoalLaunch(spot, kickInputForTarget(spot, 0, y, power, 0, p, FIELD_GOAL_LIMITS), p),
    p,
    { noRush: true, record: true },
  );
  // Where the standard kick is, 35–65% of the way.
  const f = 0.35 + rand() * 0.3;
  const zc = spot.z * (1 - f);
  const b = plain.frames!.ball;
  let k = 0;
  while (k + 5 < b.length && b[k + 2] > zc) k += 3;
  const hard = Math.min(1, (round - 2) / 4);
  return {
    x: b[k] + (rand() - 0.5) * 1.2,
    z: zc,
    y: Math.max(6.5, b[k + 1] + (rand() - 0.5) * 0.8),
    amp: 1.8 + rand() * 1.2 + hard * 1.0,
    period: 6.5 - hard * 2 + rand() * 1.2,
  };
}

/**
 * The AI kicker: the lowest aim over the bar that still clears the rush with
 * its power, allowing for the wind as well as its read lets it (curveRead).
 * With a cable cam up, it waits for a moment when the kick it means would
 * miss it (better kickers check more carefully), then kicks with its usual
 * aim and power errors. Returns the kick and the round clock at contact (no
 * sooner than `earliest`).
 */
export function aiFieldGoal(
  setup: Omit<FieldGoalSetup, 'opTime' | 'clock'>,
  profile: AiProfile,
  rand: () => number,
  p: SimParams,
  earliest = 0,
): { kick: KickInput; clock: number } {
  const { spot, cam } = setup;
  const power = clamp(standardPower(spot, p) + gaussian(rand) * profile.powerSd, 0, p.overhitThreshold);
  let y = standardAimY(spot, power, p);
  const plain = simulateFieldGoal(
    { spot, wind: setup.wind, opTime: 0 },
    fieldGoalLaunch(spot, kickInputForTarget(spot, 0, y, power, 0, p, FIELD_GOAL_LIMITS), p),
    p,
    { noRush: true },
  );
  const drift = plain.crossing ? plain.crossing.x : 0;
  const read = 0.35 + 0.55 * profile.curveRead + gaussian(rand) * 0.2;
  const meantX = clamp(-drift * read, -FG_HALF_WIDTH * 1.5, FG_HALF_WIDTH * 1.5);
  let clock = earliest + rand() * 0.6;
  if (cam) {
    // The first moment the kick as meant clears the cam with time to spare.
    const careful = rand() < 0.5 + 0.5 * profile.curveRead;
    const meant = fieldGoalLaunch(spot, kickInputForTarget(spot, meantX, y, power, 0, p, FIELD_GOAL_LIMITS), p);
    const clears = (t: number) => simulateFieldGoal({ ...setup, opTime: FG_OP_TIME, clock: t }, meant, p, { noRush: true }).tag !== 'cam';
    const step = careful ? 0.2 : 0.6;
    for (let t = clock; t < clock + cam.period; t += step) {
      if (clears(t) && (!careful || (clears(t - 0.3) && clears(t + 0.3)))) {
        clock = t;
        break;
      }
    }
  }
  y += gaussian(rand) * profile.aimSd * 0.6;
  const x = meantX + gaussian(rand) * profile.aimSd * 1.6;
  return { kick: kickInputForTarget(spot, x, y, power, 0, p, FIELD_GOAL_LIMITS), clock };
}
