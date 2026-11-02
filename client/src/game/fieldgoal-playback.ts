// One field goal's simulation plus everything needed to draw any moment of
// it: the snap and the hold (negative ticks, back to the snap at
// −opTime), the flight, and a coda after it's decided (the ball sails on into
// the stand, or drops and bounces).

import {
  DEFAULT_PARAMS,
  TICK_RATE,
  simulateFieldGoal,
  type FieldGoalResult,
  type FieldGoalSetup,
  type LaunchState,
  type Vec3,
} from '@fk/shared';
import { snapBallAt } from '../world/fieldgoal-unit';
import { CODA_TICKS, stepLooseBall, type CodaEvent, type LooseBall, type Playable } from './playback';

export class FieldGoalPlayback implements Playable {
  readonly result: FieldGoalResult;
  readonly netHitTick = null;
  readonly codaEvents: CodaEvent[] = [];
  private readonly coda: Float64Array;

  constructor(
    readonly setup: FieldGoalSetup,
    readonly launch: LaunchState,
  ) {
    this.result = simulateFieldGoal(setup, launch, DEFAULT_PARAMS, { record: true });
    this.coda = this.buildCoda();
  }

  get endTick(): number {
    return this.result.ticks;
  }

  get scoreTick(): number | null {
    return this.result.good ? (this.result.crossing?.tick ?? this.result.decidedTick) : null;
  }

  get lastTick(): number {
    return this.result.ticks + CODA_TICKS;
  }

  ballAt(tick: number): Vec3 {
    if (tick <= 0) return snapBallAt(this.setup.spot, this.setup.opTime + tick / TICK_RATE);
    const n = this.result.ticks;
    const at = (i: number): Vec3 => {
      const src = i <= n ? this.result.frames!.ball : this.coda;
      const k = i <= n ? 3 * i : 3 * (Math.min(i, this.lastTick) - n - 1);
      return { x: src[k], y: src[k + 1], z: src[k + 2] };
    };
    const i = Math.min(Math.floor(tick), this.lastTick);
    const a = at(i);
    const b = at(Math.min(i + 1, this.lastTick));
    const t = Math.min(1, tick - i);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }

  /** Seconds on the round's clock (where the cable cam is) at this tick. */
  camClock(tick: number): number {
    return (this.setup.clock ?? 0) + tick / TICK_RATE;
  }

  keeperAt(): null {
    return null;
  }

  wallYAt(): number {
    return 0;
  }

  /** Slow the replay round a doink, or a kick that only just clears or misses. */
  closeCall(): [number, number] | null {
    const ev = this.result.events.find((e) => e.kind === 'post' || e.kind === 'bar' || e.detail === 'block');
    if (ev) return [ev.tick - 50, ev.tick + 40];
    const c = this.result.crossing;
    if (c && (Math.abs(Math.abs(c.x) - 2.82) < 0.6 || c.y < 3.6)) return [c.tick - 50, c.tick + 30];
    return null;
  }

  private buildCoda(): Float64Array {
    const b = this.result.frames!.ball;
    const n = this.result.ticks;
    const dt = 1 / TICK_RATE;
    const ball: LooseBall = {
      x: b[3 * n],
      y: b[3 * n + 1],
      z: b[3 * n + 2],
      vx: n > 0 ? (b[3 * n] - b[3 * n - 3]) / dt : 0,
      vy: n > 0 ? (b[3 * n + 1] - b[3 * n - 2]) / dt : 0,
      vz: n > 0 ? (b[3 * n + 2] - b[3 * n - 1]) / dt : 0,
    };
    const out = new Float64Array(3 * CODA_TICKS);
    for (let i = 0; i < CODA_TICKS; i++) {
      stepLooseBall(ball, n + 1 + i, this.codaEvents, false);
      out[3 * i] = ball.x;
      out[3 * i + 1] = ball.y;
      out[3 * i + 2] = ball.z;
    }
    return out;
  }
}
