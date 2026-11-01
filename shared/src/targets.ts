// Tuning targets as executable checks (SPEC §3.2, §4.2). The tests assert
// them and the harness shows them live while sliders change.
//
// "Real world" checks compare the ball model with commonly reported football
// figures: a ball's terminal velocity is around 30 m/s; a driven ball loses
// roughly a quarter of its speed over 25 m; penalties reach the line in
// 0.4–0.5 s; a 25 m free kick takes about a second; top free kicks bend 2–4 m;
// a 30 m/s ball struck at 35° carries roughly 50–65 m (≈ 85 m in a vacuum).
// Free-kick studies (Barber & Carré 2010; Alcock et al. 2012; Bray & Kerwin
// 2003) put direct free kicks at 24–28 m/s with ~60–110 rad/s of spin, launched
// 15–20° up to just clear the wall, with launch angles needing ~3° of control
// to hit a 1 m² target from 20 m.

import { dragScale, flyToGround, flyToPlane } from './ball';
import { BALL_RADIUS, POST_X, TICK_RATE } from './geometry';
import { idealKeeperInput, TAP } from './ideal';
import { applyStrikeError, computeLaunch, kickInputForTarget, powerForSpeed, type LaunchState } from './launch';
import type { SimParams } from './params';
import { simulateKick, type KickSetup } from './sim';
import { mulberry32 } from './rng';
import { makeSpot, type Spot } from './spots';
import { normalize, scale, sub, v3 } from './vec';
import { wallLayout } from './wall';

export interface TargetCheck {
  group: 'real world' | 'controls' | 'keeper' | 'frame';
  name: string;
  value: string;
  expect: string;
  pass: boolean;
}

function setupAt(spot: Spot, wallSize = 0): KickSetup {
  return { spot, wall: wallSize > 0 ? { size: wallSize, offset: 0 } : null };
}

function aimed(spot: Spot, x: number, y: number, speed: number, curve: number, p: SimParams): LaunchState {
  return computeLaunch(spot, kickInputForTarget(spot, x, y, powerForSpeed(speed, p), curve, p), p);
}

/** A launch straight at a point with no spin. */
function direct(from: { x: number; z: number }, to: { x: number; y: number; z: number }, speed: number): LaunchState {
  const pos = v3(from.x, BALL_RADIUS, from.z);
  return { pos, vel: scale(normalize(sub(v3(to.x, to.y, to.z), pos)), speed), spin: v3() };
}

/**
 * Latest reaction delay (s) at which a perfect keeper still stops the shot;
 * −1 if never, NaN if the shot would not score against an empty goal.
 */
export function latestSaveDelay(setup: KickSetup, launch: LaunchState, p: SimParams, maxDelay = 0.8): number {
  if (simulateKick(setup, launch, null, p, { noKeeper: true }).outcome !== 'goal') return NaN;
  let latest = -1;
  for (let ms = 0; ms <= maxDelay * 1000; ms += 10) {
    const tick = Math.round((ms / 1000) * TICK_RATE);
    const res = simulateKick(setup, launch, idealKeeperInput(setup, launch, tick, p), p);
    if (res.outcome !== 'goal') latest = ms / 1000;
  }
  return latest;
}

const fmt = (x: number, digits = 2) => x.toFixed(digits);
const within = (x: number, lo: number, hi: number) => x >= lo && x <= hi;

export function tuningReport(p: SimParams): TargetCheck[] {
  const checks: TargetCheck[] = [];
  const add = (group: TargetCheck['group'], name: string, value: string, expect: string, pass: boolean) =>
    checks.push({ group, name, value, expect, pass });

  const centre25 = makeSpot('outside_box', 0, 25);
  const centre20 = makeSpot('outside_box', 0, 20);
  const penalty = makeSpot('penalty', 0, 11);
  const ground = v3(0, BALL_RADIUS, 0);

  // ── Real world ──────────────────────────────────────────────────────────
  {
    const vt = Math.sqrt(p.gravity / p.dragK);
    add('real world', 'Terminal velocity', `${fmt(vt, 1)} m/s`, '27–33 m/s', within(vt, 27, 33));
  }
  {
    const pen = flyToPlane(v3(0, BALL_RADIUS, 11), scale(normalize(v3(3, 1.2, -11)), 28), v3(), p, 0);
    const t = pen ? pen.tick / TICK_RATE : NaN;
    add('real world', 'Penalty at 100 km/h reaches the line', `${fmt(t)} s`, '0.38–0.50 s', within(t, 0.38, 0.5));
  }
  {
    const drive = flyToPlane(v3(0, BALL_RADIUS, 25), scale(normalize(v3(0, 0.12, -1)), 30), v3(), p, 0);
    const kept = drive ? drive.speed / 30 : NaN;
    add('real world', 'Speed kept over 25 m (30 m/s drive)', `${fmt(kept * 100, 0)}%`, '70–85%', within(kept, 0.7, 0.85));
  }
  {
    const res = simulateKick(setupAt(centre25), aimed(centre25, 0, 1.2, p.vRef, 0, p), null, p, { noKeeper: true });
    const t = res.lineCrossing ? res.lineCrossing.tick / TICK_RATE : NaN;
    add('real world', '25 m free kick at ~97 km/h, flight', `${fmt(t)} s`, '0.95–1.20 s', within(t, 0.95, 1.2));
  }
  {
    // Launched straight at the centre with sidespin: how far it ends up from there.
    const straight = aimed(centre25, 0, 1.2, p.vRef, 0, p);
    const bendWith = (spin: number) => {
      const c = flyToPlane(straight.pos, straight.vel, v3(0, spin, 0), p, 0);
      return c ? Math.abs(c.x) : NaN;
    };
    // A typical pro curler spins at ~10 rev/s: its bend should match real ones.
    const pro = bendWith(63);
    add('real world', 'Bend over 25 m, curler at 10 rev/s', `${fmt(pro)} m`, '2.5–4.5 m', within(pro, 2.5, 4.5));
    // The game's full curl goes past that, to the most spectacular real bends and a bit beyond, for play.
    const full = bendWith(p.maxSpin);
    add('controls', 'Bend over 25 m at full curl', `${fmt(full)} m`, '6–8 m', within(full, 6, 8));
  }
  {
    const a = (35 * Math.PI) / 180;
    const land = flyToGround(ground, v3(0, Math.sin(a) * 30, -Math.cos(a) * 30), v3(), p);
    const range = land ? -land.z : NaN;
    add('real world', 'Range of a 30 m/s ball at 35°', `${fmt(range, 0)} m`, '48–68 m', within(range, 48, 68));
  }
  {
    // Drag crisis: below ~12 m/s the flow around a ball stays laminar and Cd roughly doubles.
    const ratio = dragScale(9, p) / dragScale(25, p);
    add('real world', 'Drag coefficient, slow (9 m/s) vs driven ball', `${fmt(ratio, 1)}×`, '1.6–2.2×', within(ratio, 1.6, 2.2));
  }
  {
    const straight = simulateKick(setupAt(centre20), aimed(centre20, 1, 1.2, 30, 0, p), null, p, { noKeeper: true });
    const curled = simulateKick(setupAt(centre20), aimed(centre20, 1, 1.2, 30, 1, p), null, p, { noKeeper: true });
    const ratio = curled.lineCrossing && straight.lineCrossing ? straight.lineCrossing.tick / curled.lineCrossing.tick : NaN;
    add('real world', 'Full curl is slower to goal than a drive', `${fmt((1 - ratio) * 100, 0)}% slower`, '6–20%', within(1 - ratio, 0.06, 0.2));
  }

  {
    const spot = makeSpot('outside_box', 0, 22);
    const l = aimed(spot, 3.2, 2.1, p.vRef, 0, p);
    const deg = (Math.atan2(l.vel.y, Math.hypot(l.vel.x, l.vel.z)) * 180) / Math.PI;
    add('real world', 'Launch angle, 22 m free kick to the top corner', `${fmt(deg, 1)}°`, '13–21°', within(deg, 13, 21));
  }
  {
    const spot = makeSpot('outside_box', 0, 25);
    const res = simulateKick(setupAt(spot), aimed(spot, 1, 0.2, 18, 0, p), null, p, { noKeeper: true, record: true });
    const b = res.frames!.ball;
    let apex = 0;
    for (let i = 1; i < b.length; i += 3) apex = Math.max(apex, b[i]);
    add('real world', 'Soft low shot, 25 m: peak height', `${fmt(apex)} m, ${res.outcome}`, '≤ 0.6 m, goal', apex <= 0.6 && res.outcome === 'goal');
  }

  // ── Controls ────────────────────────────────────────────────────────────
  {
    let worst = 0;
    for (const speed of [21, 25, 30]) {
      for (const curve of [0, 1, -1]) {
        const res = simulateKick(setupAt(centre20), aimed(centre20, 1.5, 1.2, speed, curve, p), null, p, { noKeeper: true });
        const c = res.lineCrossing;
        worst = Math.max(worst, c ? Math.hypot(c.x - 1.5, c.y - 1.2) : Infinity);
      }
    }
    add('controls', 'Aim error at any power and curl, 20 m', `${fmt(worst)} m`, '≤ 0.15 m', worst <= 0.15);
  }
  {
    const launch = computeLaunch(centre25, kickInputForTarget(centre25, 2.5, 2.0, 1, 0, p), p);
    const res = simulateKick(setupAt(centre25), launch, null, p, { noKeeper: true });
    add('controls', 'Overhit (power 100%) at the top corner', `${res.outcome}/${res.tag}`, 'miss/over', res.tag === 'over');
  }
  {
    // Strike error: a shot placed safely inside the frame nearly always goes in;
    // one shaved into the very corner sometimes misses.
    const spot = makeSpot('outside_box', 0, 22);
    const rate = (x: number, y: number) => {
      const input = kickInputForTarget(spot, x, y, powerForSpeed(p.vRef, p), 0, p);
      const meant = computeLaunch(spot, input, p);
      const rand = mulberry32(17);
      let goals = 0;
      for (let i = 0; i < 400; i++) {
        if (simulateKick(setupAt(spot), applyStrikeError(meant, input, rand, p), null, p, { noKeeper: true }).outcome === 'goal') goals++;
      }
      return goals / 400;
    };
    const safe = rate(3.66 - 0.7, 2.44 - 0.6);
    add('controls', 'Perfect swipe 0.6–0.7 m inside the top corner, 22 m: on target', `${fmt(safe * 100, 0)}%`, '≥ 95%', safe >= 0.95);
    const shaved = rate(3.66 - 0.2, 2.44 - 0.2);
    add('controls', 'Perfect swipe 0.2 m inside the top corner, 22 m: on target', `${fmt(shaved * 100, 0)}%`, '55–90%', within(shaved, 0.55, 0.9));
  }
  {
    const setup = setupAt(centre20, 4);
    const wc = wallLayout(centre20, { size: 4, offset: 0 }).center;
    const x = centre20.x + (wc.x - centre20.x) * (centre20.z / (centre20.z - wc.z));
    const res = simulateKick(setup, aimed(centre20, x, 0.6, 24, 0, p), null, p, { noKeeper: true });
    add('controls', 'Low drive at the wall', `${res.outcome}/${res.tag}`, 'blocked/wall', res.outcome === 'blocked');
  }

  // ── Keeper ──────────────────────────────────────────────────────────────
  {
    const d = latestSaveDelay(setupAt(centre25), aimed(centre25, 3.2, 0.4, p.vRef, 0, p), p);
    add('keeper', 'Low corner, 25 m: latest saving reaction', `${fmt(d)} s`, '0.20–0.45 s', within(d, 0.2, 0.45));
  }
  {
    const d = latestSaveDelay(setupAt(centre25), aimed(centre25, 3.2, 2.1, p.vRef, 0, p), p);
    add('keeper', 'Top corner, 25 m: latest saving reaction', d < 0 ? 'unsaveable' : `${fmt(d)} s`, '≤ 0.20 s', d <= 0.2);
  }
  {
    const setup = setupAt(penalty);
    const launch = aimed(penalty, 3.2, 0.4, 28, 0, p);
    const atContact = simulateKick(setup, launch, idealKeeperInput(setup, launch, 0, p), p);
    add('keeper', 'Penalty corner, keeper reacts at contact', atContact.outcome, 'goal', atContact.outcome === 'goal');
    const early = simulateKick(setup, launch, idealKeeperInput(setup, launch, Math.round(-0.25 * TICK_RATE), p), p);
    add('keeper', 'Penalty corner, keeper guesses right 0.25 s early', early.outcome, 'save', early.outcome === 'save');
  }
  {
    const launch = aimed(centre20, 0.2, 1.0, 22, 0, p);
    const res = simulateKick(setupAt(centre20), launch, { ...TAP, flickTick: 0 }, p);
    add('keeper', 'Central shot vs set keeper', `${res.outcome}/${res.tag}`, 'save/caught', res.tag === 'caught');
  }
  {
    const spot = makeSpot('outside_box', 0, 22);
    const setup = setupAt(spot);
    let spills = 0;
    for (let x = 2.6; x <= 3.61; x += 0.1) {
      for (const y of [0.3, 0.9, 1.5]) {
        const launch = aimed(spot, x, y, 28, 0, p);
        for (const delay of [0.25, 0.3, 0.35, 0.4]) {
          const res = simulateKick(setup, launch, idealKeeperInput(setup, launch, Math.round(delay * TICK_RATE), p), p);
          if (res.tag === 'keeper_spill') spills++;
        }
      }
    }
    add('keeper', 'Fingertip spill-ins in a corner sweep', `${spills}`, '≥ 1', spills >= 1);
  }

  // ── Frame ───────────────────────────────────────────────────────────────
  {
    const graze = simulateKick(setupAt(penalty), direct(penalty, { x: POST_X - 0.155, y: 1.4, z: 0 }, 25), null, p, {
      noKeeper: true,
    });
    add('frame', 'Inside-of-post graze', `${graze.outcome}/${graze.tag}`, 'goal/off_post', graze.tag === 'off_post');
    const square = simulateKick(setupAt(penalty), direct(penalty, { x: POST_X, y: 1.4, z: 0 }, 25), null, p, {
      noKeeper: true,
    });
    add('frame', 'Square post hit', `${square.outcome}/${square.tag}`, 'miss/woodwork_out', square.tag === 'woodwork_out');
  }
  return checks;
}
