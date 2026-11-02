// Helpers that invert the keeper's input mapping: dive to where the ball will
// be. (The shooter's inverse, kickInputForTarget, lives with the solver in launch.ts.)

import type { KeeperInput } from './input';
import { flickForHandTarget } from './keeper';
import type { LaunchState } from './launch';
import type { SimParams } from './params';
import { simulateKick, type KickSetup } from './sim';

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
