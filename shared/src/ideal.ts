// Helpers that invert the input mappings: aim at a point, or dive to where the
// ball will be. Used by the tuning tools now and by the AI opponent later.

import { GOAL_HALF_WIDTH } from './geometry';
import { INPUT, type KeeperInput, type KickInput } from './input';
import { flickForHandTarget } from './keeper';
import type { LaunchState } from './launch';
import type { SimParams } from './params';
import { simulateKick, type KickSetup } from './sim';
import { clamp } from './vec';

export function kickInputForTarget(x: number, y: number, power: number, curve: number, p: SimParams): KickInput {
  return {
    u: clamp(x / (GOAL_HALF_WIDTH + p.aimOutsidePost), -1, 1),
    L: INPUT.minAimLen + clamp(y / p.maxTargetHeight, 0, 1) * (INPUT.maxAimLen - INPUT.minAimLen),
    p: power,
    c: curve,
    durMs: 150,
  };
}

export const TAP: Omit<KeeperInput, 'flickTick'> = { vx: 0, vy: 0, durMs: 80 };

/**
 * The flick a perfect keeper would make at `flickTick`: dive to where the ball
 * crosses the keeper's plane, or stay set for shots straight at them.
 */
export function idealKeeperInput(setup: KickSetup, launch: LaunchState, flickTick: number, p: SimParams): KeeperInput {
  const path = simulateKick(setup, launch, null, p, { noKeeper: true });
  const cross = path.keeperCrossing;
  if (!cross) return { ...TAP, flickTick };
  const dx = cross.x - setup.spot.keeperX;
  if (Math.abs(dx) < 0.8 && cross.y < p.setReachY) return { ...TAP, flickTick };
  return { ...flickForHandTarget(dx, cross.y, p), durMs: 150, flickTick };
}
