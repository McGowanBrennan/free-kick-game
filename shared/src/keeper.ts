// Keeper dive planning, kinematics and hitbox (SPEC §3.2, §4.3).
// Poses are built from lerps and sqrt normalisation only, so the hitbox is
// identical on every engine.

import { DT, KEEPER_Z } from './geometry';
import { INPUT, type KeeperInput } from './input';
import type { SimParams } from './params';
import {
  addScaled,
  clamp,
  distance,
  length,
  lerp,
  lerpNum,
  normalize,
  sub,
  v3,
  type Vec3,
} from './vec';

export type KeeperMode = 'stance' | 'set' | 'dive';
export type PartKind = 'torso' | 'head' | 'arm' | 'hand' | 'leg';

export interface KeeperPart {
  kind: PartKind;
  a: Vec3;
  b: Vec3;
  r: number;
}

export interface KeeperPlan {
  /** Mode from flickTick onwards (stance before it) */
  mode: KeeperMode;
  /** Tick relative to contact; Infinity = never flicked */
  flickTick: number;
  /** Hand-centre target at full extension (dive only) */
  target: Vec3;
  /** Lateral reach of the target from the start position */
  reach: number;
  /** Seconds from end of windup to full extension */
  travel: number;
}

const STAND_PELVIS_Y = 0.95;
const TORSO_LEN = 0.5;
const BODY_TO_HANDS = 1.2;
const HEAD_OFFSET = 0.22;
const SHOULDER_HALF = 0.2;
const HIP_HALF = 0.12;
const LEG_LEN = 0.9;
const REST_HAND_Y = 1.1;
const REST_HAND_DZ = 0.18;
const REST_SPREAD = 0.42;
const TRACK_SPREAD = 0.12;
const DIVE_SPREAD = 0.1;
const TRACK_START_Z = 12;
const SIN_FLAT = 0.342; // sin 20°
const SIN_STEEP = 0.906; // sin 65°

export const KEEPER_RADII: Readonly<Record<PartKind, number>> = {
  torso: 0.18,
  head: 0.12,
  arm: 0.07,
  hand: 0.1,
  leg: 0.09,
};

const UP = v3(0, 1, 0);

function standingPelvis(startX: number): Vec3 {
  return v3(startX, STAND_PELVIS_Y, KEEPER_Z);
}

function divePelvisEnd(standing: Vec3, target: Vec3): Vec3 {
  const d = sub(target, standing);
  const dist = length(d);
  if (dist <= BODY_TO_HANDS) return standing;
  const end = addScaled(target, d, -BODY_TO_HANDS / dist);
  return v3(end.x, Math.max(end.y, 0.3), end.z);
}

export function planKeeper(input: KeeperInput | null, startX: number, p: SimParams): KeeperPlan {
  const standing = standingPelvis(startX);
  if (!input) return { mode: 'stance', flickTick: Infinity, target: standing, reach: 0, travel: 0 };
  const len = Math.sqrt(input.vx * input.vx + input.vy * input.vy);
  if (len < INPUT.tapMaxLen) return { mode: 'set', flickTick: input.flickTick, target: standing, reach: 0, travel: 0 };

  const sinA = Math.max(0, -input.vy) / len;
  // The keeper camera looks down +z, so screen-right is world −x.
  const side = input.vx > 0 ? -1 : 1;
  const lenFrac = clamp((len - INPUT.tapMaxLen) / (INPUT.keeperMaxLen - INPUT.tapMaxLen), 0, 1);
  const steepness = sinA <= SIN_STEEP ? 0 : (sinA - SIN_STEEP) / (1 - SIN_STEEP);
  const handY =
    sinA <= SIN_STEEP
      ? lerpNum(p.lowHandY, p.highHandY, clamp((sinA - SIN_FLAT) / (SIN_STEEP - SIN_FLAT), 0, 1))
      : lerpNum(p.highHandY, p.jumpHandY, steepness);
  const reach = lerpNum(p.minHandReach, p.maxHandReach, lenFrac) * reachScale(steepness, handY, p);
  const target = v3(startX + side * reach, handY, KEEPER_Z + 0.1);
  const travelDist = Math.abs(divePelvisEnd(standing, target).x - startX);
  return {
    mode: 'dive',
    flickTick: input.flickTick,
    target,
    reach,
    travel: p.diveBaseTime + p.diveTimePerMeter * travelDist + p.diveTimePerHeight * Math.max(0, handY - 1),
  };
}

/** Steep flicks trade lateral reach for height; high dives reach less far sideways. */
function reachScale(steepness: number, handY: number, p: SimParams): number {
  const high = clamp((handY - 1.2) / (p.highHandY - 1.2), 0, 1);
  return lerpNum(1, 0.1, steepness) * lerpNum(1, p.highReachScale, high);
}

/**
 * Inverse of planKeeper's dive mapping: the keeper-screen flick that sends the
 * hands to (startX + dx, h). Used by the AI keeper and the tuning tools.
 */
export function flickForHandTarget(dx: number, h: number, p: SimParams): { vx: number; vy: number } {
  let sinA: number;
  if (h <= p.lowHandY) sinA = 0.2;
  else if (h <= p.highHandY) sinA = SIN_FLAT + ((h - p.lowHandY) / (p.highHandY - p.lowHandY)) * (SIN_STEEP - SIN_FLAT);
  else sinA = SIN_STEEP + clamp((h - p.highHandY) / (p.jumpHandY - p.highHandY), 0, 1) * (1 - SIN_STEEP);
  const steepness = sinA <= SIN_STEEP ? 0 : (sinA - SIN_STEEP) / (1 - SIN_STEEP);
  const handY =
    sinA <= SIN_STEEP
      ? lerpNum(p.lowHandY, p.highHandY, clamp((sinA - SIN_FLAT) / (SIN_STEEP - SIN_FLAT), 0, 1))
      : lerpNum(p.highHandY, p.jumpHandY, steepness);
  const reach = Math.abs(dx) / reachScale(steepness, handY, p);
  const lenFrac = clamp((reach - p.minHandReach) / (p.maxHandReach - p.minHandReach), 0, 1);
  const minLen = INPUT.tapMaxLen + 1e-3;
  const len = minLen + lenFrac * (INPUT.keeperMaxLen - minLen);
  const cosA = Math.sqrt(Math.max(0, 1 - sinA * sinA));
  const side = dx >= 0 ? 1 : -1;
  return { vx: -side * len * cosA, vy: -len * sinA };
}

function buildParts(pelvis: Vec3, bodyDir: Vec3, hands: Vec3, spread: number, drop: number): KeeperPart[] {
  const perp = v3(bodyDir.y, -bodyDir.x, 0);
  const shoulderC = addScaled(pelvis, bodyDir, TORSO_LEN);
  const head = addScaled(shoulderC, bodyDir, HEAD_OFFSET);
  const shL = addScaled(shoulderC, perp, SHOULDER_HALF);
  const shR = addScaled(shoulderC, perp, -SHOULDER_HALF);
  const hL = addScaled(hands, perp, spread);
  const hR = addScaled(hands, perp, -spread);
  const hipL = addScaled(pelvis, perp, HIP_HALF);
  const hipR = addScaled(pelvis, perp, -HIP_HALF);
  const fL = addScaled(hipL, bodyDir, -LEG_LEN);
  const fR = addScaled(hipR, bodyDir, -LEG_LEN);
  const R = KEEPER_RADII;
  const raw: [PartKind, Vec3, Vec3][] = [
    ['torso', pelvis, shoulderC],
    ['head', head, head],
    ['arm', shL, hL],
    ['arm', shR, hR],
    ['hand', hL, hL],
    ['hand', hR, hR],
    ['leg', hipL, fL],
    ['leg', hipR, fR],
  ];
  return raw.map(([kind, a, b]) => {
    const r = R[kind];
    return {
      kind,
      a: v3(a.x, Math.max(a.y - drop, r), a.z),
      b: v3(b.x, Math.max(b.y - drop, r), b.z),
      r,
    };
  });
}

/** Index of the two hand spheres in the parts array. */
export const HAND_PARTS = [4, 5] as const;

export class KeeperSim {
  private readonly standing: Vec3;
  private readonly pelvisEnd: Vec3;
  private readonly diveDir: Vec3;
  private handC: Vec3;
  private spread = REST_SPREAD;
  private handFrom: Vec3 | null = null;
  private spreadFrom = REST_SPREAD;

  /** Seconds after contact at which the dive leaves the windup */
  readonly diveStart: number;

  /**
   * @param arrivalTick when the ball reaches the keeper's plane. With
   *   diveAutoTime on, an early flick is held so the dive peaks no sooner than
   *   that: flicking early only risks guessing wrong, never falling too soon.
   */
  constructor(
    readonly plan: KeeperPlan,
    private readonly startX: number,
    private readonly p: SimParams,
    arrivalTick = Infinity,
  ) {
    this.standing = standingPelvis(startX);
    this.pelvisEnd = divePelvisEnd(this.standing, plan.target);
    this.diveDir = normalize(sub(plan.target, this.standing));
    this.handC = this.restHands();
    const earliest = plan.flickTick * DT + p.keeperWindup;
    const timed = arrivalTick * DT - plan.travel;
    this.diveStart = p.diveAutoTime > 0 && Number.isFinite(timed) ? Math.max(earliest, timed) : earliest;
  }

  private restHands(): Vec3 {
    return v3(this.startX, REST_HAND_Y, KEEPER_Z + REST_HAND_DZ);
  }

  modeAt(tick: number): KeeperMode {
    return tick >= this.plan.flickTick ? this.plan.mode : 'stance';
  }

  /** Extension e ∈ [0, 1] and fall f ∈ [0, 1] of the dive at a tick. */
  diveProgress(tick: number): { e: number; fall: number } {
    const ts = tick * DT - this.diveStart;
    if (tick < this.plan.flickTick || ts <= 0) return { e: 0, fall: 0 };
    const q = Math.min(1, ts / this.plan.travel);
    const e = 1 - (1 - q) * (1 - q);
    const tf = ts - this.plan.travel - this.p.diveHold;
    const f = tf > 0 ? Math.min(1, tf / this.p.diveFall) : 0;
    return { e, fall: f * f };
  }

  /** How far toward a full-length dive the keeper is stretched (0 … 1). */
  stretchAt(tick: number): number {
    if (this.modeAt(tick) !== 'dive') return 0;
    return (this.diveProgress(tick).e * this.plan.reach) / this.p.maxHandReach;
  }

  /** Advance to `tick` (> 0) given the ball state at the previous tick. */
  step(tick: number, ballPos: Vec3, ballVel: Vec3): KeeperPart[] {
    const mode = this.modeAt(tick);
    if (mode === 'dive') {
      if (!this.handFrom) {
        this.handFrom = this.handC;
        this.spreadFrom = this.spread;
      }
    } else {
      this.track(mode, ballPos, ballVel);
    }
    return this.partsAt(tick);
  }

  /** Pose at a tick from the current tracking state (also valid for run-up ticks < 0). */
  partsAt(tick: number): KeeperPart[] {
    if (this.modeAt(tick) !== 'dive') {
      const lean = clamp((Math.abs(this.handC.x - this.startX) - 0.4) / 1.2, 0, 0.5);
      const bodyDir = normalize(lerp(UP, normalize(sub(this.handC, this.standing)), lean));
      return buildParts(this.standing, bodyDir, this.handC, this.spread, 0);
    }
    const { e, fall } = this.diveProgress(tick);
    const pelvis = lerp(this.standing, this.pelvisEnd, e);
    const bodyDir = normalize(lerp(UP, this.diveDir, e));
    const hands = lerp(this.handFrom ?? this.restHands(), this.plan.target, e);
    const spread = lerpNum(this.handFrom ? this.spreadFrom : REST_SPREAD, DIVE_SPREAD, e);
    const drop = fall * Math.max(0, pelvis.y - 0.25);
    return buildParts(pelvis, bodyDir, hands, spread, drop);
  }

  /** Stance / set: hands track the ball's predicted crossing within a limited reach. */
  private track(mode: KeeperMode, ballPos: Vec3, ballVel: Vec3): void {
    const set = mode === 'set';
    const reachX = set ? this.p.setReachX : this.p.stanceReachX;
    const reachY = set ? this.p.setReachY : this.p.stanceReachY;
    const speed = set ? this.p.setHandSpeed : this.p.stanceHandSpeed;
    let target = this.restHands();
    let spreadTarget = REST_SPREAD;
    if (ballVel.z < -1 && ballPos.z > KEEPER_Z && ballPos.z < TRACK_START_Z) {
      const tc = (ballPos.z - KEEPER_Z) / -ballVel.z;
      const px = ballPos.x + ballVel.x * tc;
      const py = ballPos.y + ballVel.y * tc - 0.5 * this.p.gravity * tc * tc;
      target = v3(
        this.startX + clamp(px - this.startX, -reachX, reachX),
        clamp(py, 0.25, reachY),
        KEEPER_Z + REST_HAND_DZ,
      );
      spreadTarget = TRACK_SPREAD;
    }
    const gap = distance(target, this.handC);
    const maxStep = speed * DT;
    this.handC = gap > maxStep ? lerp(this.handC, target, maxStep / gap) : target;
    const ds = spreadTarget - this.spread;
    this.spread += clamp(ds, -2 * DT, 2 * DT);
  }
}
