import { describe, expect, test } from 'vitest';
import {
  BALL_RADIUS,
  DEFAULT_PARAMS as P,
  INPUT,
  KeeperSim,
  TAP,
  computeLaunch,
  flickForHandTarget,
  generateSpot,
  kickInputForTarget,
  kickInputFromSwipe,
  makeSpot,
  mulberry32,
  planKeeper,
  powerForSpeed,
  simulateKick,
  sweepCapsule,
  tuningReport,
  v3,
  wallLayout,
  type SwipeSample,
} from '../src';

const swipe = (points: [number, number, number][]): SwipeSample[] => points.map(([x, y, t]) => ({ x, y, t }));

describe('swipe → kick input', () => {
  test('straight-up swipe aims at the centre with no curve', () => {
    const k = kickInputFromSwipe(swipe([[100, 800, 0], [100, 650, 60], [100, 500, 120]]), 1000)!;
    expect(k.u).toBeCloseTo(0);
    expect(k.c).toBeCloseTo(0);
    expect(k.L).toBeCloseTo(0.3);
  });

  test('a path bowing right gives positive curve', () => {
    const k = kickInputFromSwipe(swipe([[100, 800, 0], [160, 650, 60], [100, 500, 120]]), 1000)!;
    expect(k.c).toBeGreaterThan(0.15);
  });

  test('angled swipe aims right, faster swipe means more power', () => {
    const slow = kickInputFromSwipe(swipe([[0, 800, 0], [100, 600, 250], [150, 500, 400]]), 1000)!;
    const fast = kickInputFromSwipe(swipe([[0, 800, 0], [100, 600, 40], [150, 500, 60]]), 1000)!;
    expect(slow.u).toBeGreaterThan(0.4);
    expect(fast.p).toBeGreaterThan(slow.p);
  });

  test('downward, tiny or slow-drawn swipes are rejected', () => {
    expect(kickInputFromSwipe(swipe([[100, 500, 0], [100, 800, 100]]), 1000)).toBeNull();
    expect(kickInputFromSwipe(swipe([[100, 500, 0], [100, 470, 100]]), 1000)).toBeNull();
    expect(kickInputFromSwipe(swipe([[100, 800, 0], [100, 500, 900]]), 1000)).toBeNull();
  });
});

describe('launch', () => {
  test('aimed shot crosses the goal plane near its target', () => {
    const spot = makeSpot('outside_box', 0, 20);
    const launch = computeLaunch(spot, kickInputForTarget(1.5, 1.2, powerForSpeed(P.vRef, P), 0, P), P);
    const res = simulateKick({ spot, wall: null }, launch, null, P, { noKeeper: true });
    expect(res.lineCrossing!.x).toBeCloseTo(1.5, 0);
    expect(res.lineCrossing!.y).toBeCloseTo(1.2, 0);
  });

  test('more power with the same aim arrives higher', () => {
    const spot = makeSpot('outside_box', 0, 22);
    const cross = (speed: number) =>
      simulateKick(
        { spot, wall: null },
        computeLaunch(spot, kickInputForTarget(0, 1.2, powerForSpeed(speed, P), 0, P), P),
        null,
        P,
        { noKeeper: true },
      ).lineCrossing!.y;
    expect(cross(30)).toBeGreaterThan(cross(24));
  });
});

describe('collision', () => {
  test('sweep hits a capsule side-on at the right time', () => {
    const t = sweepCapsule(v3(-1, 1, 0), v3(2, 0, 0), v3(0, 0, 0), v3(0, 2, 0), 0.5);
    expect(t).toBeCloseTo(0.25);
  });

  test('sweep misses when passing beside it', () => {
    expect(sweepCapsule(v3(-1, 1, 1), v3(2, 0, 0), v3(0, 0, 0), v3(0, 2, 0), 0.5)).toBe(-1);
  });

  test('sweep hits an end cap', () => {
    const t = sweepCapsule(v3(0, 4, 0), v3(0, -2, 0), v3(0, 0, 0), v3(0, 2, 0), 0.5);
    expect(t).toBeCloseTo(0.75);
  });
});

describe('keeper', () => {
  test('flickForHandTarget inverts planKeeper', () => {
    for (const [dx, h] of [
      [2.5, 0.4],
      [-3.0, 1.2],
      [1.8, 2.0],
    ]) {
      const f = flickForHandTarget(dx, h, P);
      const plan = planKeeper({ ...f, durMs: 150, flickTick: 0 }, 0, P);
      expect(plan.mode).toBe('dive');
      expect(plan.target.x).toBeCloseTo(dx, 1);
      expect(plan.target.y).toBeCloseTo(h, 1);
    }
  });

  test('screen-right flick dives to world −x (keeper camera looks down +z)', () => {
    const plan = planKeeper({ vx: 0.3, vy: -0.05, durMs: 150, flickTick: 0 }, 0, P);
    expect(plan.target.x).toBeLessThan(-2);
  });

  test('tap means set; no input means stance', () => {
    expect(planKeeper({ ...TAP, flickTick: 0 }, 0, P).mode).toBe('set');
    expect(planKeeper(null, 0, P).mode).toBe('stance');
  });

  test('hands reach the dive target at full extension', () => {
    const plan = planKeeper({ ...flickForHandTarget(3, 0.5, P), durMs: 150, flickTick: 0 }, 0, P);
    const sim = new KeeperSim(plan, 0, P);
    const parts = sim.partsAt(Math.round((P.keeperWindup + plan.travel) * 240) + 1);
    const handX = (parts[4].a.x + parts[5].a.x) / 2;
    expect(handX).toBeCloseTo(3, 1);
  });
});

describe('spots and wall', () => {
  test('generated spots respect their category', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const s = generateSpot(rand);
      if (s.category === 'outside_box') {
        expect(s.distance).toBeGreaterThanOrEqual(18);
        expect(s.distance).toBeLessThanOrEqual(25);
        expect(s.maxWall).toBe(4);
      }
      if (s.category === 'long_range') expect(s.distance).toBeGreaterThanOrEqual(25);
      if (s.category === 'penalty' || s.category === 'inside_box') expect(s.maxWall).toBe(0);
    }
  });

  test('wall stands 9.15 m from the ball', () => {
    const spot = makeSpot('outside_box', 5, 20);
    for (const pl of wallLayout(spot, { size: 4, offset: 1 }).players) {
      expect(Math.hypot(pl.x - spot.x, pl.z - spot.z)).toBeGreaterThan(9.1);
      expect(Math.hypot(pl.x - spot.x, pl.z - spot.z)).toBeLessThan(9.2);
    }
  });
});

describe('outcomes', () => {
  const penalty = makeSpot('penalty', 0, 11);
  const shot = (x: number, y: number, speed: number) =>
    computeLaunch(penalty, kickInputForTarget(x, y, powerForSpeed(speed, P), 0, P), P);

  test('clean goal with no keeper', () => {
    const res = simulateKick({ spot: penalty, wall: null }, shot(2, 1, 25), null, P, { noKeeper: true });
    expect([res.outcome, res.tag]).toEqual(['goal', 'clean']);
  });

  test('wild high-and-right shot misses', () => {
    const launch = computeLaunch(penalty, kickInputForTarget(5, 3.4, 1, 0, P), P);
    const res = simulateKick({ spot: penalty, wall: null }, launch, null, P);
    expect(res.outcome).toBe('miss');
  });

  test('ball starts on the ground at the spot', () => {
    expect(shot(0, 1, 20).pos).toEqual(v3(0, BALL_RADIUS, 11));
  });

  test('same inputs give the same hash', () => {
    const launch = shot(-2.8, 0.6, 28);
    const k = { ...flickForHandTarget(-2.8, 0.6, P), durMs: 150, flickTick: 30 };
    const a = simulateKick({ spot: penalty, wall: null }, launch, k, P);
    const b = simulateKick({ spot: penalty, wall: null }, launch, k, P);
    expect(a.hash).toBe(b.hash);
  });
});

describe('tuning targets (SPEC §3.2, §4.2)', () => {
  const report = tuningReport(P);
  for (const check of report) {
    test(`${check.name}: ${check.value} (expect ${check.expect})`, () => {
      expect(check.pass).toBe(true);
    });
  }
  test('maxCurve constant matches spec', () => expect(INPUT.maxCurve).toBe(0.35));
});
