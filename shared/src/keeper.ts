// Keeper dive planning, kinematics and hitbox (SPEC §3.2, §4.3).
// Poses are built from lerps, polynomials and sqrt normalisation only, so the
// hitbox is identical on every engine. The client draws the keeper straight
// from these parts, so the body you see is exactly what the ball collides with.
//
// Motion:
//   stance  crouched ready position; hands track the ball with a spring,
//           the keeper side-steps and leans, and arm length is fixed, so the
//           reach you get is the reach the body allows;
//   set     (tap) the same, but bigger and quicker;
//   dive    load (drop into the legs) → spring off along an arc with the arms
//           leading and the legs trailing → full stretch → land on the side
//           (or back on the feet after a vertical jump).

import { DT, KEEPER_Z } from './geometry';
import { INPUT, type KeeperInput } from './input';
import type { SimParams } from './params';
import { add, addScaled, clamp, length, lerp, lerpNum, normalize, scale, sub, v3, type Vec3 } from './vec';

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
  /** Seconds from leaving the ground to full extension */
  travel: number;
}

const STANCE_PELVIS_Y = 0.88;
const TORSO_LEN = 0.5;
const ARM_LEN = 0.68;
const BODY_TO_HANDS = TORSO_LEN + ARM_LEN;
const HEAD_OFFSET = 0.22;
const SHOULDER_HALF = 0.19;
const HIP_HALF = 0.11;
const LEG_LEN = 0.86;
const FOOT_HALF = 0.26;
const REST_HAND_Y = 1.02;
const REST_HAND_DZ = 0.3;
const REST_SPREAD = 0.3;
const SET_SPREAD = 0.38;
const TRACK_SPREAD = 0.12;
const DIVE_SPREAD = 0.1;
const LOAD_DROP = 0.12;
const LOAD_TIME = 0.1;
const DIVE_ARC = 0.18;
/** Extra rise of the body mid-dive per metre of reach (a leap, not a slide) */
const DIVE_ARC_PER_M = 0.1;
/** Bounce on landing from a dive */
const SETTLE_TIME = 0.25;
const SETTLE_BOUNCE = 0.06;
/** Fraction of the dive's average speed the body carries on with past full stretch */
const ARRIVE_SPEED = 0.3;
/** Seconds over which the drift past full stretch eases off */
const DRIFT_TAU = 0.2;
const MAX_STEP = 0.4;
const STEP_SPEED = 2.5;
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

/** Index of the two hand spheres in the parts array. */
export const HAND_PARTS = [4, 5] as const;

const STANCE_LEAN = normalize(v3(0, 1, 0.14));

const smooth01 = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

function stancePelvis(startX: number): Vec3 {
  return v3(startX, STANCE_PELVIS_Y, KEEPER_Z);
}

function divePelvisEnd(start: Vec3, target: Vec3): Vec3 {
  const d = sub(target, start);
  const dist = length(d);
  if (dist <= BODY_TO_HANDS) return start;
  const end = addScaled(target, d, -BODY_TO_HANDS / dist);
  return v3(end.x, Math.max(end.y, 0.3), end.z);
}

export function planKeeper(input: KeeperInput | null, startX: number, p: SimParams): KeeperPlan {
  const start = stancePelvis(startX);
  if (!input) return { mode: 'stance', flickTick: Infinity, target: start, reach: 0, travel: 0 };
  const len = Math.sqrt(input.vx * input.vx + input.vy * input.vy);
  if (len < INPUT.tapMaxLen) return { mode: 'set', flickTick: input.flickTick, target: start, reach: 0, travel: 0 };

  const sinA = Math.max(0, -input.vy) / len;
  // Screen-right in the canonical keeper view (looking down +z) is world −x.
  const side = input.vx > 0 ? -1 : 1;
  const lenFrac = clamp((len - INPUT.tapMaxLen) / (INPUT.keeperMaxLen - INPUT.tapMaxLen), 0, 1);
  const steepness = sinA <= SIN_STEEP ? 0 : (sinA - SIN_STEEP) / (1 - SIN_STEEP);
  const handY = handHeight(sinA, steepness, p);
  const reach = lerpNum(p.minHandReach, p.maxHandReach, lenFrac) * reachScale(steepness, handY, p);
  const target = v3(startX + side * reach, handY, KEEPER_Z + 0.1);
  const travelDist = Math.abs(divePelvisEnd(start, target).x - startX);
  return {
    mode: 'dive',
    flickTick: input.flickTick,
    target,
    reach,
    travel: p.diveBaseTime + p.diveTimePerMeter * travelDist + p.diveTimePerHeight * Math.max(0, handY - 1),
  };
}

function handHeight(sinA: number, steepness: number, p: SimParams): number {
  return sinA <= SIN_STEEP
    ? lerpNum(p.lowHandY, p.highHandY, clamp((sinA - SIN_FLAT) / (SIN_STEEP - SIN_FLAT), 0, 1))
    : lerpNum(p.highHandY, p.jumpHandY, steepness);
}

/** Steep flicks trade lateral reach for height; high dives reach less far sideways. */
function reachScale(steepness: number, handY: number, p: SimParams): number {
  const high = clamp((handY - 1.2) / (p.highHandY - 1.2), 0, 1);
  return lerpNum(1, 0.1, steepness) * lerpNum(1, p.highReachScale, high);
}

/**
 * Inverse of planKeeper's dive mapping: the canonical keeper-view flick that
 * sends the hands to (startX + dx, h). Used by the AI keeper and tuning tools.
 */
export function flickForHandTarget(dx: number, h: number, p: SimParams): { vx: number; vy: number } {
  let sinA: number;
  if (h <= p.lowHandY) sinA = 0.2;
  else if (h <= p.highHandY) sinA = SIN_FLAT + ((h - p.lowHandY) / (p.highHandY - p.lowHandY)) * (SIN_STEEP - SIN_FLAT);
  else sinA = SIN_STEEP + clamp((h - p.highHandY) / (p.jumpHandY - p.highHandY), 0, 1) * (1 - SIN_STEEP);
  const steepness = sinA <= SIN_STEEP ? 0 : (sinA - SIN_STEEP) / (1 - SIN_STEEP);
  const reach = Math.abs(dx) / reachScale(steepness, handHeight(sinA, steepness, p), p);
  const lenFrac = clamp((reach - p.minHandReach) / (p.maxHandReach - p.minHandReach), 0, 1);
  const minLen = INPUT.tapMaxLen + 1e-3;
  const len = minLen + lenFrac * (INPUT.keeperMaxLen - minLen);
  const cosA = Math.sqrt(Math.max(0, 1 - sinA * sinA));
  const side = dx >= 0 ? 1 : -1;
  return { vx: -side * len * cosA, vy: -len * sinA };
}

/** A full-body pose: everything the hitbox is built from. */
interface Pose {
  pelvis: Vec3;
  bodyDir: Vec3;
  hands: Vec3;
  spread: number;
  footL: Vec3;
  footR: Vec3;
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    pelvis: lerp(a.pelvis, b.pelvis, t),
    bodyDir: normalize(lerp(a.bodyDir, b.bodyDir, t)),
    hands: lerp(a.hands, b.hands, t),
    spread: lerpNum(a.spread, b.spread, t),
    footL: lerp(a.footL, b.footL, t),
    footR: lerp(a.footR, b.footR, t),
  };
}

function partsFrom(pose: Pose): KeeperPart[] {
  const { pelvis, bodyDir, hands, spread } = pose;
  const perp = normalize(v3(bodyDir.y, -bodyDir.x, 0));
  const shoulderC = addScaled(pelvis, bodyDir, TORSO_LEN);
  const head = addScaled(shoulderC, bodyDir, HEAD_OFFSET);
  const raw: [PartKind, Vec3, Vec3][] = [
    ['torso', pelvis, shoulderC],
    ['head', head, head],
    ['arm', addScaled(shoulderC, perp, SHOULDER_HALF), addScaled(hands, perp, spread)],
    ['arm', addScaled(shoulderC, perp, -SHOULDER_HALF), addScaled(hands, perp, -spread)],
    ['hand', addScaled(hands, perp, spread), addScaled(hands, perp, spread)],
    ['hand', addScaled(hands, perp, -spread), addScaled(hands, perp, -spread)],
    ['leg', addScaled(pelvis, perp, HIP_HALF), pose.footL],
    ['leg', addScaled(pelvis, perp, -HIP_HALF), pose.footR],
  ];
  return raw.map(([kind, a, b]) => {
    const r = KEEPER_RADII[kind];
    return { kind, a: v3(a.x, Math.max(a.y, r), a.z), b: v3(b.x, Math.max(b.y, r), b.z), r };
  });
}

export class KeeperSim {
  /** Seconds after contact at which the keeper leaves the ground */
  readonly diveStart: number;
  private readonly start: Vec3;
  private readonly pelvisEnd: Vec3;
  private readonly diveDir: Vec3;
  private readonly jump: boolean;
  // Stance tracking state.
  private handC: Vec3;
  private handV = v3();
  private stepX = 0;
  private lift = 0;
  private spread = REST_SPREAD;
  private frozen: Pose | null = null;

  /**
   * @param arrivalTick when the ball reaches the keeper's plane. With
   *   diveAutoTime on, an early flick is held in a loaded crouch so the dive
   *   peaks no sooner than that: flicking early only risks guessing wrong.
   */
  constructor(
    readonly plan: KeeperPlan,
    private readonly startX: number,
    private readonly p: SimParams,
    arrivalTick = Infinity,
  ) {
    this.start = stancePelvis(startX);
    this.pelvisEnd = divePelvisEnd(this.start, plan.target);
    this.diveDir = normalize(sub(plan.target, this.start));
    this.jump = this.diveDir.y > 0.8;
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

  /**
   * Load l, extension e and fall f (all 0 … 1) of the dive at a tick, plus
   * drift: metres carried on past full stretch. The body's momentum carries it
   * on through full stretch while gravity takes over (falling slowly at
   * first, like the top of a jump), so it never hangs in the air.
   */
  diveProgress(tick: number): { load: number; e: number; fall: number; drift: number; landed: number } {
    if (tick < this.plan.flickTick) return { load: 0, e: 0, fall: 0, drift: 0, landed: -1 };
    const t = tick * DT;
    const load = Math.min(1, (t - this.plan.flickTick * DT) / LOAD_TIME);
    const ts = t - this.diveStart;
    if (ts <= 0) return { load, e: 0, fall: 0, drift: 0, landed: -1 };
    const q = Math.min(1, ts / this.plan.travel);
    const e = 1 - (1 - q) * (1 - q);
    const after = Math.max(0, ts - this.plan.travel);
    // Gravity takes over after a moment at full stretch (diveHold shared between the two).
    const hang = 0.4 * this.p.diveHold;
    const fallTime = this.p.diveHold - hang + this.p.diveFall;
    const f = Math.min(1, Math.max(0, after - hang) / fallTime);
    // Momentum carries the body on past full stretch at ARRIVE_SPEED of the dive's average speed, easing off (rational, not exp: this is in the sim).
    const v = (ARRIVE_SPEED * this.plan.reach) / this.plan.travel;
    return { load, e, fall: f * f, drift: (v * after * DRIFT_TAU) / (after + DRIFT_TAU), landed: after - hang - fallTime };
  }

  /** How far toward a full-length dive the keeper is stretched (0 … 1). */
  stretchAt(tick: number): number {
    if (this.modeAt(tick) !== 'dive') return 0;
    return (this.diveProgress(tick).e * this.plan.reach) / this.p.maxHandReach;
  }

  /** Advance to `tick` (> 0) given the ball state at the previous tick. */
  step(tick: number, ballPos: Vec3, ballVel: Vec3): KeeperPart[] {
    const mode = this.modeAt(tick);
    if (mode === 'dive') this.frozen ??= this.stancePose();
    else this.track(mode, ballPos, ballVel);
    return this.partsAt(tick);
  }

  /** Pose at a tick from the current tracking state (also valid for run-up ticks < 0). */
  partsAt(tick: number): KeeperPart[] {
    return partsFrom(this.modeAt(tick) === 'dive' ? this.divePose(tick) : this.stancePose());
  }

  private stancePose(): Pose {
    const pelvis = v3(this.startX + this.stepX, STANCE_PELVIS_Y + this.lift, KEEPER_Z);
    const shoulderRest = addScaled(pelvis, STANCE_LEAN, TORSO_LEN);
    const toHands = sub(this.handC, shoulderRest);
    // Lean into far reaches; the arms never stretch past their length.
    const lean = clamp((length(toHands) - 0.55) / 0.7, 0, 0.55);
    const bodyDir = normalize(lerp(STANCE_LEAN, normalize(sub(this.handC, pelvis)), lean));
    const shoulderC = addScaled(pelvis, bodyDir, TORSO_LEN);
    const reach = sub(this.handC, shoulderC);
    const r = length(reach);
    const hands = r > ARM_LEN ? addScaled(shoulderC, reach, ARM_LEN / r) : this.handC;
    const footY = 0.09 + this.lift * 0.8;
    return {
      pelvis,
      bodyDir,
      hands,
      spread: this.spread,
      footL: v3(pelvis.x + FOOT_HALF, footY, KEEPER_Z + 0.05),
      footR: v3(pelvis.x - FOOT_HALF, footY, KEEPER_Z + 0.05),
    };
  }

  private divePose(tick: number): Pose {
    const st = this.frozen ?? this.stancePose();
    const { load, e, fall, drift, landed } = this.diveProgress(tick);
    const d = this.diveDir;

    // Spring off: drop into the legs, then leap: the body rises on an arc
    // (higher for longer dives) and carries on past full stretch.
    const side = d.x >= 0 ? 1 : -1;
    const arc = this.jump ? DIVE_ARC : DIVE_ARC + DIVE_ARC_PER_M * this.plan.reach;
    const pelvis = add(
      lerp(st.pelvis, this.pelvisEnd, e),
      v3(this.jump ? 0 : side * drift, arc * 4 * e * (1 - e) - LOAD_DROP * load * (1 - e), 0),
    );
    const bodyDir = normalize(lerp(st.bodyDir, d, smooth01(e * 1.4)));
    const shoulderC = addScaled(pelvis, bodyDir, TORSO_LEN);
    // Arms lead the body toward the ball and arrive exactly on the target.
    const restShoulder = addScaled(st.pelvis, st.bodyDir, TORSO_LEN);
    const restArm = sub(st.hands, restShoulder);
    const armDir = normalize(lerp(normalize(restArm), d, smooth01(e * 1.8)));
    const hands = addScaled(shoulderC, armDir, lerpNum(length(restArm), ARM_LEN, e));
    // Push off the far foot, which trails out straight; the near leg tucks up
    // with the knee bent toward the ball, as keepers do.
    const perp = normalize(v3(bodyDir.y, -bodyDir.x, 0));
    const trail = smooth01((e - 0.15) / 0.35);
    const straight = addScaled(addScaled(pelvis, bodyDir, -LEG_LEN), perp, -side * 0.1);
    const tucked = add(addScaled(addScaled(pelvis, bodyDir, -0.55), perp, side * 0.08), v3(0, 0, 0.18));
    const nearIsLeft = side > 0; // keeper-left is +x
    const air: Pose = {
      pelvis,
      bodyDir,
      hands,
      spread: lerpNum(st.spread, DIVE_SPREAD, e),
      footL: lerp(st.footL, nearIsLeft ? tucked : straight, trail),
      footR: lerp(st.footR, nearIsLeft ? straight : tucked, trail),
    };
    if (fall <= 0) return air;

    // Come down: on the side after a dive, back onto the feet after a jump.
    let down: Pose;
    if (this.jump) {
      const pl = v3(this.pelvisEnd.x, STANCE_PELVIS_Y, KEEPER_Z);
      down = {
        pelvis: pl,
        bodyDir: STANCE_LEAN,
        hands: v3(pl.x, REST_HAND_Y + 0.4, KEEPER_Z + REST_HAND_DZ),
        spread: REST_SPREAD,
        footL: v3(pl.x + FOOT_HALF, 0.09, KEEPER_Z + 0.05),
        footR: v3(pl.x - FOOT_HALF, 0.09, KEEPER_Z + 0.05),
      };
    } else {
      const flat = normalize(v3(d.x, Math.max(-0.05, d.y * 0.15), 0));
      const pl = v3(this.pelvisEnd.x + side * drift, 0.22, KEEPER_Z);
      const h = addScaled(pl, flat, BODY_TO_HANDS);
      const fp = normalize(v3(flat.y, -flat.x, 0));
      const feet = addScaled(pl, flat, -LEG_LEN);
      down = {
        pelvis: pl,
        bodyDir: flat,
        hands: v3(h.x, Math.max(0.12, h.y), h.z),
        spread: DIVE_SPREAD,
        footL: addScaled(feet, fp, 0.1),
        footR: addScaled(feet, fp, -0.1),
      };
    }
    const pose = lerpPose(air, down, fall);
    if (landed > 0 && landed < SETTLE_TIME && !this.jump) {
      // A little bounce as the body hits the turf (a polynomial bump: no trig in the sim).
      const u = landed / SETTLE_TIME;
      pose.pelvis = add(pose.pelvis, v3(0, SETTLE_BOUNCE * 4 * u * (1 - u), 0));
    }
    return pose;
  }

  /** Stance / set: hands follow the ball's predicted crossing on a spring; the body steps and leans. */
  private track(mode: KeeperMode, ballPos: Vec3, ballVel: Vec3): void {
    const set = mode === 'set';
    const reachX = set ? this.p.setReachX : this.p.stanceReachX;
    const reachY = set ? this.p.setReachY : this.p.stanceReachY;
    const maxSpeed = set ? this.p.setHandSpeed : this.p.stanceHandSpeed;
    let target = this.restHands();
    let spreadTarget = set ? SET_SPREAD : REST_SPREAD;
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
    // Critically damped spring, capped at the hands' top speed.
    const k = set ? 160 : 100;
    const c = set ? 25.3 : 20; // 2·√k
    const acc = sub(scale(sub(target, this.handC), k), scale(this.handV, c));
    this.handV = addScaled(this.handV, acc, DT);
    const sp = length(this.handV);
    if (sp > maxSpeed) this.handV = scale(this.handV, maxSpeed / sp);
    this.handC = addScaled(this.handC, this.handV, DT);
    // Side-step toward the hands and hop for high balls.
    const want = clamp(this.handC.x - this.startX, -MAX_STEP, MAX_STEP);
    this.stepX += clamp(want - this.stepX, -STEP_SPEED * DT, STEP_SPEED * DT);
    const wantLift = clamp((this.handC.y - 1.9) * 0.8, 0, 0.4);
    this.lift += clamp(wantLift - this.lift, -2 * DT, 2 * DT);
    this.spread += clamp(spreadTarget - this.spread, -2 * DT, 2 * DT);
  }
}
