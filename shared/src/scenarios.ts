// Fixed scenario suite for the cross-engine determinism check (SPEC §4.1).
// Launch states are computed once in Node and stored in the golden file, so
// the browser check exercises only the per-tick step.

import { TICK_RATE } from './geometry';
import { idealKeeperInput, kickInputForTarget, TAP } from './ideal';
import type { KeeperInput } from './input';
import { computeLaunch, powerForSpeed, type LaunchState } from './launch';
import type { SimParams } from './params';
import { simulateKick, type KickSetup, type Outcome, type OutcomeTag } from './sim';
import { makeSpot } from './spots';

export interface GoldenCase {
  name: string;
  setup: KickSetup;
  launch: LaunchState;
  keeper: KeeperInput | null;
  hash: number;
  outcome: Outcome;
  tag: OutcomeTag;
}

export interface Golden {
  params: SimParams;
  cases: GoldenCase[];
}

interface CaseDef {
  name: string;
  setup: KickSetup;
  target: [x: number, y: number];
  speed: number;
  curve: number;
  keeper: 'none' | 'tap' | 'ideal';
  delay?: number;
}

const DEFS: CaseDef[] = [
  { name: 'penalty-centre-no-flick', setup: { spot: makeSpot('penalty', 0, 11), wall: null }, target: [0.4, 1.2], speed: 22, curve: 0, keeper: 'none' },
  { name: 'penalty-corner-anticipated', setup: { spot: makeSpot('penalty', 0, 11), wall: null }, target: [-3.1, 0.5], speed: 28, curve: 0, keeper: 'ideal', delay: -0.3 },
  { name: 'box-angle-curl', setup: { spot: makeSpot('inside_box', 7, 13), wall: null }, target: [-2.5, 1.8], speed: 24, curve: 0.3, keeper: 'ideal', delay: 0.35 },
  { name: 'edge-wall-curl', setup: { spot: makeSpot('outside_box', -6, 20), wall: { size: 4, offset: 0 } }, target: [-3.0, 1.9], speed: 25, curve: -0.3, keeper: 'ideal', delay: 0.3 },
  { name: 'edge-wall-low', setup: { spot: makeSpot('outside_box', 4, 21), wall: { size: 4, offset: 0.5 } }, target: [2.0, 0.5], speed: 27, curve: 0, keeper: 'tap', delay: 0.2 },
  { name: 'long-range-dip', setup: { spot: makeSpot('long_range', 3, 31), wall: { size: 2, offset: 0 } }, target: [1.8, 2.2], speed: 31, curve: 0.15, keeper: 'ideal', delay: 0.4 },
  { name: 'long-range-sky', setup: { spot: makeSpot('long_range', -2, 28), wall: { size: 3, offset: -1 } }, target: [2.5, 3.2], speed: 32, curve: -0.1, keeper: 'none' },
  { name: 'post-zone', setup: { spot: makeSpot('outside_box', 0, 22), wall: null }, target: [3.6, 1.0], speed: 27, curve: 0, keeper: 'ideal', delay: 0.6 },
  { name: 'bar-zone', setup: { spot: makeSpot('outside_box', 1, 23), wall: null }, target: [0.5, 2.45], speed: 26, curve: 0.05, keeper: 'ideal', delay: 0.5 },
  { name: 'late-dive-corner', setup: { spot: makeSpot('outside_box', 0, 25), wall: null }, target: [3.2, 0.4], speed: 28, curve: 0, keeper: 'ideal', delay: 0.38 },
];

export function buildGolden(p: SimParams): Golden {
  const cases = DEFS.map((d): GoldenCase => {
    const input = kickInputForTarget(d.target[0], d.target[1], powerForSpeed(d.speed, p), d.curve, p);
    const launch = computeLaunch(d.setup.spot, input, p);
    const tick = Math.round((d.delay ?? 0) * TICK_RATE);
    const keeper =
      d.keeper === 'none' ? null : d.keeper === 'tap' ? { ...TAP, flickTick: tick } : idealKeeperInput(d.setup, launch, tick, p);
    const res = simulateKick(d.setup, launch, keeper, p);
    return { name: d.name, setup: d.setup, launch, keeper, hash: res.hash, outcome: res.outcome, tag: res.tag };
  });
  return { params: { ...p }, cases };
}

/** Re-run stored cases and report which hashes match. */
export function checkGolden(golden: Golden): { name: string; expected: number; actual: number; pass: boolean }[] {
  return golden.cases.map((c) => {
    const actual = simulateKick(c.setup, c.launch, c.keeper, golden.params).hash;
    return { name: c.name, expected: c.hash, actual, pass: actual === c.hash };
  });
}
