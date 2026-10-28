// Tuning targets from SPEC §3.2 / §4.2 as executable checks. The tests assert
// them and the harness shows them live while sliders change.

import { BALL_RADIUS, POST_X, TICK_RATE } from './geometry';
import { idealKeeperInput, kickInputForTarget, TAP } from './ideal';
import { INPUT } from './input';
import { computeLaunch, powerForSpeed, type LaunchState } from './launch';
import type { SimParams } from './params';
import { simulateKick, type KickSetup } from './sim';
import { makeSpot, type Spot } from './spots';
import { wallLayout } from './wall';
import { normalize, scale, sub, v3 } from './vec';

export interface TargetCheck {
  name: string;
  value: string;
  expect: string;
  pass: boolean;
}

function setupAt(spot: Spot, wallSize = 0): KickSetup {
  return { spot, wall: wallSize > 0 ? { size: wallSize, offset: 0 } : null };
}

function aimed(spot: Spot, x: number, y: number, speed: number, curve: number, p: SimParams): LaunchState {
  return computeLaunch(spot, kickInputForTarget(x, y, powerForSpeed(speed, p), curve, p), p);
}

/** A launch straight at a point with no spin, for frame-geometry checks. */
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

export function tuningReport(p: SimParams): TargetCheck[] {
  const checks: TargetCheck[] = [];
  const add = (name: string, value: string, expect: string, pass: boolean) =>
    checks.push({ name, value, expect, pass });

  const centre25 = makeSpot('outside_box', 0, 25);
  const centre20 = makeSpot('outside_box', 0, 20);
  const penalty = makeSpot('penalty', 0, 11);

  {
    const noComp = { ...p, curlCompensation: 0 };
    const res = simulateKick(setupAt(centre25), aimed(centre25, 0, 1.2, p.vRef, INPUT.maxCurve, noComp), null, p, {
      noKeeper: true,
    });
    const bend = res.lineCrossing ? Math.abs(res.lineCrossing.x) : NaN;
    add('Max bend over 25 m', `${fmt(bend)} m`, '2.5–4.0 m', bend >= 2.5 && bend <= 4);
  }
  {
    const res = simulateKick(setupAt(centre25), aimed(centre25, 0, 1.2, p.vRef, 0, p), null, p, { noKeeper: true });
    const t = res.lineCrossing ? res.lineCrossing.tick / TICK_RATE : NaN;
    add('Flight time 25 m at v_ref', `${fmt(t)} s`, '0.90–1.15 s', t >= 0.9 && t <= 1.15);
  }
  {
    const res = simulateKick(setupAt(centre20), aimed(centre20, 1.5, 1.2, p.vRef, 0, p), null, p, { noKeeper: true });
    const c = res.lineCrossing;
    const err = c ? Math.hypot(c.x - 1.5, c.y - 1.2) : NaN;
    add('Aim error, 20 m, no curve', `${fmt(err)} m`, '≤ 0.20 m', err <= 0.2);
  }
  {
    const res = simulateKick(setupAt(centre20), aimed(centre20, -1.5, 1.2, p.vRef, INPUT.maxCurve, p), null, p, {
      noKeeper: true,
    });
    const c = res.lineCrossing;
    const err = c ? Math.abs(c.x + 1.5) : NaN;
    add('Curl compensation error, 20 m', `${fmt(err)} m`, '≤ 0.50 m', err <= 0.5);
  }
  {
    const launch = computeLaunch(centre25, kickInputForTarget(2.5, 2.0, 1, 0, p), p);
    const res = simulateKick(setupAt(centre25), launch, null, p, { noKeeper: true });
    add('Overhit (p = 1) at top corner', `${res.outcome}/${res.tag}`, 'miss/over', res.tag === 'over');
  }
  {
    const launch = aimed(centre25, 3.2, 0.4, p.vRef, 0, p);
    const d = latestSaveDelay(setupAt(centre25), launch, p);
    add('Low corner, 25 m: latest saving reaction', `${fmt(d)} s`, '0.20–0.40 s', d >= 0.2 && d <= 0.4);
  }
  {
    const launch = aimed(centre25, 3.2, 2.1, p.vRef, 0, p);
    const d = latestSaveDelay(setupAt(centre25), launch, p);
    add('Top corner, 25 m: latest saving reaction', d < 0 ? 'unsaveable' : `${fmt(d)} s`, '≤ 0.20 s', d <= 0.2);
  }
  {
    const setup = setupAt(penalty);
    const launch = aimed(penalty, 3.2, 0.4, p.vRef, 0, p);
    const atContact = simulateKick(setup, launch, idealKeeperInput(setup, launch, 0, p), p);
    add('Penalty corner, keeper reacts at contact', atContact.outcome, 'goal', atContact.outcome === 'goal');
    const early = simulateKick(setup, launch, idealKeeperInput(setup, launch, Math.round(-0.25 * TICK_RATE), p), p);
    add('Penalty corner, keeper anticipates 0.25 s', early.outcome, 'save', early.outcome === 'save');
  }
  {
    const launch = aimed(centre20, 0.2, 1.0, 22, 0, p);
    const res = simulateKick(setupAt(centre20), launch, { ...TAP, flickTick: 0 }, p);
    add('Central shot vs set keeper', `${res.outcome}/${res.tag}`, 'save/caught', res.tag === 'caught');
  }
  {
    const graze = simulateKick(setupAt(penalty), direct(penalty, { x: POST_X - 0.155, y: 1.4, z: 0 }, 25), null, p, {
      noKeeper: true,
    });
    add('Inside-of-post graze', `${graze.outcome}/${graze.tag}`, 'goal/off_post', graze.tag === 'off_post');
    const square = simulateKick(setupAt(penalty), direct(penalty, { x: POST_X, y: 1.4, z: 0 }, 25), null, p, {
      noKeeper: true,
    });
    add('Square post hit', `${square.outcome}/${square.tag}`, 'miss/woodwork_out', square.tag === 'woodwork_out');
  }
  {
    const setup = setupAt(centre20, 4);
    const wc = wallLayout(centre20, { size: 4, offset: 0 }).center;
    const x = centre20.x + (wc.x - centre20.x) * (centre20.z / (centre20.z - wc.z));
    const res = simulateKick(setup, aimed(centre20, x, 0.6, 24, 0, p), null, p, { noKeeper: true });
    add('Low drive at the wall', `${res.outcome}/${res.tag}`, 'blocked/wall', res.outcome === 'blocked');
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
    add('Weak-touch spill-ins in a corner sweep', `${spills}`, '≥ 1', spills >= 1);
  }
  return checks;
}
