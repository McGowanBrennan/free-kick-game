// Deterministic kick simulation (SPEC §4). The per-tick step uses only
// + − × ÷ and Math.sqrt so server (V8) and clients (JavaScriptCore) agree bit for bit.

import { ballAccel, flyToPlane } from './ball';
import { closestOnSegment, sweepCapsule } from './collide';
import {
  BALL_RADIUS,
  BAR_Y,
  DT,
  GOAL_CROSS_Z,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  KEEPER_Z,
  MAX_SIM_TICKS,
  NET_DEPTH,
  POST_RADIUS,
  POST_X,
  WALL_PLAYER_HEIGHT,
  WALL_PLAYER_RADIUS,
} from './geometry';
import type { KeeperInput } from './input';
import { HAND_PARTS, KeeperSim, planKeeper, type KeeperPart, type PartKind } from './keeper';
import type { LaunchState } from './launch';
import { DEFAULT_PARAMS, type SimParams } from './params';
import type { Spot } from './spots';
import { wallJumpY, wallLayout, type WallConfig, type WallLayout } from './wall';
import {
  add,
  addScaled,
  distance,
  dot,
  length,
  lerp,
  lerpNum,
  normalize,
  scale,
  sub,
  v3,
  type Vec3,
} from './vec';

export interface KickSetup {
  spot: Spot;
  wall: WallConfig | null;
}

export type Outcome = 'goal' | 'save' | 'blocked' | 'miss';
export type OutcomeTag =
  | 'clean'
  | 'off_post'
  | 'off_bar'
  | 'keeper_spill'
  | 'deflection'
  | 'caught'
  | 'parried'
  | 'tipped_wide'
  | 'tipped_over'
  | 'wall'
  | 'wide'
  | 'over'
  | 'woodwork_out'
  | 'short';

type ColliderKind = 'post' | 'bar' | 'wall' | 'keeper';

export interface SimEvent {
  tick: number;
  kind: ColliderKind | 'ground' | 'goal';
  detail?: string;
  /** Relative impact speed */
  speed: number;
  pos: Vec3;
}

export interface PlaneCrossing {
  tick: number;
  x: number;
  y: number;
}

export interface SimFrames {
  /** Ball position per tick, xyz interleaved, ticks 0 … result.ticks */
  ball: Float64Array;
  keeper: KeeperPart[][];
  wallY: Float64Array;
}

export interface SimResult {
  outcome: Outcome;
  tag: OutcomeTag;
  ticks: number;
  goalTick: number | null;
  events: SimEvent[];
  /** Where the ball first crossed the goal-line plane (z = 0) */
  lineCrossing: PlaneCrossing | null;
  /** Where the ball first crossed the keeper's plane */
  keeperCrossing: PlaneCrossing | null;
  wall: WallLayout | null;
  hash: number;
  frames?: SimFrames;
}

export interface SimOptions {
  record?: boolean;
  /** Leave the keeper out entirely (used to predict the ball's path) */
  noKeeper?: boolean;
}

interface Collider {
  kind: ColliderKind;
  part?: PartKind;
  a: Vec3;
  b: Vec3;
  r: number;
  va: Vec3;
  vb: Vec3;
}

type EndReason = 'exit' | 'caught' | 'away' | 'stopped' | 'out' | 'net';

const ZERO = v3();
const GROUND_BOUNCE_MIN = 0.8;
const NET_TICKS = 144;
const OUTCOMES: Outcome[] = ['goal', 'save', 'blocked', 'miss'];

const FRAME: Collider[] = [
  { kind: 'post', a: v3(-POST_X, -1, 0), b: v3(-POST_X, BAR_Y, 0), r: POST_RADIUS, va: ZERO, vb: ZERO },
  { kind: 'post', a: v3(POST_X, -1, 0), b: v3(POST_X, BAR_Y, 0), r: POST_RADIUS, va: ZERO, vb: ZERO },
  { kind: 'bar', a: v3(-POST_X, BAR_Y, 0), b: v3(POST_X, BAR_Y, 0), r: POST_RADIUS, va: ZERO, vb: ZERO },
];

/** Reflect the velocity relative to a surface moving at u. */
function reflect(vel: Vec3, n: Vec3, u: Vec3, restitution: number, tangentKeep: number): Vec3 {
  const rel = sub(vel, u);
  const vn = dot(rel, n);
  if (vn >= 0) return vel;
  const vt = addScaled(rel, n, -vn);
  return add(add(scale(n, -vn * restitution), scale(vt, tangentKeep)), u);
}

/** Tick at which the ball in free flight reaches the keeper's plane (Infinity if never). */
export function ballArrivalTick(launch: LaunchState, p: SimParams): number {
  return flyToPlane(launch.pos, launch.vel, launch.spin, p, KEEPER_Z)?.tick ?? Infinity;
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
function hashNum(h: number, x: number): number {
  f64[0] = x;
  h = Math.imul(h ^ u32[0], 16777619) >>> 0;
  return Math.imul(h ^ u32[1], 16777619) >>> 0;
}

export function simulateKick(
  setup: KickSetup,
  launch: LaunchState,
  keeperInput: KeeperInput | null,
  p: SimParams = DEFAULT_PARAMS,
  opts: SimOptions = {},
): SimResult {
  const r = BALL_RADIUS;
  let pos = launch.pos;
  let vel = launch.vel;
  let spin = launch.spin;
  let rolling = false;

  const wall =
    setup.wall && setup.spot.maxWall > 0 && setup.wall.size > 0 ? wallLayout(setup.spot, setup.wall) : null;
  const keeper = opts.noKeeper
    ? null
    : new KeeperSim(planKeeper(keeperInput, setup.spot.keeperX, p), setup.spot.keeperX, p, ballArrivalTick(launch, p));
  let keeperParts: KeeperPart[] = keeper ? keeper.partsAt(0) : [];

  const events: SimEvent[] = [];
  let keeperTouched = false;
  let wallTouched = false;
  let lastWoodwork: 'post' | 'bar' | null = null;
  let goalTick: number | null = null;
  let end = null as EndReason | null;
  let exitOver = false;
  let lineCrossing: PlaneCrossing | null = null;
  let keeperCrossing: PlaneCrossing | null = null;
  let hash = 2166136261;

  const ballFrames: number[] = [];
  const keeperFrames: KeeperPart[][] = [];
  const wallFrames: number[] = [];
  const record = (wallY: number) => {
    if (!opts.record) return;
    ballFrames.push(pos.x, pos.y, pos.z);
    keeperFrames.push(keeperParts);
    wallFrames.push(wallY);
  };
  record(0);

  let tick = 0;
  // Contact handling for the collider c with normal n (pointing at the ball) moving at u.
  const contact = (c: Collider, n: Vec3, u: Vec3): void => {
    const rel = sub(vel, u);
    const vn = dot(rel, n);
    if (vn >= 0) return;
    const relSpeed = length(rel);
    let detail: string | undefined;
    if (c.kind === 'post' || c.kind === 'bar') {
      vel = reflect(vel, n, u, p.postRestitution, p.postTangential);
      spin = scale(spin, p.postSpinRetain);
      lastWoodwork = c.kind;
    } else if (c.kind === 'wall') {
      vel = reflect(vel, n, u, p.wallRestitution, p.wallTangential);
      spin = scale(spin, 0.5);
      wallTouched = true;
    } else {
      detail = c.part;
      if (!keeperTouched && keeper) {
        const glance = 1 - -vn / relSpeed; // 0 head-on … 1 grazing
        const limb = c.part === 'hand' || c.part === 'arm';
        const handsGap = distance(keeperParts[HAND_PARTS[0]].a, keeperParts[HAND_PARTS[1]].a);
        const catchable =
          relSpeed < p.catchMaxSpeed &&
          keeper.stretchAt(tick) < p.catchMaxStretch &&
          glance < p.weakGlancing &&
          (c.part === 'torso' || (limb && handsGap <= 0.25));
        if (catchable) {
          vel = u;
          end = 'caught';
          detail += ' catch';
        } else if (limb && glance > p.weakGlancing) {
          const keep = lerpNum(p.weakKeepMin, p.weakKeepMax, (glance - p.weakGlancing) / (1 - p.weakGlancing));
          const inDir = scale(rel, 1 / relSpeed);
          const outDir = normalize(sub(reflect(vel, n, u, p.parryRestitution, 1), u));
          let dir = normalize(lerp(inDir, outDir, p.weakDeflect));
          const into = dot(dir, n);
          if (into < 0) dir = normalize(addScaled(dir, n, -into));
          vel = add(scale(dir, relSpeed * keep), u);
          detail += ' weak';
        } else {
          vel = reflect(vel, n, u, p.parryRestitution, p.parryTangential);
          detail += ' firm';
        }
      } else {
        vel = reflect(vel, n, u, p.parryRestitution, 0.7);
      }
      spin = scale(spin, 0.3);
      keeperTouched = true;
    }
    events.push({ tick, kind: c.kind, detail, speed: relSpeed, pos });
  };

  while (tick < MAX_SIM_TICKS && end === null) {
    tick++;
    const prevPos = pos;

    if (goalTick !== null) {
      // In the net: visual only, the outcome is already decided.
      vel = v3(vel.x * 0.96, vel.y * 0.98 - p.gravity * DT, vel.z * 0.96);
      pos = addScaled(pos, vel, DT);
      if (pos.z < -NET_DEPTH + r) {
        pos = v3(pos.x, pos.y, -NET_DEPTH + r);
        vel = v3(vel.x, vel.y, Math.abs(vel.z) * 0.1);
      }
      if (Math.abs(pos.x) > GOAL_HALF_WIDTH - r) {
        const sx = pos.x > 0 ? 1 : -1;
        pos = v3(sx * (GOAL_HALF_WIDTH - r), pos.y, pos.z);
        vel = v3(-vel.x * 0.1, vel.y, vel.z);
      }
      if (pos.y > GOAL_HEIGHT - r) {
        pos = v3(pos.x, GOAL_HEIGHT - r, pos.z);
        vel = v3(vel.x, Math.min(vel.y, 0), vel.z);
      }
      if (pos.y < r) {
        pos = v3(pos.x, r, pos.z);
        vel = v3(vel.x, Math.abs(vel.y) * 0.3, vel.z);
      }
      if (tick - goalTick >= NET_TICKS) end = 'net';
      hash = hashNum(hashNum(hashNum(hash, pos.x), pos.y), pos.z);
      record(wall ? wallJumpY(tick * DT, p) : 0);
      continue;
    }

    const prevParts = keeperParts;
    if (keeper) keeperParts = keeper.step(tick, pos, vel);
    const wallY0 = wall ? wallJumpY((tick - 1) * DT, p) : 0;
    const wallY1 = wall ? wallJumpY(tick * DT, p) : 0;

    // Forces: gravity, drag, Magnus.
    const acc = ballAccel(vel, spin, p);
    let ax = acc.x;
    let ay = acc.y;
    let az = acc.z;
    if (rolling) {
      ay = 0;
      const hs = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (hs > 1e-6) {
        const dec = Math.min(p.rollDecel, hs / DT);
        ax -= (dec * vel.x) / hs;
        az -= (dec * vel.z) / hs;
      }
    }
    vel = v3(vel.x + ax * DT, vel.y + ay * DT, vel.z + az * DT);
    spin = scale(spin, rolling ? p.rollSpinDecayPerTick : p.spinDecayPerTick);

    // Colliders at the start of the tick, with their velocity over it.
    const colliders: Collider[] = FRAME.slice();
    if (wall) {
      const wv = v3(0, (wallY1 - wallY0) / DT, 0);
      for (const w of wall.players) {
        colliders.push({
          kind: 'wall',
          a: v3(w.x, WALL_PLAYER_RADIUS + wallY0, w.z),
          b: v3(w.x, WALL_PLAYER_HEIGHT - WALL_PLAYER_RADIUS + wallY0, w.z),
          r: WALL_PLAYER_RADIUS,
          va: wv,
          vb: wv,
        });
      }
    }
    if (keeper) {
      for (let i = 0; i < keeperParts.length; i++) {
        const prev = prevParts[i];
        const cur = keeperParts[i];
        colliders.push({
          kind: 'keeper',
          part: cur.kind,
          a: prev.a,
          b: prev.b,
          r: cur.r,
          va: scale(sub(cur.a, prev.a), 1 / DT),
          vb: scale(sub(cur.b, prev.b), 1 / DT),
        });
      }
    }

    // 1. Push out of anything that moved into the ball.
    for (const c of colliders) {
      const R = c.r + r;
      const { point, s } = closestOnSegment(pos, c.a, c.b);
      const dv = sub(pos, point);
      const dist = length(dv);
      if (dist < R) {
        const n = dist > 1e-9 ? scale(dv, 1 / dist) : v3(0, 0, 1);
        pos = addScaled(point, n, R);
        contact(c, n, lerp(c.va, c.vb, s));
        if (end !== null) break;
      }
    }

    // 2. Sweep to the earliest contact this tick.
    if (end === null) {
      const d = scale(vel, DT);
      let bestT = 2;
      let best: Collider | null = null;
      for (const c of colliders) {
        const u = scale(add(c.va, c.vb), 0.5 * DT);
        const t = sweepCapsule(pos, sub(d, u), c.a, c.b, c.r + r);
        if (t >= 0 && t < bestT) {
          bestT = t;
          best = c;
        }
      }
      if (best) {
        const hitPos = addScaled(pos, d, bestT);
        const aT = addScaled(best.a, best.va, DT * bestT);
        const bT = addScaled(best.b, best.vb, DT * bestT);
        const { point, s } = closestOnSegment(hitPos, aT, bT);
        pos = hitPos;
        contact(best, normalize(sub(hitPos, point)), lerp(best.va, best.vb, s));
        if (end === null) pos = addScaled(pos, vel, DT * (1 - bestT));
      } else {
        pos = add(pos, d);
      }
    }

    // 3. Ground.
    if (pos.y < r) {
      pos = v3(pos.x, r, pos.z);
      if (vel.y < -GROUND_BOUNCE_MIN) {
        events.push({ tick, kind: 'ground', speed: -vel.y, pos });
        vel = v3(vel.x * p.groundTangential, -vel.y * p.groundRestitution, vel.z * p.groundTangential);
        spin = scale(spin, 0.8);
      } else if (vel.y < 0) {
        vel = v3(vel.x, 0, vel.z);
        rolling = true;
      }
    }
    if (rolling && (pos.y > r + 1e-3 || vel.y > 0.05)) rolling = false;

    // 4. Plane crossings.
    if (!keeperCrossing && prevPos.z > KEEPER_Z && pos.z <= KEEPER_Z) {
      const f = (prevPos.z - KEEPER_Z) / (prevPos.z - pos.z);
      keeperCrossing = { tick, x: lerpNum(prevPos.x, pos.x, f), y: lerpNum(prevPos.y, pos.y, f) };
    }
    if (!lineCrossing && prevPos.z > 0 && pos.z <= 0) {
      const f = prevPos.z / (prevPos.z - pos.z);
      lineCrossing = { tick, x: lerpNum(prevPos.x, pos.x, f), y: lerpNum(prevPos.y, pos.y, f) };
    }
    if (end === null && prevPos.z > GOAL_CROSS_Z && pos.z <= GOAL_CROSS_Z) {
      const f = (prevPos.z - GOAL_CROSS_Z) / (prevPos.z - pos.z);
      const cx = lerpNum(prevPos.x, pos.x, f);
      const cy = lerpNum(prevPos.y, pos.y, f);
      if (Math.abs(cx) < POST_X && cy < BAR_Y) {
        goalTick = tick;
        events.push({ tick, kind: 'goal', speed: length(vel), pos });
      } else {
        end = 'exit';
        exitOver = cy >= BAR_Y && Math.abs(cx) < POST_X + 0.5;
      }
    }

    // 5. Other ways the kick is over.
    if (end === null && goalTick === null) {
      const touched = keeperTouched || wallTouched || lastWoodwork !== null;
      if (touched && vel.z > 0.5 && pos.z > 1) end = 'away';
      else if (rolling && length(vel) < 0.3) end = 'stopped';
      else if (Math.abs(pos.x) > 40 || pos.z > 60 || pos.z < -NET_DEPTH - 1) end = 'out';
    }

    hash = hashNum(hashNum(hashNum(hash, pos.x), pos.y), pos.z);
    record(wallY1);
  }

  let outcome: Outcome;
  let tag: OutcomeTag;
  if (goalTick !== null) {
    outcome = 'goal';
    tag = keeperTouched
      ? 'keeper_spill'
      : lastWoodwork === 'bar'
        ? 'off_bar'
        : lastWoodwork === 'post'
          ? 'off_post'
          : wallTouched
            ? 'deflection'
            : 'clean';
  } else if (end === 'caught') {
    outcome = 'save';
    tag = 'caught';
  } else if (keeperTouched) {
    outcome = 'save';
    tag = end === 'exit' ? (exitOver ? 'tipped_over' : 'tipped_wide') : 'parried';
  } else if (wallTouched) {
    outcome = 'blocked';
    tag = 'wall';
  } else if (lastWoodwork !== null) {
    outcome = 'miss';
    tag = 'woodwork_out';
  } else {
    outcome = 'miss';
    tag = end === 'exit' ? (exitOver ? 'over' : 'wide') : 'short';
  }
  hash = hashNum(hash, OUTCOMES.indexOf(outcome));

  return {
    outcome,
    tag,
    ticks: tick,
    goalTick,
    events,
    lineCrossing,
    keeperCrossing,
    wall,
    hash,
    frames: opts.record
      ? { ball: Float64Array.from(ballFrames), keeper: keeperFrames, wallY: Float64Array.from(wallFrames) }
      : undefined,
  };
}
