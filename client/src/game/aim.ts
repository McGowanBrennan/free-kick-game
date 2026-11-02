// Flick → kick, through the camera (SPEC §3.1). Where the finger lifts is
// where the ball goes: the release point is cast onto the goal plane, so a
// swipe that ends on the top corner aims at the top corner, from any view the
// player has chosen. The swipe's bend sets the line the ball starts on. For a
// chip (swiped up then pulled back) the aim is the top of the swipe.

import * as THREE from 'three';
import {
  BALL_RADIUS,
  DEFAULT_PARAMS,
  GOAL_HALF_WIDTH,
  HAND_PARTS,
  INPUT,
  KEEPER_Z,
  MAX_AIM_Y,
  TAP,
  flickForHandTarget,
  planKeeper,
  startLineOnScreen,
  type KeeperInput,
  type KeeperPart,
  type KickInput,
  type Spot,
  type SwipeAnalysis,
  type SwipeSample,
} from '@fk/shared';

const GOAL_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();

export type AimResult = { kick: KickInput } | { error: string };

export function kickFromSwipe(
  swipe: SwipeAnalysis,
  release: { x: number; y: number },
  camera: THREE.PerspectiveCamera,
  spot: Spot,
  maxAimY = MAX_AIM_Y,
): AimResult {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const toScreen = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind: v.z > 1 };
  };
  const castTo = (sx: number, sy: number, plane: THREE.Plane): THREE.Vector3 | null => {
    raycaster.setFromCamera(new THREE.Vector2((sx / w) * 2 - 1, 1 - (sy / h) * 2), camera);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  };
  const ball = toScreen(spot.x, BALL_RADIUS, spot.z);
  if (ball.behind) return { error: 'Turn the camera toward the goal' };

  // The aim point: the release cast onto the goal plane. Released below the
  // goal (on the grass in front of it), it's a ground shot along that line.
  let target = castTo(release.x, release.y, GOAL_PLANE);
  if (!target || target.y < BALL_RADIUS) {
    const g = castTo(release.x, release.y, GROUND);
    if (!g || g.z >= spot.z - 0.5) return { error: 'Swipe toward the goal' };
    target = new THREE.Vector3(spot.x + ((g.x - spot.x) * spot.z) / (spot.z - g.z), BALL_RADIUS, 0);
  }
  const y = Math.min(target.y, maxAimY);

  // The start line: the swipe's opening direction, carried onto the line from
  // the ball to the aim point, meets the goal (at the aimed height) here.
  let sx = target.x;
  if (swipe.turn !== 0 && !swipe.chip) {
    const a = toScreen(-12, y, 0);
    const b = toScreen(12, y, 0);
    const hit = !a.behind && !b.behind ? startLineOnScreen(ball, toScreen(target.x, y, 0), swipe.turn, a, b) : null;
    const p = hit && castTo(hit.x, hit.y, GOAL_PLANE);
    // Too wide to place on the goal line: as wide as a start line goes.
    sx = p ? p.x : target.x + Math.sign(swipe.turn) * 14;
  }

  return { kick: { x: target.x, y, p: swipe.power, sx, durMs: swipe.durMs, chip: swipe.chip || undefined } };
}

/**
 * Up the screen counts this much less than across it when reading a keeper
 * flick: the keeper's camera looks down on the goal, so it looks much flatter
 * than it is, and a natural diagonal flick should reach the top corner, not
 * jump straight up.
 */
const KEEPER_UP_GAIN = 0.6;

/**
 * Keeper flick → where the hands go (SPEC §3.2), measured against the goal
 * as it appears on screen: flick the on-screen width of the goal sideways and
 * the hands go that far (from the post you see to the other post); up the
 * screen lifts them (at KEEPER_UP_GAIN of that scale). Works from any view.
 * Null for a tap (stay set).
 */
export function diveTarget(
  samples: SwipeSample[],
  keeper: KeeperPart[],
  camera: THREE.PerspectiveCamera,
): { x: number; y: number } | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const h = window.innerHeight;
  const w = window.innerWidth;
  if (Math.hypot(last.x - first.x, last.y - first.y) / h < INPUT.tapMaxLen) return null;
  // Screen pixels per metre of goal, and which way is the keeper's +x on screen.
  const l = new THREE.Vector3(-GOAL_HALF_WIDTH, 1.2, KEEPER_Z).project(camera);
  const r = new THREE.Vector3(GOAL_HALF_WIDTH, 1.2, KEEPER_Z).project(camera);
  const ex = ((r.x - l.x) / 2) * w;
  const ey = ((l.y - r.y) / 2) * h;
  const goalPx = Math.hypot(ex, ey);
  if (goalPx < 1) return null;
  const perM = goalPx / (2 * GOAL_HALF_WIDTH);
  const fx = last.x - first.x;
  const fy = last.y - first.y;
  // Along the goal (+x), and up the screen at right angles to it (screen y points down).
  const along = (fx * ex + fy * ey) / goalPx;
  const flip = ex < 0 ? -1 : 1;
  const up = (flip * (fx * ey - fy * ex)) / goalPx;
  const a = keeper[HAND_PARTS[0]].a;
  const b = keeper[HAND_PARTS[1]].a;
  const P = DEFAULT_PARAMS;
  const dx = along / perM;
  // Only a flick that's mostly upward is a jump; a clearly sideways one tops out at a full-height dive.
  const top = Math.abs(dx) > 0.8 ? P.highHandY : P.jumpHandY;
  return {
    x: (a.x + b.x) / 2 + dx,
    y: THREE.MathUtils.clamp((a.y + b.y) / 2 + (up / perM) * KEEPER_UP_GAIN, P.lowHandY, top),
  };
}

/** The keeper input that reaches `target` (or stays set when it's within easy reach of the stance). */
export function keeperInputFor(target: { x: number; y: number } | null, keeperX: number, durMs: number, flickTick: number): KeeperInput {
  const P = DEFAULT_PARAMS;
  if (!target) return { ...TAP, flickTick };
  const dx = target.x - keeperX;
  if (Math.abs(dx) < 0.5 && target.y < P.setReachY) return { ...TAP, flickTick };
  return { ...flickForHandTarget(dx, target.y, P), durMs, flickTick };
}

/** Where a keeper input actually sends the hands (the dive's reach is limited, less so low down). */
export function plannedHands(input: KeeperInput, keeperX: number): { x: number; y: number } | null {
  const plan = planKeeper(input, keeperX, DEFAULT_PARAMS);
  return plan.mode === 'dive' ? { x: plan.target.x, y: plan.target.y } : null;
}

/** Screen-right as a world direction on the ground (for keeper flicks and the wall drag). */
export function screenRightOnGround(camera: THREE.Camera): THREE.Vector3 {
  const r = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  r.y = 0;
  return r.lengthSq() > 1e-6 ? r.normalize() : new THREE.Vector3(1, 0, 0);
}
