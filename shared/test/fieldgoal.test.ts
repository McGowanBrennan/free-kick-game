import { describe, expect, test } from 'vitest';
import {
  AI_PROFILES,
  DEFAULT_PARAMS as P,
  FG_BAR_Y,
  FG_HALF_WIDTH,
  FIELD_GOAL_LIMITS,
  FG_OP_TIME,
  HASH_X,
  aiFieldGoal,
  applyStrikeError,
  cableCamAt,
  fieldGoalCam,
  fieldGoalLaunch,
  fieldGoalSpot,
  fieldGoalWind,
  kickInputForTarget,
  makeSpot,
  mulberry32,
  simulateFieldGoal,
  type CableCam,
  v3,
} from '../src';

const calm = v3();
/** A kick with no rush, to test the posts and the wind on their own. */
const kick = (d: number, x: number, y: number, power: number, wind = calm) => {
  const spot = makeSpot('field_goal', 0, d);
  return simulateFieldGoal({ spot, wind, opTime: 1.3 }, fieldGoalLaunch(spot, kickInputForTarget(spot, x, y, power, 0, P, FIELD_GOAL_LIMITS), P), P, {
    noRush: true,
  });
};

describe('field goals', () => {
  test('through the middle, over the bar, is good; it crosses where it was aimed', () => {
    const r = kick(30, 0, 5, 0.6);
    expect(r.tag).toBe('good');
    expect(r.crossing!.x).toBeCloseTo(0, 1);
    expect(r.crossing!.y).toBeCloseTo(5, 1);
  });

  test('outside the uprights is wide (left is the kicker’s left), under the bar is short', () => {
    expect(kick(30, -FG_HALF_WIDTH - 1, 5, 0.6).tag).toBe('wide_left');
    expect(kick(30, FG_HALF_WIDTH + 1, 5, 0.6).tag).toBe('wide_right');
    expect(kick(30, 0, FG_BAR_Y - 1, 0.6).tag).toBe('short');
  });

  test('a weak kick from 50 m drops short', () => {
    expect(kick(50, 0, 5, 0).good).toBe(false);
    expect(kick(50, 0, 5, 0).tag).toBe('short');
  });

  test('off the woodwork: a kick skimming the bar can go in or bounce out', () => {
    const tags = [FG_BAR_Y + 0.05, FG_BAR_Y + 0.15].map((y) => kick(35, 0, y, 0.6));
    expect(tags.map((r) => r.tag)).toEqual(['doink_out', 'doink_in']);
    expect(tags.every((r) => r.events.some((e) => e.kind === 'bar'))).toBe(true);
    expect(kick(35, FG_HALF_WIDTH + 0.06, 6, 0.6).tag).toBe('doink_out');
  });

  test('wind carries the ball: crosswind sideways, headwind down, tailwind up', () => {
    const still = kick(35, 0, 5, 0.6).crossing!;
    expect(kick(35, 0, 5, 0.6, v3(5, 0, 0)).crossing!.x).toBeGreaterThan(1);
    expect(kick(35, 0, 5, 0.6, v3(-5, 0, 0)).crossing!.x).toBeLessThan(-1);
    expect(kick(35, 0, 5, 0.6, v3(0, 0, 5)).crossing!.y).toBeLessThan(still.y - 1);
    expect(kick(35, 0, 5, 0.6, v3(0, 0, -5)).crossing!.y).toBeGreaterThan(still.y + 0.5);
  });

  test('the call: decided as it crosses the plane, or as it lands short', () => {
    const good = kick(30, 0, 5, 0.6);
    expect(good.decidedTick).toBe(good.crossing!.tick);
    const short = kick(50, 0, 5, 0);
    expect(short.decidedTick).toBeLessThan(short.ticks);
    expect(short.events.some((e) => e.kind === 'ground' && e.tick === short.decidedTick)).toBe(true);
  });

  test('the same kick gives the same hash', () => {
    const a = kick(40, 1, 6, 0.7, v3(3, 0, -2));
    const b = kick(40, 1, 6, 0.7, v3(3, 0, -2));
    expect(a.hash).toBe(b.hash);
  });

  test('the rush: a low drive is blocked at the line, a kick struck up at ~30° clears it', () => {
    const spot = makeSpot('field_goal', 0, 40 * 0.9144);
    const at = (y: number) =>
      simulateFieldGoal({ spot, wind: calm, opTime: FG_OP_TIME }, fieldGoalLaunch(spot, kickInputForTarget(spot, 0, y, 0.7, 0, P, FIELD_GOAL_LIMITS), P), P);
    expect(at(4).tag).toBe('blocked');
    expect(at(10).tag).toBe('good');
  });

  test('the cable cam: swings across and back, easing at the ends, and repeats', () => {
    const cam: CableCam = { x: 1, z: 20, y: 9, amp: 3, period: 6 };
    expect(cableCamAt(cam, 0).x).toBeCloseTo(-2, 6);
    expect(cableCamAt(cam, 3).x).toBeCloseTo(4, 6);
    expect(cableCamAt(cam, 1.5).x).toBeCloseTo(1, 6);
    expect(cableCamAt(cam, 7.2).x).toBeCloseTo(cableCamAt(cam, 1.2).x, 6);
    // Slow at the ends of the swing, quick through the middle.
    expect(cableCamAt(cam, 0.1).x - cableCamAt(cam, 0).x).toBeLessThan(cableCamAt(cam, 1.6).x - cableCamAt(cam, 1.5).x);
  });

  test('the cable cam: a kick through it is no good; the same kick with the cam swung away is good', () => {
    const spot = makeSpot('field_goal', 0, 35);
    const launch = fieldGoalLaunch(spot, kickInputForTarget(spot, 0, 10, 0.7, 0, P, FIELD_GOAL_LIMITS), P);
    const plain = simulateFieldGoal({ spot, wind: calm, opTime: FG_OP_TIME }, launch, P, { record: true });
    expect(plain.good).toBe(true);
    // Hang the cam where the ball is halfway, at the middle of its swing at that moment.
    const b = plain.frames!.ball;
    const k = 3 * Math.floor(b.length / 6);
    const t = k / 3 / 240;
    const cam: CableCam = { x: b[k], z: b[k + 2], y: b[k + 1], amp: 4, period: 8 };
    const hit = simulateFieldGoal({ spot, wind: calm, opTime: FG_OP_TIME, cam, clock: 2 - t }, launch, P);
    expect(hit.tag).toBe('cam');
    expect(hit.events.some((e) => e.detail === 'cam')).toBe(true);
    expect(simulateFieldGoal({ spot, wind: calm, opTime: FG_OP_TIME, cam, clock: 4 - t }, launch, P).good).toBe(true);
  });

  test('the cable cam: none in round 1, always from round 3, hung in the way of a standard kick', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 20; i++) {
      const spot = fieldGoalSpot(rand, 1);
      expect(fieldGoalCam(rand, 1, spot, P)).toBeNull();
    }
    for (let i = 0; i < 20; i++) {
      const spot = fieldGoalSpot(rand, 4);
      const cam = fieldGoalCam(rand, 4, spot, P)!;
      expect(cam).not.toBeNull();
      expect(cam.z).toBeGreaterThan(spot.z * 0.3);
      expect(cam.z).toBeLessThan(spot.z * 0.7);
      expect(cam.y).toBeGreaterThan(6);
    }
  });

  test('spots: on the hashes (or the middle), further out each round', () => {
    const rand = mulberry32(2);
    const xs = new Set<number>();
    for (let i = 0; i < 200; i++) xs.add(fieldGoalSpot(rand, 3).x);
    expect([...xs].sort((a, b) => a - b)).toEqual([-HASH_X, 0, HASH_X]);
  });

  test('spots get longer each round; the wind gets up', () => {
    const rand = mulberry32(9);
    const avg = (round: number) => {
      let d = 0;
      let w = 0;
      for (let i = 0; i < 200; i++) {
        d += fieldGoalSpot(rand, round).distance;
        const wind = fieldGoalWind(rand, round);
        w += Math.hypot(wind.x, wind.z);
      }
      return { d: d / 200, w: w / 200 };
    };
    const r1 = avg(1);
    const r5 = avg(5);
    expect(r5.d).toBeGreaterThan(r1.d + 15);
    expect(r5.w).toBeGreaterThan(r1.w * 1.8);
  });

  test('the AI makes short ones nearly always and misses more from long range (NFL: ~99% under 30 yd, ~70% from 50+)', () => {
    const rand = mulberry32(4);
    const rate = (round: number) => {
      let good = 0;
      for (let i = 0; i < 200; i++) {
        const spot = fieldGoalSpot(rand, round);
        const wind = fieldGoalWind(rand, round);
        const cam = fieldGoalCam(rand, round, spot, P);
        const { kick: k, clock } = aiFieldGoal({ spot, wind, cam }, AI_PROFILES.medium, rand, P, 2);
        if (simulateFieldGoal({ spot, wind, opTime: FG_OP_TIME, cam, clock }, applyStrikeError(fieldGoalLaunch(spot, k, P), k, rand, P), P).good) good++;
      }
      return good / 200;
    };
    expect(rate(1)).toBeGreaterThan(0.9);
    expect(rate(6)).toBeLessThan(rate(1) - 0.35);
  });
});
