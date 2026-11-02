// One kick's simulation plus everything needed to draw any moment of it,
// including the run-up (negative ticks), a re-sim when the keeper flicks, and
// a coda after the kick is decided: the keeper finishes the dive and lands,
// and the ball runs on (or stays in the keeper's gloves) while the result shows.

import {
  BALL_RADIUS,
  DEFAULT_PARAMS,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  HAND_PARTS,
  KeeperSim,
  NET_DEPTH,
  TICK_RATE,
  ballArrivalTick,
  planKeeper,
  simulateKick,
  stepNetBall,
  wallJumpY,
  type KeeperInput,
  type KeeperPart,
  type KickSetup,
  type LaunchState,
  type SimEvent,
  type SimResult,
  type Spot,
  type Vec3,
} from '@fk/shared';

const P = DEFAULT_PARAMS;

/** The stadium the ball can hit after the kick is decided (see world/pitch.ts). */
const BOARD_Z = -4.6;
const BOARD_X = 36;
const BOARD_TOP = 0.9;
const STAND_Z = -8;
const STAND_X = 40;
const STAND_FRONT = 1.4;
const STAND_RISE = 7.6 / 12;

/** A ball in free flight after the kick is decided (visual only). */
export interface LooseBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** A bounce during the coda, for sound. */
export interface CodaEvent {
  tick: number;
  speed: number;
  hard: boolean;
}

/**
 * One tick of a loose ball after the kick is decided: gravity, the outside of
 * the soccer net (when it's up), the advertising boards, the stand front
 * walls (the fans keep anything that lands in the crowd) and the turf.
 */
export function stepLooseBall(b: LooseBall, tick: number, events: CodaEvent[], soccerNet: boolean): void {
  const dt = 1 / TICK_RATE;
  const px = b.x;
  const py = b.y;
  const pz = b.z;
  b.vy -= P.gravity * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  const hit = (speed: number, hard: boolean) => events.push({ tick, speed, hard });
  if (soccerNet) {
    // Off the roof of the net and the side netting.
    if (pz > -NET_DEPTH && pz < 0 && Math.abs(px) < GOAL_HALF_WIDTH && py >= GOAL_HEIGHT + BALL_RADIUS && b.y < GOAL_HEIGHT + BALL_RADIUS) {
      b.y = GOAL_HEIGHT + BALL_RADIUS;
      b.vy = Math.abs(b.vy) * 0.15;
      b.vx *= 0.6;
      b.vz *= 0.6;
    }
    if (pz > -NET_DEPTH && pz < 0 && b.y < GOAL_HEIGHT && Math.abs(px) >= GOAL_HALF_WIDTH + BALL_RADIUS && Math.abs(b.x) < GOAL_HALF_WIDTH + BALL_RADIUS) {
      b.x = Math.sign(px) * (GOAL_HALF_WIDTH + BALL_RADIUS);
      b.vx = -b.vx * 0.15;
    }
  }
  // Advertising boards: behind the goal and down both touchlines.
  if (pz > BOARD_Z + BALL_RADIUS && b.z <= BOARD_Z + BALL_RADIUS && b.y < BOARD_TOP + BALL_RADIUS && Math.abs(b.x) < BOARD_X) {
    hit(Math.abs(b.vz), true);
    b.z = BOARD_Z + BALL_RADIUS;
    b.vz = -b.vz * 0.4;
    b.vx *= 0.8;
  }
  if (Math.abs(px) < BOARD_X - BALL_RADIUS && Math.abs(b.x) >= BOARD_X - BALL_RADIUS && b.y < BOARD_TOP + BALL_RADIUS && b.z > BOARD_Z) {
    hit(Math.abs(b.vx), true);
    b.x = Math.sign(b.x) * (BOARD_X - BALL_RADIUS);
    b.vx = -b.vx * 0.4;
    b.vz *= 0.8;
  }
  // Into the crowd: the stands rise from their front walls; the fans keep it.
  const into = Math.max(STAND_Z - b.z, Math.abs(b.x) - STAND_X);
  if (into > 0) {
    const floor = STAND_FRONT + Math.min(into, 12) * STAND_RISE + BALL_RADIUS;
    if (b.y < floor) {
      if (into < 0.3 && b.y < STAND_FRONT) {
        // Off the front wall.
        hit(Math.hypot(b.vx, b.vz), true);
        if (b.z < STAND_Z) {
          b.z = STAND_Z;
          b.vz = -b.vz * 0.35;
        } else {
          b.x = Math.sign(b.x) * STAND_X;
          b.vx = -b.vx * 0.35;
        }
      } else {
        if (Math.abs(b.vy) > 1) hit(Math.abs(b.vy), false);
        b.y = floor;
        b.vx *= 0.2;
        b.vy = 0;
        b.vz *= 0.2;
      }
    }
  }
  if (b.y < BALL_RADIUS) {
    b.y = BALL_RADIUS;
    if (Math.abs(b.vy) > 1.2) hit(Math.abs(b.vy), false);
    b.vy = Math.abs(b.vy) > 0.8 ? -b.vy * 0.55 : 0;
    b.vx *= 0.85;
    b.vz *= 0.85;
  }
  if (b.y <= BALL_RADIUS + 1e-6 && b.vy === 0) {
    const k = Math.max(0, 1 - (P.rollDecel * dt) / Math.max(1e-6, Math.hypot(b.vx, b.vz)));
    b.vx *= k;
    b.vz *= k;
  }
}

/**
 * What the session needs to draw and hear a kick at any tick: a free kick
 * (KickPlayback) or a field goal (FieldGoalPlayback).
 */
export interface Playable {
  readonly setup: { spot: Spot };
  readonly launch: LaunchState;
  readonly result: { events: SimEvent[] };
  readonly netHitTick: number | null;
  /** The tick it went in (over the line, or through the uprights), or null */
  readonly scoreTick: number | null;
  readonly codaEvents: CodaEvent[];
  readonly endTick: number;
  readonly lastTick: number;
  ballAt(tick: number): Vec3;
  /** Null when there's no keeper (field goals) */
  keeperAt(tick: number): KeeperPart[] | null;
  wallYAt(tick: number): number;
  closeCall(): [number, number] | null;
}

/** How long the scene keeps moving after the sim decides the kick. */
export const CODA_TICKS = Math.round(1.6 * TICK_RATE);

export class KickPlayback implements Playable {
  result!: SimResult;
  keeperInput: KeeperInput | null = null;
  /** Tick the ball reaches the back of the net (goals only) */
  netHitTick: number | null = null;
  private keeperView!: KeeperSim;
  /** Ball positions for ticks result.ticks + 1 … + CODA_TICKS, xyz interleaved */
  private coda: Float64Array = new Float64Array(0);
  /** Bounces during the coda (for sound): off the turf, the boards or into the crowd */
  codaEvents: CodaEvent[] = [];

  constructor(
    readonly setup: KickSetup,
    readonly launch: LaunchState,
    keeper: KeeperInput | null,
  ) {
    this.setKeeper(keeper);
  }

  setKeeper(keeper: KeeperInput | null): void {
    const { spot } = this.setup;
    this.keeperInput = keeper;
    this.result = simulateKick(this.setup, this.launch, keeper, P, { record: true });
    this.keeperView = new KeeperSim(planKeeper(keeper, spot.keeperX, P), spot.keeperX, P, ballArrivalTick(this.launch, P, this.setup.wind));
    this.netHitTick = null;
    if (this.result.goalTick !== null) {
      const b = this.result.frames!.ball;
      for (let i = this.result.goalTick; i <= this.result.ticks; i++) {
        if (b[3 * i + 2] <= -NET_DEPTH + 0.4) {
          this.netHitTick = i;
          break;
        }
      }
      this.netHitTick ??= this.result.goalTick + 20;
    }
    this.codaEvents = [];
    this.coda = this.buildCoda();
  }

  get endTick(): number {
    return this.result.ticks;
  }

  get scoreTick(): number | null {
    return this.result.goalTick;
  }

  /** Last tick there is anything to draw for. */
  get lastTick(): number {
    return this.result.ticks + CODA_TICKS;
  }

  ballAt(tick: number): Vec3 {
    if (tick <= 0) return this.launch.pos;
    const n = this.result.ticks;
    const at = (i: number): Vec3 => {
      if (i <= n) {
        const b = this.result.frames!.ball;
        return { x: b[3 * i], y: b[3 * i + 1], z: b[3 * i + 2] };
      }
      const k = 3 * (Math.min(i, this.lastTick) - n - 1);
      return { x: this.coda[k], y: this.coda[k + 1], z: this.coda[k + 2] };
    };
    const i = Math.min(Math.floor(tick), this.lastTick);
    const a = at(i);
    const b = at(Math.min(i + 1, this.lastTick));
    const t = Math.min(1, tick - i);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }

  keeperAt(tick: number): KeeperPart[] {
    if (tick < 0) return this.keeperView.partsAt(Math.floor(tick));
    const n = this.result.ticks;
    const i = Math.min(Math.floor(tick), this.lastTick);
    if (i <= n) return this.result.frames!.keeper[i];
    const sim = this.result.frames!.keeperSim;
    return sim ? sim.partsAt(i) : this.result.frames!.keeper[n];
  }

  wallYAt(tick: number): number {
    if (tick < 0 || !this.result.wall) return 0;
    if (tick <= this.result.ticks) return this.result.frames!.wallY[Math.floor(tick)];
    return wallJumpY(Math.min(tick, this.lastTick) / TICK_RATE, P);
  }

  /** Tick range worth slowing down in the replay, if any. */
  closeCall(): [number, number] | null {
    const r = this.result;
    const ev = r.events.find((e) => e.kind === 'post' || e.kind === 'bar' || e.kind === 'keeper' || e.kind === 'wall');
    if (ev) return [ev.tick - 50, ev.tick + 40];
    const c = r.lineCrossing;
    if (c && (Math.abs(c.x) > 3.1 || c.y > 2.05)) return [c.tick - 50, c.tick + 30];
    return null;
  }

  /**
   * The ball after the kick is decided (visual only): held in the gloves after
   * a catch, settling in the bottom of the net after a goal, otherwise flying
   * on under gravity and bouncing to a stop.
   */
  private buildCoda(): Float64Array {
    const r = this.result;
    const b = r.frames!.ball;
    const n = r.ticks;
    const out = new Float64Array(3 * CODA_TICKS);
    let x = b[3 * n];
    let y = b[3 * n + 1];
    let z = b[3 * n + 2];
    const dt = 1 / TICK_RATE;
    let vx = n > 0 ? (x - b[3 * n - 3]) / dt : 0;
    let vy = n > 0 ? (y - b[3 * n - 2]) / dt : 0;
    let vz = n > 0 ? (z - b[3 * n - 1]) / dt : 0;
    const sim = r.frames!.keeperSim;
    const hands = (parts: KeeperPart[]) => {
      const a = parts[HAND_PARTS[0]].a;
      const c = parts[HAND_PARTS[1]].a;
      return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
    };
    const held = r.tag === 'caught' && sim;
    const loose: LooseBall = { x, y, z, vx, vy, vz };
    const grip = held ? hands(r.frames!.keeper[n]) : null;
    const offset = grip ? { x: x - grip.x, y: y - grip.y, z: z - grip.z } : null;
    for (let i = 0; i < CODA_TICKS; i++) {
      if (held && offset) {
        const h = hands(sim.partsAt(n + 1 + i));
        x = h.x + offset.x;
        y = Math.max(BALL_RADIUS, h.y + offset.y);
        z = h.z + offset.z;
      } else {
        loose.x = x;
        loose.y = y;
        loose.z = z;
        loose.vx = vx;
        loose.vy = vy;
        loose.vz = vz;
        if (r.goalTick === null) stepLooseBall(loose, n + 1 + i, this.codaEvents, true);
        else stepNetBall(loose, P);
        ({ x, y, z, vx, vy, vz } = loose);
      }
      out[3 * i] = x;
      out[3 * i + 1] = y;
      out[3 * i + 2] = z;
    }
    return out;
  }
}
