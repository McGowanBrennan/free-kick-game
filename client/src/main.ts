import * as THREE from 'three';
import { DEFAULT_PARAMS, KeeperSim, TAP, makeSpot, planKeeper, v3 } from '@fk/shared';
import { sound } from './audio/sound';
import { Gestures } from './game/gestures';
import { Session } from './game/session';
import { ViewControl } from './game/view';
import { Hud } from './ui/hud';
import { Menu, type GameConfig } from './ui/menu';
import { Trail } from './ui/trail';
import { KITS } from './world/figure';
import { World } from './world/world';

// Stop iOS Safari from zooming, scrolling or selecting during play.
for (const type of ['gesturestart', 'gesturechange', 'dblclick'] as const) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

const world = new World(document.getElementById('stage')!);
const gestures = new Gestures(document.getElementById('touch')!);
gestures.trail = new Trail(document.getElementById('trail') as HTMLCanvasElement);
let session: Session | null = null;
const hud = new Hud(
  () => session?.quit(),
  () => view.reset(),
  { on: () => sound.on, set: (on) => sound.setEnabled(on) },
);
const view = new ViewControl(world, (adjusted) => hud.setViewAdjusted(adjusted));
gestures.onOrbit = (dx, dy) => view.orbit(dx, dy);
gestures.onZoom = (f) => view.zoom(f);
gestures.onRejected = (why) => hud.toast(why);
const menu = new Menu(start, {
  soundOn: () => sound.on,
  setSound: (on) => sound.setEnabled(on),
  resetViews: () => {
    view.resetAll();
    hud.toast('Camera views reset');
  },
  setRetro: (on) => (world.retro.enabled = on),
  press: () => sound.tick(),
});

// Menu backdrop: a slow orbit around an idle free kick.
const backdrop = makeSpot('outside_box', 6, 21);
const backdropKeeper = new KeeperSim(planKeeper(null, backdrop.keeperX, DEFAULT_PARAMS), backdrop.keeperX, DEFAULT_PARAMS).partsAt(0);
function showBackdrop(): void {
  world.setMode('freekick');
  world.setSpot(backdrop);
  sound.setTheme('soccer');
  sound.setPhase('between');
}

function start(cfg: GameConfig): void {
  const s = new Session(world, hud, gestures, view, menu, cfg);
  session = s;
  if (import.meta.env.DEV) Object.assign((window as unknown as { __fk: object }).__fk, { session: s });
  void s.run().then((next) => {
    session = null;
    if (next === 'rematch') start(cfg);
    else {
      showBackdrop();
      menu.open();
    }
  });
}

/** Dev: loops the keeper through dives from a front-on camera (#lab-keeper). */
function keeperLab(): (clock: number) => void {
  const spot = makeSpot('long_range', 0, 40);
  world.setSpot(spot);
  world.setKits(KITS.ai, KITS.youKeeper, KITS.ai);
  const flicks = [
    { vx: 0.3, vy: -0.05 },
    { vx: -0.27, vy: -0.2 },
    { vx: 0.15, vy: -0.28 },
    { vx: 0, vy: -0.3 },
    { vx: -0.12, vy: -0.03 },
    { ...TAP },
  ];
  let current = -1;
  let sim: KeeperSim | null = null;
  let t0 = 0;
  const ball = v3(spot.x, 0.11, spot.z);
  // ?case=N&t=S freezes dive N at S seconds after the flick.
  const q = new URLSearchParams(location.search);
  const freezeCase = q.has('case') ? Number(q.get('case')) : null;
  const freezeT = q.has('t') ? Number(q.get('t')) : null;
  return (clock) => {
    const i = freezeCase ?? Math.floor(clock / 2.6) % flicks.length;
    if (i !== current) {
      current = i;
      t0 = clock;
      sim = new KeeperSim(planKeeper({ ...flicks[i], durMs: 150, flickTick: 0 }, 0, DEFAULT_PARAMS), 0, DEFAULT_PARAMS);
    }
    const tick = freezeT !== null ? Math.round(freezeT * 240) : Math.floor((clock - t0) * 240) - 120;
    world.pose(ball, sim!.partsAt(tick), 0, -1.2);
    world.rig.set({ pos: new THREE.Vector3(0, 1.6, 9), look: new THREE.Vector3(0, 1.0, 0), fov: world.camera.aspect < 1 ? 62 : 45 });
  };
}

let last = performance.now();
let clock = 0;
let lab: ((clock: number) => void) | null = null;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  if (lab) lab(clock);
  else if (session) session.update(dt, now);
  else {
    world.rig.set(world.menuCam(clock));
    world.pose(v3(backdrop.x, 0.11, backdrop.z), backdropKeeper, 0, -1.2);
  }
  world.update(dt);
  world.render();
  // The stadium is built; lift the loading screen after the first frame is on screen.
  const splash = document.getElementById('splash');
  if (splash && !splash.classList.contains('done')) {
    splash.classList.add('done');
    setTimeout(() => splash.remove(), 600);
  }
  requestAnimationFrame(frame);
}

// Dev: setLab(fn) takes over each frame (to pose and frame a scene by hand), setLab(null) hands back.
if (import.meta.env.DEV) Object.assign(window, { __fk: { world, THREE, sound, setLab: (f: typeof lab) => (lab = f) } });

showBackdrop();
// Dev shortcuts: #practice-shoot, #practice-keep (either with /penalty, /outside_box,
// /long_range or /any), #match, #fieldgoals, #practice-fieldgoals, #lab-keeper
const [quick, cat] = location.hash.slice(1).split('/');
if (quick.startsWith('practice-') && quick !== 'practice-fieldgoals') {
  const category = (['penalty', 'outside_box', 'long_range', 'any'] as const).find((c) => c === cat) ?? 'outside_box';
  start({ kind: 'practice', mode: 'freekick', role: quick === 'practice-keep' ? 'keep' : 'shoot', category, difficulty: 'medium', trace: true });
} else if (quick === 'match') {
  start({ kind: 'match', mode: 'freekick', difficulty: 'medium' });
} else if (quick === 'fieldgoals' || quick === 'practice-fieldgoals') {
  start(
    quick === 'fieldgoals'
      ? { kind: 'match', mode: 'fieldgoal', difficulty: 'medium' }
      : { kind: 'practice', mode: 'fieldgoal', role: 'shoot', category: 'any', difficulty: 'medium', trace: true },
  );
} else if (quick === 'lab-keeper') {
  lab = keeperLab();
} else {
  // PRESS START (the tap also wakes the audio up).
  const title = document.getElementById('title')!;
  title.hidden = false;
  title.addEventListener(
    'click',
    () => {
      sound.tick();
      title.hidden = true;
      menu.open();
    },
    { once: true },
  );
}
requestAnimationFrame(frame);

// Offline support once installed to the home screen (production builds only:
// in development the service worker would serve stale modules).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
