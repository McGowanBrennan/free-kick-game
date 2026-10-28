// Defensive wall layout and automatic jump (SPEC §2.1).

import { GOAL_HALF_WIDTH, WALL_DISTANCE, WALL_SPACING } from './geometry';
import type { SimParams } from './params';
import type { Spot } from './spots';
import { clamp } from './vec';

export interface WallConfig {
  size: number;
  /** Metres along the arc from the default position; positive = shooter's right */
  offset: number;
}

export interface WallLayout {
  size: number;
  center: { x: number; z: number };
  players: { x: number; z: number }[];
}

export const WALL_MAX_OFFSET = 3;

export function wallLayout(spot: Spot, cfg: WallConfig): WallLayout {
  const size = clamp(Math.round(cfg.size), 0, spot.maxWall);
  const side = spot.x >= 0 ? 1 : -1;
  // Default: the outside player lines up with the near post.
  let dx = side * GOAL_HALF_WIDTH - spot.x;
  let dz = -spot.z;
  const dl = Math.sqrt(dx * dx + dz * dz);
  dx /= dl;
  dz /= dl;
  const offset = clamp(cfg.offset, -WALL_MAX_OFFSET, WALL_MAX_OFFSET);
  const shift = offset - side * (size - 1) * 0.5 * WALL_SPACING;
  let cx = dx * WALL_DISTANCE - dz * shift;
  let cz = dz * WALL_DISTANCE + dx * shift;
  const cl = Math.sqrt(cx * cx + cz * cz);
  cx = (cx / cl) * WALL_DISTANCE;
  cz = (cz / cl) * WALL_DISTANCE;
  const ux = cx / WALL_DISTANCE;
  const uz = cz / WALL_DISTANCE;
  const rx = -uz;
  const rz = ux;
  const center = { x: spot.x + cx, z: spot.z + cz };
  const players = [];
  for (let i = 0; i < size; i++) {
    const o = (i - (size - 1) / 2) * WALL_SPACING;
    players.push({ x: center.x + rx * o, z: center.z + rz * o });
  }
  return { size, center, players };
}

/** Height of the wall's jump t seconds after contact. */
export function wallJumpY(t: number, p: SimParams): number {
  const tj = t - p.wallJumpDelay;
  if (tj <= 0 || tj >= p.wallJumpDuration) return 0;
  const s = tj / p.wallJumpDuration;
  return 4 * p.wallJumpHeight * s * (1 - s);
}
