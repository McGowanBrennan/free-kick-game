// M0 tuning harness: drive the shared sim with flicks or sliders, watch it in
// 3D, and see the SPEC tuning targets update as constants change.

import GUI from 'lil-gui';
import {
  DEFAULT_PARAMS,
  DT,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  INPUT,
  KeeperSim,
  RUNUP_TICKS,
  SPOT_CATEGORIES,
  TAP,
  TICK_RATE,
  ballArrivalTick,
  computeLaunch,
  generateSpot,
  idealKeeperInput,
  keeperInputFromSwipe,
  kickInputForTarget,
  kickInputFromSwipe,
  mulberry32,
  planKeeper,
  powerForSpeed,
  simulateKick,
  targetFromInput,
  tuningReport,
  type KeeperInput,
  type KickInput,
  type LaunchState,
  type Outcome,
  type SimParams,
  type SimResult,
  type Spot,
  type SpotCategory,
  type TargetCheck,
  type Vec3,
  type WallConfig,
} from '@fk/shared';
import { attachPad } from './pads';
import { HarnessScene, type CameraPreset } from './scene';

type KeeperMode = 'none' | 'tap' | 'flick' | 'ideal';

const params: SimParams = { ...DEFAULT_PARAMS };
const state = {
  category: 'outside_box' as SpotCategory,
  seed: 7,
  wallSize: 4,
  wallOffset: 0,
  u: 0.6,
  L: 0.33,
  p: 0.75,
  c: 0.2,
  keeperMode: 'ideal' as KeeperMode,
  flickTime: 0.3,
  vx: -0.25,
  vy: -0.12,
  speed: 0.5,
  camera: 'shooter' as CameraPreset,
  trace: true,
  envelope: false,
  liveOnSwipe: false,
  heatDelay: 0.3,
  heatPower: powerForSpeed(DEFAULT_PARAMS.vRef, DEFAULT_PARAMS),
  heatCurve: 0,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scene = new HarnessScene($('view'));
const resultsEl = $('results');
const scrub = $<HTMLInputElement>('scrub');
const clock = $('clock');
const playBtn = $<HTMLButtonElement>('play');
const bannerEl = $('banner');

let spot: Spot;
let launch: LaunchState;
let keeperInput: KeeperInput | null = null;
let result: SimResult;
let keeperView: KeeperSim;
let checks: TargetCheck[] = [];
let playTick = 0;
let playing = true;
let live = false;
let liveFlicked = false;

let bannerTimer = 0;
function banner(text: string, ms = 1800): void {
  bannerEl.innerHTML = text;
  bannerEl.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => bannerEl.classList.remove('show'), ms);
}

// ── Sim plumbing ────────────────────────────────────────────────────────────

const wallConfig = (): WallConfig | null =>
  spot.maxWall > 0 && state.wallSize > 0 ? { size: Math.min(state.wallSize, spot.maxWall), offset: state.wallOffset } : null;

const kickInput = (): KickInput => ({ u: state.u, L: state.L, p: state.p, c: state.c, durMs: 150 });

function keeperFromState(): KeeperInput | null {
  const flickTick = Math.round(state.flickTime * TICK_RATE);
  switch (state.keeperMode) {
    case 'none':
      return null;
    case 'tap':
      return { ...TAP, flickTick };
    case 'flick':
      return { vx: state.vx, vy: state.vy, durMs: 150, flickTick };
    case 'ideal':
      return idealKeeperInput({ spot, wall: wallConfig() }, launch, flickTick, params);
  }
}

function simulate(keeper: KeeperInput | null): void {
  keeperInput = keeper;
  result = simulateKick({ spot, wall: wallConfig() }, launch, keeper, params, { record: true });
  keeperView = new KeeperSim(
    planKeeper(keeper, spot.keeperX, params),
    spot.keeperX,
    params,
    ballArrivalTick(launch, params),
  );
  scene.setWall(result.wall?.players ?? []);
  scene.setTrace(result.frames!.ball);
  scene.setTarget(targetFromInput(kickInput(), params));
  scene.setCrossing(result.lineCrossing);
  scene.setEnvelope(state.envelope ? envelopePoints() : null);
  scrub.min = String(-RUNUP_TICKS);
  scrub.max = String(result.ticks);
  renderResults();
}

function resimulate(restart = true): void {
  live = false;
  launch = computeLaunch(spot, kickInput(), params);
  simulate(keeperFromState());
  if (restart) {
    const flick = keeperInput ? keeperInput.flickTick : 0;
    playTick = Math.max(-RUNUP_TICKS, Math.min(-24, flick - 24));
    playing = true;
  }
}

function newSpot(): void {
  spot = generateSpot(mulberry32(state.seed), state.category);
  scene.setSpot(spot);
  scene.setHeatmap(null);
  scene.cameraPreset(state.camera, spot);
  resimulate();
}

function startLive(): void {
  launch = computeLaunch(spot, kickInput(), params);
  simulate(null);
  live = true;
  liveFlicked = false;
  playTick = -RUNUP_TICKS;
  playing = true;
  state.camera = 'keeper';
  scene.cameraPreset('keeper', spot);
  refreshGui();
  banner('Run-up… flick the keeper pad to react', 1200);
}

function envelopePoints(): Vec3[] {
  const pts: Vec3[] = [];
  for (let li = 0; li <= 6; li++) {
    const len = INPUT.tapMaxLen + 1e-3 + ((INPUT.keeperMaxLen - INPUT.tapMaxLen) * li) / 6;
    for (let ai = 0; ai <= 12; ai++) {
      const a = (Math.PI / 2) * (ai / 12);
      for (const side of [-1, 1]) {
        const k = { vx: side * len * Math.cos(a), vy: -len * Math.sin(a), durMs: 150, flickTick: 0 };
        pts.push(planKeeper(k, spot.keeperX, params).target);
      }
    }
  }
  return pts;
}

function runHeatmap(): void {
  const nx = 14;
  const ny = 6;
  const w = (2 * GOAL_HALF_WIDTH) / nx;
  const h = GOAL_HEIGHT / ny;
  const setup = { spot, wall: wallConfig() };
  const flickTick = Math.round(state.heatDelay * TICK_RATE);
  const cells: { x: number; y: number; w: number; h: number; outcome: Outcome }[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = -GOAL_HALF_WIDTH + w * (i + 0.5);
      const y = h * (j + 0.5);
      const l = computeLaunch(spot, kickInputForTarget(x, y, state.heatPower, state.heatCurve, params), params);
      const r = simulateKick(setup, l, idealKeeperInput(setup, l, flickTick, params), params);
      cells.push({ x, y, w, h, outcome: r.outcome });
    }
  }
  scene.setHeatmap(cells);
  const goals = cells.filter((c) => c.outcome === 'goal').length;
  banner(`${goals} / ${cells.length} aim points score vs a perfect keeper reacting at ${state.heatDelay.toFixed(2)} s`, 4000);
}

let checksTimer = 0;
function scheduleChecks(): void {
  clearTimeout(checksTimer);
  checksTimer = window.setTimeout(() => {
    checks = tuningReport(params);
    renderResults();
  }, 250);
}

// ── Results panel ──────────────────────────────────────────────────────────

function renderResults(): void {
  const r = result;
  const v = launch.vel;
  const speed = Math.hypot(v.x, v.y, v.z);
  const elev = (Math.asin(v.y / speed) * 180) / Math.PI;
  const plan = keeperView.plan;
  const keeperText =
    plan.mode === 'stance'
      ? 'no flick (stance)'
      : `${plan.mode} at ${(plan.flickTick * DT).toFixed(2)} s` +
        (plan.mode === 'dive' ? ` · reach ${plan.reach.toFixed(2)} m @ ${plan.target.y.toFixed(2)} m` : '');
  const crossing = r.lineCrossing
    ? `x ${r.lineCrossing.x.toFixed(2)} · y ${r.lineCrossing.y.toFixed(2)} @ ${(r.lineCrossing.tick * DT).toFixed(2)} s`
    : '—';
  const events = r.events
    .filter((e) => e.kind !== 'ground')
    .map((e) => `<li>${(e.tick * DT).toFixed(3)} s · ${e.kind}${e.detail ? ` (${e.detail})` : ''} · ${(e.speed * 3.6).toFixed(0)} km/h</li>`)
    .join('');
  const checksHtml = checks.length
    ? checks
        .map((c) => `<div class="${c.pass ? 'ok' : 'bad'}"><span>${c.pass ? '✓' : '✗'} ${c.name}</span><span>${c.value}</span></div>`)
        .join('')
    : '<div class="ok">computing…</div>';
  const failing = checks.filter((c) => !c.pass).length;
  resultsEl.innerHTML = `
    <h2 class="${r.outcome}">${r.outcome.toUpperCase()}</h2>
    <div class="tag">${r.tag.replace(/_/g, ' ')}</div>
    <dl>
      <dt>Spot</dt><dd>${spot.category.replace(/_/g, ' ')} · ${spot.distance.toFixed(1)} m · x ${spot.x.toFixed(1)}</dd>
      <dt>Launch</dt><dd>${(speed * 3.6).toFixed(0)} km/h · ${elev.toFixed(1)}° · spin ${launch.spin.y.toFixed(0)} rad/s</dd>
      <dt>Crossing</dt><dd>${crossing}</dd>
      <dt>Keeper</dt><dd>${keeperText}</dd>
      <dt>Hash</dt><dd>${r.hash.toString(16).padStart(8, '0')}</dd>
    </dl>
    <ol>${events || '<li>no contacts</li>'}</ol>
    <div id="checks"><div><strong>Tuning targets</strong><span class="${failing ? 'bad' : 'ok'}">${
      checks.length ? (failing ? `${failing} failing` : 'all pass') : ''
    }</span></div>${checksHtml}</div>`;
}

// ── GUI ─────────────────────────────────────────────────────────────────────

const gui = new GUI({ title: 'Free kick sim' });
const refreshGui = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());

const fSpot = gui.addFolder('Spot');
fSpot.add(state, 'category', SPOT_CATEGORIES as SpotCategory[]).onChange(newSpot);
fSpot.add(state, 'seed', 1, 999, 1).onFinishChange(newSpot);
fSpot
  .add({ reroll: () => ((state.seed = (state.seed % 999) + 1), refreshGui(), newSpot()) }, 'reroll')
  .name('Re-roll spot');
fSpot.add(state, 'wallSize', 0, 4, 1).name('wall size').onChange(() => resimulate());
fSpot.add(state, 'wallOffset', -3, 3, 0.05).name('wall offset (m)').onChange(() => resimulate());

const fKick = gui.addFolder('Kick');
fKick.add(state, 'u', -1, 1, 0.01).name('aim u').onChange(() => resimulate());
fKick.add(state, 'L', INPUT.minAimLen, INPUT.maxAimLen, 0.005).name('height L').onChange(() => resimulate());
fKick.add(state, 'p', 0, 1, 0.01).name('power p').onChange(() => resimulate());
fKick.add(state, 'c', -INPUT.maxCurve, INPUT.maxCurve, 0.01).name('curve c').onChange(() => resimulate());
fKick.add(state, 'liveOnSwipe').name('shooter pad → live');

const fKeeper = gui.addFolder('Keeper');
fKeeper.add(state, 'keeperMode', ['none', 'tap', 'flick', 'ideal']).name('mode').onChange(() => resimulate());
fKeeper.add(state, 'flickTime', -1.2, 1.2, 0.01).name('flick time (s)').onChange(() => resimulate());
fKeeper.add(state, 'vx', -INPUT.keeperMaxLen, INPUT.keeperMaxLen, 0.005).name('flick vx').onChange(() => resimulate());
fKeeper.add(state, 'vy', -INPUT.keeperMaxLen, INPUT.keeperMaxLen, 0.005).name('flick vy').onChange(() => resimulate());

const fView = gui.addFolder('View');
fView.add(state, 'speed', 0.05, 1, 0.05).name('replay speed');
fView
  .add(state, 'camera', ['shooter', 'keeper', 'side', 'top'])
  .onChange((c: CameraPreset) => scene.cameraPreset(c, spot));
fView.add(state, 'trace').onChange((v: boolean) => scene.setTraceVisible(v));
fView.add(state, 'envelope').name('keeper reach').onChange((v: boolean) => scene.setEnvelope(v ? envelopePoints() : null));

const fHeat = gui.addFolder('Save heatmap');
fHeat.add(state, 'heatDelay', 0, 0.8, 0.01).name('reaction (s)');
fHeat.add(state, 'heatPower', 0, 1, 0.01).name('power');
fHeat.add(state, 'heatCurve', -INPUT.maxCurve, INPUT.maxCurve, 0.01).name('curve');
fHeat.add({ run: runHeatmap }, 'run').name('Run heatmap');
fHeat.add({ clear: () => scene.setHeatmap(null) }, 'clear').name('Clear');

const PHYSICS_GROUPS: [string, (keyof SimParams)[]][] = [
  ['Ball physics', ['gravity', 'dragK', 'magnusK', 'spinDecayPerTick', 'groundRestitution', 'groundTangential', 'rollDecel', 'rollSpinDecayPerTick', 'postRestitution', 'postTangential', 'postSpinRetain', 'wallRestitution', 'wallTangential']],
  ['Kick mapping', ['minSpeed', 'maxSpeed', 'powerExponent', 'vRef', 'maxSpin', 'curlCompensation', 'overhitThreshold', 'overhitDeg', 'aimOutsidePost', 'maxTargetHeight']],
  ['Keeper dive', ['diveAutoTime', 'keeperWindup', 'diveBaseTime', 'diveTimePerMeter', 'diveTimePerHeight', 'highReachScale', 'diveHold', 'diveFall', 'minHandReach', 'maxHandReach', 'lowHandY', 'highHandY', 'jumpHandY']],
  ['Keeper set/stance', ['setReachX', 'setReachY', 'setHandSpeed', 'stanceReachX', 'stanceReachY', 'stanceHandSpeed']],
  ['Keeper contact', ['catchMaxSpeed', 'catchMaxStretch', 'parryRestitution', 'parryTangential', 'weakGlancing', 'weakKeepMin', 'weakKeepMax', 'weakDeflect']],
  ['Wall jump', ['wallJumpDelay', 'wallJumpHeight', 'wallJumpDuration']],
];
const RANGES: Partial<Record<keyof SimParams, [number, number, number]>> = {
  gravity: [5, 15, 0.01],
  dragK: [0, 0.03, 0.0005],
  magnusK: [0, 0.012, 0.0001],
  spinDecayPerTick: [0.995, 1, 0.00001],
  rollSpinDecayPerTick: [0.98, 1, 0.0001],
  minSpeed: [5, 25, 0.5],
  maxSpeed: [20, 45, 0.5],
  vRef: [15, 35, 0.5],
  maxSpin: [0, 120, 1],
  overhitDeg: [0, 80, 1],
  diveAutoTime: [0, 1, 1],
  catchMaxSpeed: [0, 40, 0.5],
};

const fPhysics = gui.addFolder('Constants').close();
for (const [title, keys] of PHYSICS_GROUPS) {
  const f = fPhysics.addFolder(title).close();
  for (const key of keys) {
    const def = DEFAULT_PARAMS[key];
    const [min, max, step] = RANGES[key] ?? [0, Math.max(1, def * 3), def >= 1 ? 0.01 : 0.005];
    f.add(params, key, min, max, step).onChange(() => {
      resimulate();
      scheduleChecks();
    });
  }
}
fPhysics
  .add(
    {
      reset: () => {
        Object.assign(params, DEFAULT_PARAMS);
        refreshGui();
        resimulate();
        scheduleChecks();
      },
    },
    'reset',
  )
  .name('Reset to defaults');
fPhysics
  .add(
    {
      copy: () => {
        const changed = Object.fromEntries(
          (Object.keys(params) as (keyof SimParams)[])
            .filter((k) => params[k] !== DEFAULT_PARAMS[k])
            .map((k) => [k, params[k]]),
        );
        void navigator.clipboard.writeText(JSON.stringify(changed, null, 2));
        banner(`Copied ${Object.keys(changed).length} changed constants`);
      },
    },
    'copy',
  )
  .name('Copy changed constants');

// ── Pads and timeline ──────────────────────────────────────────────────────

attachPad($('kick-pad'), (samples, h) => {
  const k = kickInputFromSwipe(samples, h);
  if (!k) {
    banner('Swipe ignored: too short, too slow, or not upward');
    return;
  }
  Object.assign(state, { u: k.u, L: k.L, p: k.p, c: k.c });
  refreshGui();
  if (state.liveOnSwipe) startLive();
  else resimulate();
});

attachPad($('keeper-pad'), (samples, h) => {
  if (live && liveFlicked) return;
  const flickTick = live ? Math.round(playTick) : Math.round(state.flickTime * TICK_RATE);
  const k = keeperInputFromSwipe(samples, h, flickTick);
  if (Math.hypot(k.vx, k.vy) < INPUT.tapMaxLen) state.keeperMode = 'tap';
  else Object.assign(state, { keeperMode: 'flick', vx: k.vx, vy: k.vy });
  state.flickTime = flickTick / TICK_RATE;
  refreshGui();
  if (live) {
    liveFlicked = true;
    simulate(k);
    banner(`Flicked at ${state.flickTime >= 0 ? '+' : ''}${state.flickTime.toFixed(2)} s`, 900);
  } else {
    resimulate();
  }
});

playBtn.onclick = () => {
  if (!playing && playTick >= result.ticks) playTick = -24;
  playing = !playing;
};
$('replay').onclick = () => resimulate();
$('live').onclick = startLive;
scrub.oninput = () => {
  playing = false;
  live = false;
  playTick = Number(scrub.value);
};

function drawAt(tick: number): void {
  const f = result.frames!;
  if (tick < 0) {
    scene.setBall(launch.pos);
    scene.setKeeper(keeperView.partsAt(Math.floor(tick)));
    scene.setWallJump(0);
  } else {
    const i = Math.min(Math.floor(tick), result.ticks);
    const j = Math.min(i + 1, result.ticks);
    const t = tick - i;
    const b = f.ball;
    scene.setBall({
      x: b[3 * i] + (b[3 * j] - b[3 * i]) * t,
      y: b[3 * i + 1] + (b[3 * j + 1] - b[3 * i + 1]) * t,
      z: b[3 * i + 2] + (b[3 * j + 2] - b[3 * i + 2]) * t,
    });
    scene.setKeeper(f.keeper[i]);
    scene.setWallJump(f.wallY[i]);
  }
  scrub.value = String(Math.round(tick));
  clock.textContent = `${(tick * DT).toFixed(3)} s${tick < 0 ? ' run-up' : ''}`;
  playBtn.textContent = playing ? 'Pause' : 'Play';
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing) {
    playTick += dt * TICK_RATE * (live ? 1 : state.speed);
    if (playTick >= result.ticks) {
      playTick = result.ticks;
      playing = false;
      if (live) {
        live = false;
        banner(`<span class="${result.outcome}">${result.outcome.toUpperCase()}</span> · ${result.tag.replace(/_/g, ' ')}`, 2500);
      }
    }
  }
  drawAt(playTick);
  scene.render();
  requestAnimationFrame(frame);
}

newSpot();
scheduleChecks();
requestAnimationFrame(frame);
