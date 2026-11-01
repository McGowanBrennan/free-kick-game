import { describe, expect, test } from 'vitest';
import {
  AI_PROFILES,
  DEFAULT_PARAMS as P,
  aiKeeper,
  aiKick,
  aiWall,
  computeLaunch,
  createMatch,
  currentRound,
  generateSpot,
  makeSpot,
  mulberry32,
  nextShooter,
  recordKick,
  simulateKick,
  v3,
  winner,
  type MatchState,
  type PlayerId,
  type Vec3,
} from '../src';

function play(first: PlayerId, results: boolean[]): MatchState {
  let s = createMatch(first);
  for (const scored of results) {
    const shooter = nextShooter(s);
    if (shooter === null) throw new Error('match already over');
    s = recordKick(s, { shooter, scored, outcome: scored ? 'goal' : 'save', tag: scored ? 'clean' : 'parried' });
  }
  return s;
}

describe('match rules', () => {
  test('shooters alternate starting with the coin-toss winner', () => {
    const s = play(1, [true, false, true]);
    expect(s.kicks.map((k) => k.shooter)).toEqual([1, 0, 1]);
    expect(nextShooter(s)).toBe(0);
    expect(currentRound(s)).toBe(2);
  });

  test('ends early once a side cannot catch up', () => {
    // A: ✓✓✓ B: ✕✕✕ → A leads 3–0 with B having 2 left.
    const s = play(0, [true, false, true, false, true, false]);
    expect(winner(s)).toBe(0);
    expect(nextShooter(s)).toBeNull();
  });

  test('does not end while the trailing side can still draw level', () => {
    const s = play(0, [true, false, true, false, true]); // 3–0, B has 3 left
    expect(winner(s)).toBeNull();
  });

  test('level after five each goes to sudden death', () => {
    const s = play(0, Array(10).fill(true));
    expect(winner(s)).toBeNull();
    expect(currentRound(s)).toBe(6);
  });

  test('sudden death is decided only at the end of a round', () => {
    const tied = Array(10).fill(true) as boolean[];
    expect(winner(play(0, [...tied, false]))).toBeNull();
    expect(winner(play(0, [...tied, false, true]))).toBe(1);
    expect(winner(play(0, [...tied, true, true]))).toBeNull();
    expect(winner(play(0, [...tied, true, true, true, false]))).toBe(0);
  });
});

describe('AI', () => {
  test('medium shooter mostly hits the target from the edge of the box', () => {
    const rand = mulberry32(3);
    let onTarget = 0;
    for (let i = 0; i < 60; i++) {
      const spot = generateSpot(rand, 'outside_box');
      const wall = aiWall(spot, rand);
      const launch = computeLaunch(spot, aiKick(spot, wall, AI_PROFILES.medium, rand, P), P);
      const res = simulateKick({ spot, wall }, launch, null, P, { noKeeper: true });
      if (res.outcome === 'goal') onTarget++;
    }
    expect(onTarget).toBeGreaterThan(25);
  });

  test('the shooter allows for the wind: as many on target in a strong crosswind as in a calm', () => {
    const onTarget = (wind?: Vec3) => {
      const rand = mulberry32(3);
      let n = 0;
      for (let i = 0; i < 60; i++) {
        const spot = generateSpot(rand, 'outside_box');
        const wall = aiWall(spot, rand);
        const setup = { spot, wall, wind };
        const launch = computeLaunch(spot, aiKick(spot, wall, AI_PROFILES.hard, rand, P, wind), P);
        if (simulateKick(setup, launch, null, P, { noKeeper: true }).outcome === 'goal') n++;
      }
      return n;
    };
    expect(onTarget(v3(7, 0, 0))).toBeGreaterThan(onTarget() * 0.8);
  });

  test('a hard keeper saves more than an easy one', () => {
    const saves = (level: 'easy' | 'hard') => {
      const rand = mulberry32(11);
      let n = 0;
      for (let i = 0; i < 80; i++) {
        const spot = generateSpot(rand, 'outside_box');
        const setup = { spot, wall: null };
        const launch = computeLaunch(spot, aiKick(spot, null, AI_PROFILES.medium, rand, P), P);
        if (simulateKick(setup, launch, aiKeeper(setup, launch, AI_PROFILES[level], rand, P), P).outcome === 'save') n++;
      }
      return n;
    };
    expect(saves('hard')).toBeGreaterThan(saves('easy'));
  });

  test('AI keeper guesses early on penalties sometimes', () => {
    const spot = makeSpot('penalty', 0, 11);
    const rand = mulberry32(5);
    let early = 0;
    for (let i = 0; i < 40; i++) {
      const launch = computeLaunch(spot, aiKick(spot, null, AI_PROFILES.medium, rand, P), P);
      if (aiKeeper({ spot, wall: null }, launch, AI_PROFILES.hard, rand, P).flickTick < 0) early++;
    }
    expect(early).toBeGreaterThan(10);
  });
});
