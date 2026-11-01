// The soccer net after a goal. The goal is already decided, so this is for the
// eye, but it's stepped like the sim (same tick, only + − × ÷) so it plays the
// same everywhere. The net is a slack bag, not a wall: the back and the sides
// give like a heavily damped spring that stiffens as it stretches and gives
// back only part of what it took, so the ball sinks in, the net bulges and
// soaks up the pace, and lets it go with little left; the mesh grips the ball
// while it's pressed in; then it drops to the grass, bobbles and rolls to a
// stop in the bottom of the net.

import { BALL_RADIUS, DT, GOAL_HALF_WIDTH, GOAL_HEIGHT, NET_DEPTH } from './geometry';
import type { SimParams } from './params';

export interface NetBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Back netting: spring (per m, and per m² as it tightens), per unit mass. A 25 m/s shot bulges it ≈ 0.5 m. */
const BACK_K = 520;
const BACK_K2 = 900;
/** The side netting and the roof are pulled tighter. */
const SIDE_K = 900;
/** Damping while the ball stretches the net (soaking up the pace) and as it lets go. */
const C_IN = 32;
const C_OUT = 14;
/** Slack netting doesn't throw the ball back: it pushes back this much of what it took as it lets go. */
const GIVE_BACK = 0.2;
/** How hard the mesh grips a ball pressed into it (per second, on the motion along the net). */
const GRIP = 7;
/** Inside the net: a little air drag, the grass's bounce and how quickly a rolling ball stops. */
const AIR = 0.15;
const BOUNCE = 0.42;
const BOUNCE_MIN = 0.7;
const ROLL_DECEL = 2.2;

/** Where the back netting is, for the ball's centre at rest against it. */
export const NET_BACK_Z = -NET_DEPTH + BALL_RADIUS;

/** The net's push on a ball `depth` into it moving out of it at `out` m/s (negative: still going in). */
function give(depth: number, out: number, k: number, k2: number): number {
  const spring = k * depth + k2 * depth * depth;
  return out < 0 ? spring - C_IN * out : GIVE_BACK * spring - C_OUT * out;
}

/** One tick of the ball inside the net, in place. */
export function stepNetBall(b: NetBall, p: SimParams): void {
  const r = BALL_RADIUS;
  let ax = -AIR * b.vx;
  let ay = -p.gravity - AIR * b.vy;
  let az = -AIR * b.vz;
  let gripX = 0;
  let gripY = 0;
  let gripZ = 0;
  const back = NET_BACK_Z - b.z;
  if (back > 0) {
    az += give(back, b.vz, BACK_K, BACK_K2);
    gripX += 1;
    gripY += 0.5;
  }
  const side = b.x > 0 ? b.x - (GOAL_HALF_WIDTH - r) : -(GOAL_HALF_WIDTH - r) - b.x;
  if (side > 0) {
    const s = b.x > 0 ? -1 : 1;
    ax += s * give(side, s * b.vx, SIDE_K, 0);
    gripZ += 1;
    gripY += 0.5;
  }
  const roof = b.y - (GOAL_HEIGHT - r);
  if (roof > 0) {
    ay -= give(roof, -b.vy, SIDE_K, 0);
    gripX += 0.5;
    gripZ += 0.5;
  }
  ax -= GRIP * gripX * b.vx;
  ay -= GRIP * gripY * b.vy;
  az -= GRIP * gripZ * b.vz;
  b.vx += ax * DT;
  b.vy += ay * DT;
  b.vz += az * DT;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;
  if (b.y < r) {
    b.y = r;
    if (b.vy < -BOUNCE_MIN) {
      b.vy = -b.vy * BOUNCE;
      b.vx *= 0.8;
      b.vz *= 0.8;
    } else b.vy = 0;
  }
  if (b.y <= r && b.vy === 0) {
    // Rolling: slows at a steady rate and stops.
    const hs = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
    const k = hs > ROLL_DECEL * DT ? 1 - (ROLL_DECEL * DT) / hs : 0;
    b.vx *= k;
    b.vz *= k;
  }
}
