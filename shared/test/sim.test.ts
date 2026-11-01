import { describe, expect, test } from 'vitest';
import {
  BALL_RADIUS,
  analyzeSwipe,
  applyStrikeError,
  DEFAULT_PARAMS as P,
  KeeperSim,
  TAP,
  computeLaunch,
  flickForHandTarget,
  generateSpot,
  kickInputForTarget,
  makeSpot,
  mulberry32,
  planKeeper,
  powerForSpeed,
  simulateKick,
  startLineOnScreen,
  sweepCapsule,
  tuningReport,
  NET_BACK_Z,
  v3,
  wallLayout,
  type Spot,
  type SwipeSample,
  type Vec3,
} from '../src';

const swipe = (points: [number, number, number][]): SwipeSample[] => points.map(([x, y, t]) => ({ x, y, t }));

describe('swipe analysis', () => {
  test('straight-up swipe has no curl, length in screen heights', () => {
    const a = analyzeSwipe(swipe([[100, 800, 0], [100, 650, 60], [100, 500, 120]]), 1000)!;
    expect(a.turn).toBe(0);
    expect(a.startDx).toBeCloseTo(0);
    expect(a.length).toBeCloseTo(0.3);
  });

  test('a bent swipe starts the ball along its first part; a slight thumb arc stays straight', () => {
    // Sets off up-and-right, finishes straight up the screen: starts right of the chord.
    const bowed = analyzeSwipe(swipe([[100, 800, 0], [150, 700, 40], [165, 650, 60], [150, 600, 80], [100, 500, 120]]), 1000)!;
    expect(bowed.turn).toBeGreaterThan(0.3);
    expect(bowed.startDx).toBeGreaterThan(0.3);
    expect(bowed.startDy).toBeLessThan(0);
    const hook = analyzeSwipe(swipe([[100, 800, 0], [100, 700, 40], [100, 620, 70], [80, 560, 100], [40, 520, 120]]), 1000)!;
    expect(hook.turn).toBeGreaterThan(0.2); // straight up then hooked left: starts right of the chord
    const slight = analyzeSwipe(swipe([[100, 800, 0], [104, 700, 40], [105, 650, 60], [104, 600, 80], [100, 500, 120]]), 1000)!;
    expect(slight.turn).toBe(0);
  });

  test('power follows average speed and ignores a slow start', () => {
    const fast = analyzeSwipe(swipe([[0, 800, 0], [0, 700, 40], [0, 500, 80]]), 1000)!;
    const lazyStart = analyzeSwipe(swipe([[0, 800, 0], [0, 790, 150], [0, 700, 190], [0, 500, 230]]), 1000)!;
    const slow = analyzeSwipe(swipe([[0, 800, 0], [0, 650, 250], [0, 500, 400]]), 1000)!;
    expect(fast.power).toBeGreaterThan(slow.power);
    expect(lazyStart.power).toBeCloseTo(fast.power, 1);
  });

  test('power is the flick at its fastest: slowing to stop on the target keeps it', () => {
    // Same distance and time; one is even, one snaps then eases into the target.
    const even = analyzeSwipe(swipe([[0, 800, 0], [0, 725, 40], [0, 650, 80], [0, 575, 120], [0, 500, 160]]), 1000)!;
    const snap = analyzeSwipe(swipe([[0, 800, 0], [0, 680, 40], [0, 560, 80], [0, 515, 120], [0, 500, 160]]), 1000)!;
    expect(snap.power).toBeGreaterThan(even.power + 0.15);
  });

  test('swiping up and pulling back down is a chip, aimed at the top of the swipe', () => {
    const chip = analyzeSwipe(swipe([[100, 800, 0], [100, 650, 60], [100, 500, 120], [100, 450, 160], [100, 530, 220]]), 1000)!;
    expect(chip.chip).toBe(true);
    expect(chip.aimIndex).toBe(3);
    expect(chip.length).toBeCloseTo(0.35);
    const flick = analyzeSwipe(swipe([[100, 800, 0], [100, 650, 60], [100, 500, 120], [100, 505, 140]]), 1000)!;
    expect(flick.chip).toBe(false);
    expect(flick.aimIndex).toBe(3);
    // A curl that hooks over and finishes heading sideways and a little down is still a curl.
    const hook = analyzeSwipe(swipe([[100, 800, 0], [110, 650, 50], [150, 520, 100], [220, 470, 140], [300, 500, 180]]), 1000)!;
    expect(hook.chip).toBe(false);
    expect(hook.turn).not.toBe(0);
    // A curve that rolls over the top and comes well down at the end is a curl too.
    const rollover = analyzeSwipe(
      swipe([[100, 800, 0], [150, 600, 50], [230, 480, 90], [320, 450, 130], [400, 480, 160], [450, 560, 190]]),
      1000,
    )!;
    expect(rollover.chip).toBe(false);
    expect(rollover.turn).not.toBe(0);
    expect(rollover.aimIndex).toBe(5);
  });

  test('downward, tiny, sideways or slow-drawn swipes are rejected', () => {
    expect(analyzeSwipe(swipe([[100, 500, 0], [100, 800, 100]]), 1000)).toBeNull();
    expect(analyzeSwipe(swipe([[100, 500, 0], [100, 470, 100]]), 1000)).toBeNull();
    expect(analyzeSwipe(swipe([[100, 500, 0], [400, 490, 100]]), 1000)).toBeNull();
    expect(analyzeSwipe(swipe([[100, 800, 0], [100, 500, 1200]]), 1000)).toBeNull();
  });

  test('startLineOnScreen: no turn runs through the aim point; a turn swings the line to that side', () => {
    const ball = { x: 200, y: 700 };
    const aim = { x: 260, y: 200 };
    const L = { x: 0, y: 200 };
    const R = { x: 400, y: 200 };
    expect(startLineOnScreen(ball, aim, 0, L, R)!.x).toBeCloseTo(260);
    // Positive turn = the swipe set off to the right of its chord: starts right of the aim.
    expect(startLineOnScreen(ball, aim, 0.2, L, R)!.x).toBeGreaterThan(300);
    expect(startLineOnScreen(ball, aim, -0.2, L, R)!.x).toBeLessThan(220);
    expect(startLineOnScreen(ball, { x: 200, y: 900 }, 0, L, R)).toBeNull();
  });
});

describe('launch', () => {
  const cross = (spot: Spot, launch: ReturnType<typeof computeLaunch>) =>
    simulateKick({ spot, wall: null }, launch, null, P, { noKeeper: true }).lineCrossing!;

  test('aimed shot crosses the goal plane on its target', () => {
    const spot = makeSpot('outside_box', 0, 20);
    const c = cross(spot, computeLaunch(spot, kickInputForTarget(spot, 1.5, 1.2, powerForSpeed(P.vRef, P), 0, P), P));
    expect(c.x).toBeCloseTo(1.5, 1);
    expect(c.y).toBeCloseTo(1.2, 1);
  });

  test('more power is faster but lands in the same place (below the overhit threshold)', () => {
    const spot = makeSpot('outside_box', 0, 22);
    const at = (speed: number) => cross(spot, computeLaunch(spot, kickInputForTarget(spot, 0, 1.2, powerForSpeed(speed, P), 0, P), P));
    const soft = at(20);
    const hard = at(30);
    expect(hard.tick).toBeLessThan(soft.tick);
    expect(hard.y).toBeCloseTo(soft.y, 1);
  });

  test('the ball leaves along the start line and bends onto the aim point', () => {
    const spot = makeSpot('outside_box', 0, 25);
    const launch = computeLaunch(spot, { x: -2.5, y: 1.8, p: 0.5, sx: 1, durMs: 150 }, P);
    // Heading at launch points through x = 1 on the goal line …
    const sx = spot.x + (launch.vel.x * -spot.z) / launch.vel.z;
    expect(sx).toBeCloseTo(1, 3);
    // … and the solved spin carries it 3.5 m left, onto the target.
    expect(launch.spin.y).toBeGreaterThan(0);
    const c = cross(spot, launch);
    expect(c.x).toBeCloseTo(-2.5, 1);
    expect(c.y).toBeCloseTo(1.8, 1);
  });

  test('a bend tighter than maxSpin allows still lands on the aim, starting as wide as full curl allows', () => {
    const spot = makeSpot('penalty', 0, 11);
    const launch = computeLaunch(spot, { x: 3, y: 1, p: 0.6, sx: -3, durMs: 150 }, P);
    expect(launch.spin.y).toBeLessThan(-0.5 * P.maxSpin);
    const sx = spot.x + (launch.vel.x * -spot.z) / launch.vel.z;
    expect(sx).toBeGreaterThan(-3);
    expect(sx).toBeLessThan(3);
    const c = cross(spot, launch);
    expect(c.x).toBeCloseTo(3, 1);
    expect(c.y).toBeCloseTo(1, 1);
  });

  test('a harder strike can carry more spin; a trivela less than an inside-foot curler', () => {
    const spot = makeSpot('outside_box', 0, 25);
    const spinAt = (p: number, sx: number, x: number) => Math.abs(computeLaunch(spot, { x, y: 1.5, p, sx, durMs: 150 }, P).spin.y);
    // Asking for an impossible bend pins the spin at its cap.
    expect(spinAt(0.9, 9, -3)).toBeGreaterThan(spinAt(0.3, 9, -3));
    expect(spinAt(0.6, -9, 3)).toBeLessThan(spinAt(0.6, 9, -3));
  });

  test('a chip floats up with backspin and drops onto the aim point', () => {
    const spot = makeSpot('penalty', 0, 11);
    const panenka = computeLaunch(spot, { x: 0, y: 1.6, p: 0.1, sx: 0, durMs: 300, chip: true }, P);
    const v = panenka.vel;
    const speed = Math.hypot(v.x, v.y, v.z);
    expect(speed).toBeLessThan(15);
    expect((Math.asin(v.y / speed) * 180) / Math.PI).toBeGreaterThan(40);
    const res = simulateKick({ spot, wall: null }, panenka, null, P, { noKeeper: true, record: true });
    expect(res.lineCrossing!.y).toBeCloseTo(1.6, 1);
    const b = res.frames!.ball;
    let apex = 0;
    for (let i = 1; i < b.length; i += 3) apex = Math.max(apex, b[i]);
    expect(apex).toBeGreaterThan(2.4);
  });

  test('kickInputForTarget round-trips: the curl it asks for is the spin the solver finds', () => {
    const spot = makeSpot('outside_box', 5, 22);
    for (const curl of [-0.6, -0.3, 0.4, 0.9]) {
      const launch = computeLaunch(spot, kickInputForTarget(spot, -2.5, 1.9, 0.5, curl, P), P);
      expect(launch.spin.y / P.maxSpin).toBeCloseTo(curl, 2);
    }
  });

  test('a soft shot aimed low skims, bounces and rolls in, even from 35 m', () => {
    const spot = makeSpot('long_range', 0, 35);
    const res = simulateKick({ spot, wall: null }, computeLaunch(spot, kickInputForTarget(spot, 1, 0.2, 0.15, 0, P), P), null, P, {
      noKeeper: true,
      record: true,
    });
    expect(res.outcome).toBe('goal');
    const b = res.frames!.ball;
    let apex = 0;
    for (let i = 1; i < b.length; i += 3) apex = Math.max(apex, b[i]);
    expect(apex).toBeLessThan(0.6);
  });

  test("a weak strike can't loop up to the top corner from 35 m", () => {
    const spot = makeSpot('long_range', 0, 35);
    const res = simulateKick({ spot, wall: null }, computeLaunch(spot, kickInputForTarget(spot, 2.5, 2.1, 0, 0, P), P), null, P, {
      noKeeper: true,
    });
    expect(res.outcome).toBe('miss');
  });

  test('strike error is repeatable from the seed, and spreads the shot around the aim', () => {
    const spot = makeSpot('outside_box', 0, 22);
    const input = kickInputForTarget(spot, 1, 1.2, 0.6, 0, P);
    const meant = computeLaunch(spot, input, P);
    expect(applyStrikeError(meant, input, mulberry32(3), P)).toEqual(applyStrikeError(meant, input, mulberry32(3), P));
    const rand = mulberry32(4);
    let sx = 0;
    let sxx = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const c = cross(spot, applyStrikeError(meant, input, rand, P));
      sx += c.x;
      sxx += c.x * c.x;
    }
    const mean = sx / n;
    const sd = Math.sqrt(sxx / n - mean * mean);
    expect(mean).toBeCloseTo(1, 1);
    expect(sd).toBeGreaterThan(0.1);
    expect(sd).toBeLessThan(0.4);
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

describe('keeper motion', () => {
  const arm = (parts: ReturnType<KeeperSim['partsAt']>) =>
    Math.max(...[2, 3].map((i) => Math.hypot(parts[i].a.x - parts[i].b.x, parts[i].a.y - parts[i].b.y, parts[i].a.z - parts[i].b.z)));

  test('tracking a wide ball, the arms never stretch: the body steps and leans instead', () => {
    const sim = new KeeperSim(planKeeper({ ...TAP, flickTick: 0 }, 0, P), 0, P);
    let parts = sim.partsAt(0);
    for (let t = 1; t < 240; t++) parts = sim.step(t, v3(1.2, 1.4, 6), v3(0, 0, -20));
    expect(arm(parts)).toBeLessThan(0.85);
    expect(parts[0].a.x).toBeGreaterThan(0.2); // pelvis stepped across
  });

  test('a dive springs off on an arc and ends lying on the ground', () => {
    const plan = planKeeper({ ...flickForHandTarget(3, 0.8, P), durMs: 150, flickTick: 0 }, 0, P);
    const sim = new KeeperSim(plan, 0, P);
    const peakTick = Math.round((P.keeperWindup + plan.travel * 0.5) * 240);
    const linearMid = (0.88 + plan.target.y - 1.18 * 0.5) / 2;
    expect(sim.partsAt(peakTick)[0].a.y).toBeGreaterThan(linearMid - 0.1);
    const lying = sim.partsAt(Math.round((P.keeperWindup + plan.travel + P.diveHold + P.diveFall + 0.1) * 240));
    expect(lying[0].a.y).toBeLessThan(0.35);
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
      if (s.category === 'penalty') expect(s.maxWall).toBe(0);
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
    computeLaunch(penalty, kickInputForTarget(penalty, x, y, powerForSpeed(speed, P), 0, P), P);

  test('clean goal with no keeper', () => {
    const res = simulateKick({ spot: penalty, wall: null }, shot(2, 1, 25), null, P, { noKeeper: true });
    expect([res.outcome, res.tag]).toEqual(['goal', 'clean']);
  });

  test('wild high-and-right shot misses', () => {
    const launch = computeLaunch(penalty, kickInputForTarget(penalty, 5, 3.4, 1, 0, P), P);
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

describe('the net and the wind', () => {
  const edge = makeSpot('outside_box', 0, 20);
  const struck = (speed: number) => computeLaunch(edge, kickInputForTarget(edge, 1, 1, powerForSpeed(speed, P), 0, P), P);

  test('a goal sinks into the net, which gives (it is not a wall) and keeps hold of it', () => {
    const res = simulateKick({ spot: edge, wall: null }, struck(30), null, P, { noKeeper: true, record: true });
    expect(res.outcome).toBe('goal');
    const b = res.frames!.ball;
    let deepest = 0;
    for (let i = 2; i < b.length; i += 3) deepest = Math.min(deepest, b[i]);
    // Stretched well past the back of the net, then let go: still inside the goal, on its way down.
    expect(deepest).toBeLessThan(NET_BACK_Z - 0.25);
    expect(b[b.length - 1]).toBeLessThan(0);
    expect(b[b.length - 1]).toBeGreaterThan(NET_BACK_Z - 0.2);
  });

  test('a crosswind carries the ball sideways, a following wind on further', () => {
    const launch = struck(25);
    const cross = (wind: Vec3) => simulateKick({ spot: edge, wall: null, wind }, launch, null, P, { noKeeper: true }).lineCrossing!;
    const calm = cross(v3());
    expect(cross(v3(6, 0, 0)).x - calm.x).toBeGreaterThan(0.4);
    expect(cross(v3(-6, 0, 0)).x - calm.x).toBeLessThan(-0.4);
    // Into the wind it dips less... a following wind takes the drag off, so it arrives higher.
    expect(cross(v3(0, 0, -6)).y).toBeGreaterThan(calm.y);
  });
});

describe('tuning targets (SPEC §3.2, §4.2)', () => {
  const report = tuningReport(P);
  for (const check of report) {
    test(`${check.name}: ${check.value} (expect ${check.expect})`, () => {
      expect(check.pass).toBe(true);
    });
  }
});
