// AI opponent (SPEC §7.1). It produces the same inputs a player would, through
// the same sim; difficulty only changes reaction time, reading and accuracy.

import { TICK_RATE } from './geometry';
import { TAP } from './ideal';
import type { KeeperInput, KickInput } from './input';
import { flickForHandTarget } from './keeper';
import { computeLaunch, kickInputForTarget, powerForSpeed, type LaunchState } from './launch';
import type { SimParams } from './params';
import { ballArrivalTick, simulateKick, type KickSetup } from './sim';
import type { Spot } from './spots';
import { clamp, lerpNum, v3, type Vec3 } from './vec';
import type { WallConfig } from './wall';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface AiProfile {
  /** Keeper reaction delay after contact, seconds */
  reactMean: number;
  reactSd: number;
  /** 0 = reads only the initial direction, 1 = reads the curl perfectly */
  curveRead: number;
  /** Chance of guessing before contact when the shot is too quick to react to */
  penaltyGuess: number;
  /** Keeper's misjudgement of the crossing point, metres (σ) */
  keeperError: number;
  /** Shooter misjudgement of the aim point, metres (σ), on top of the strike error every shot carries */
  aimSd: number;
  /** Shooter power error (σ, in power units) */
  powerSd: number;
}

export const AI_PROFILES: Readonly<Record<Difficulty, AiProfile>> = {
  easy: { reactMean: 0.45, reactSd: 0.07, curveRead: 0, penaltyGuess: 0.4, keeperError: 0.45, aimSd: 0.8, powerSd: 0.12 },
  medium: { reactMean: 0.32, reactSd: 0.05, curveRead: 0.5, penaltyGuess: 0.7, keeperError: 0.3, aimSd: 0.45, powerSd: 0.08 },
  hard: { reactMean: 0.24, reactSd: 0.04, curveRead: 1, penaltyGuess: 0.8, keeperError: 0.18, aimSd: 0.25, powerSd: 0.05 },
};

/** Standard normal sample from a uniform source (Box–Muller). */
export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function aiWall(spot: Spot, rand: () => number): WallConfig | null {
  if (spot.maxWall === 0) return null;
  return { size: spot.maxWall, offset: (rand() - 0.5) * 0.6 };
}

/** The free kick round's wind: barely a breath early on, up to ~7 m/s (15 mph) from round 5, from any direction. */
export function freeKickWind(rand: () => number, round: number): Vec3 {
  const speed = (0.3 + 0.7 * rand()) * Math.min(7, 1.5 + round * 1.1);
  const a = rand() * Math.PI * 2;
  return v3(Math.cos(a) * speed, 0, Math.sin(a) * speed);
}

export function aiKick(
  spot: Spot,
  wall: WallConfig | null,
  profile: AiProfile,
  rand: () => number,
  p: SimParams,
  wind?: Vec3,
): KickInput {
  const walled = !!wall && wall.size > 0;
  const nearSide = spot.x >= 0 ? 1 : -1;
  // With a wall on the near post, mostly go far post; otherwise pick a side.
  const side = walled ? (rand() < 0.75 ? -nearSide : nearSide) : rand() < 0.5 ? -1 : 1;
  const x = side * (1.5 + rand() * 1.8);
  const high = rand() < (walled ? 0.7 : 0.4);
  const y = high ? 1.5 + rand() * 0.7 : 0.25 + rand() * 0.5;
  // Curl that starts outside the target (away from the middle and the wall) and bends back in.
  const curve = walled || rand() < 0.4 ? side * (0.25 + rand() * 0.55) : 0;
  const power = clamp(powerForSpeed(p.vRef, p) + gaussian(rand) * profile.powerSd, 0, p.overhitThreshold);
  const ax = x + gaussian(rand) * profile.aimSd * 0.6;
  const ay = Math.max(0.15, y + gaussian(rand) * profile.aimSd * 0.4);
  const kick = kickInputForTarget(spot, ax, ay, power, curve, p);
  if (!wind || (wind.x === 0 && wind.z === 0)) return kick;
  // Allow for the wind: aim off by as much as it'll carry the ball, as well as
  // this level reads it (the better ones judge it closely, the weaker ones by half).
  const launch = computeLaunch(spot, kick, p);
  const calm = simulateKick({ spot, wall: null }, launch, null, p, { noKeeper: true }).lineCrossing;
  const blown = simulateKick({ spot, wall: null, wind }, launch, null, p, { noKeeper: true }).lineCrossing;
  if (!calm || !blown) return kick;
  const read = clamp(0.55 + 0.4 * profile.curveRead + gaussian(rand) * 0.15, 0, 1.2);
  return kickInputForTarget(spot, ax - (blown.x - calm.x) * read, Math.max(0.15, ay - (blown.y - calm.y) * read), power, curve, p);
}

export function aiKeeper(
  setup: KickSetup,
  launch: LaunchState,
  profile: AiProfile,
  rand: () => number,
  p: SimParams,
): KeeperInput {
  const keeperX = setup.spot.keeperX;
  const truth = simulateKick(setup, launch, null, p, { noKeeper: true }).keeperCrossing;
  const reactTick = Math.round(Math.max(0.15, profile.reactMean + gaussian(rand) * profile.reactSd) * TICK_RATE);
  if (!truth) return { ...TAP, flickTick: reactTick };

  const arrival = ballArrivalTick(launch, p, setup.wind) / TICK_RATE;
  if (arrival < 0.55 && rand() < profile.penaltyGuess) {
    // Too quick to react to: guess before the kick. Reading the run-up gets the
    // side right a little more often than a coin toss, and roughly where.
    const trueSide = truth.x >= keeperX ? 1 : -1;
    const read = rand() < 0.55 + profile.curveRead * 0.1;
    const gx = read
      ? clamp(truth.x - keeperX + gaussian(rand) * profile.keeperError * 2, -3.3, 3.3)
      : -trueSide * (1.6 + rand() * 1.5);
    const gy = read ? clamp(truth.y + gaussian(rand) * profile.keeperError * 1.5, 0.3, 2.3) : 0.3 + rand() * 1.6;
    const flickTick = -Math.round((0.2 + rand() * 0.4) * TICK_RATE);
    return { ...flickForHandTarget(gx, gy, p), durMs: 150, flickTick };
  }

  // Read the flight: weaker keepers follow the initial direction and miss the curl.
  const straight = simulateKick(setup, { ...launch, spin: v3() }, null, p, { noKeeper: true }).keeperCrossing;
  const readX = straight ? lerpNum(straight.x, truth.x, profile.curveRead) : truth.x;
  const readY = straight ? lerpNum(straight.y, truth.y, profile.curveRead) : truth.y;
  const px = readX + gaussian(rand) * profile.keeperError;
  const py = clamp(readY + gaussian(rand) * profile.keeperError * 0.6, 0.2, 2.6);
  const dx = px - keeperX;
  if (Math.abs(dx) < 0.8 && py < p.setReachY) return { ...TAP, flickTick: reactTick };
  return { ...flickForHandTarget(dx, py, p), durMs: 150, flickTick: reactTick };
}
