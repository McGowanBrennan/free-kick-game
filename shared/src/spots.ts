// Kick spot generation (SPEC §2). Server-side only, so trig is allowed here.

import {
  BOX_DEPTH,
  BOX_HALF_WIDTH,
  GOAL_HALF_WIDTH,
  KEEPER_Z,
  PENALTY_SPOT_Z,
} from './geometry';
import { clamp } from './vec';

/** Kicks inside the box are always penalties; free kicks come from outside it. Field goals have their own spots. */
export type SpotCategory = 'penalty' | 'outside_box' | 'long_range' | 'field_goal';

export const SPOT_CATEGORIES: readonly SpotCategory[] = ['penalty', 'outside_box', 'long_range'];

export const SPOT_WEIGHTS: Readonly<Record<SpotCategory, number>> = {
  penalty: 0.35,
  field_goal: 0,
  outside_box: 0.4,
  long_range: 0.25,
};

export interface Spot {
  category: SpotCategory;
  /** Ball position on the ground plane */
  x: number;
  z: number;
  /** Distance from the centre of the goal line */
  distance: number;
  /** Largest wall the keeper may build here (0 = no wall) */
  maxWall: number;
  /** Keeper start x: on the bisector of the angle to the posts */
  keeperX: number;
}

const DEG = Math.PI / 180;

export function makeSpot(category: SpotCategory, x: number, z: number): Spot {
  const distance = Math.sqrt(x * x + z * z);
  return { category, x, z, distance, maxWall: maxWallFor(category, distance), keeperX: keeperStartX(x, z) };
}

export function maxWallFor(category: SpotCategory, distance: number): number {
  if (category !== 'outside_box' && category !== 'long_range') return 0;
  if (distance <= 25) return 4;
  if (distance <= 30) return 3;
  return 2;
}

export function keeperStartX(x: number, z: number): number {
  if (z <= KEEPER_Z) return 0;
  const lx = -GOAL_HALF_WIDTH - x;
  const rx = GOAL_HALF_WIDTH - x;
  const ll = Math.sqrt(lx * lx + z * z);
  const rl = Math.sqrt(rx * rx + z * z);
  const bx = lx / ll + rx / rl;
  const bz = -z / ll - z / rl;
  const s = (KEEPER_Z - z) / bz;
  return clamp(x + bx * s, -2, 2);
}

/** Angle the goal mouth subtends from (x, z), in degrees. */
export function goalMouthAngleDeg(x: number, z: number): number {
  const a = Math.atan2(GOAL_HALF_WIDTH - x, z);
  const b = Math.atan2(-GOAL_HALF_WIDTH - x, z);
  return (a - b) / DEG;
}

function insideBox(x: number, z: number): boolean {
  return z < BOX_DEPTH && Math.abs(x) < BOX_HALF_WIDTH;
}

export function pickCategory(rand: () => number): SpotCategory {
  let r = rand();
  for (const c of SPOT_CATEGORIES) {
    r -= SPOT_WEIGHTS[c];
    if (r < 0) return c;
  }
  return 'outside_box';
}

export function generateSpot(rand: () => number, category: SpotCategory = pickCategory(rand)): Spot {
  if (category === 'penalty') return makeSpot('penalty', 0, PENALTY_SPOT_Z);
  const mirror = rand() < 0.5 ? -1 : 1;
  for (let attempt = 0; attempt < 200; attempt++) {
    let x: number;
    let z: number;
    const long = category === 'long_range';
    const d = long ? 25 + rand() * 10 : 18 + rand() * 7;
    const a = rand() * (long ? 30 : 40) * DEG;
    x = d * Math.sin(a);
    z = d * Math.cos(a);
    if (insideBox(x, z)) continue;
    return makeSpot(category, x * mirror, z);
  }
  return makeSpot(category, 0, category === 'long_range' ? 30 : 21);
}
