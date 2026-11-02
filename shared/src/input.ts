// Touch paths → inputs (SPEC §3). Runs on the client only, so trig is fine
// here: the server receives plain numbers.
//
// The shooter draws the shot:
//   release point   → where the ball goes: where the finger lifts, cast
//                     through the camera onto the goal (client side),
//   start direction → the line it sets off on, so a bent swipe bends the ball:
//                     it leaves the way your finger set off and curls round to
//                     where it finished,
//   speed           → how hard: the flick's peak speed, so a quick flick that
//                     slows to stop on its target (a low corner, the end of a
//                     curl) keeps its power,
//   snap-back       → a chip: swipe up and snap straight back down at the end
//                     (a sharp reversal, not a curve rolling over), and the
//                     turn-around point is the aim (a Panenka from the spot).

import { clamp } from './vec';

export const INPUT = {
  minSwipeLen: 0.06,
  maxSwipeMs: 1000,
  /** Most a flick may lean from straight up and still count (degrees) */
  maxSwipeAngleDeg: 80,
  /** Chord length (screen heights) for a ground shot and for maxTargetHeight (harness pad only: it has no goal to aim at) */
  minAimLen: 0.06,
  maxAimLen: 0.56,
  /** Peak finger speed (screen heights / s, over ≥ peakWindowMs) for power 0 and 1 */
  minSwipeSpeed: 1.0,
  maxSwipeSpeed: 7.2,
  peakWindowMs: 40,
  /**
   * Swipes shorter than this (screen heights) get their speed scaled up by
   * √(ref / length), up to 1.35×: a low aim sits closer to the ball on screen,
   * and a short flick can't get as fast as a long one with the same effort.
   */
  powerRefLen: 0.45,
  /**
   * A chip is a deliberate snap back down after the top of the swipe: the path
   * reverses sharply there (turning more than chipReversalDeg within
   * chipCornerLen screen heights either side of the top: a cusp, not the
   * gradual turn of a curve that rolls over and comes down), then drops at
   * least chipPullback (screen heights) and chipPullbackShare of the upward
   * stroke, mostly straight down (≥ chipSteepness × its sideways movement).
   */
  chipReversalDeg: 135,
  chipCornerLen: 0.04,
  chipPullback: 0.06,
  chipPullbackShare: 0.15,
  chipSteepness: 1.5,
  /** The start direction is read from the first part of the path, this fraction of its length */
  startFraction: 0.3,
  /**
   * Turn between the start direction and the chord below this (radians) is a
   * natural thumb arc and doesn't curl; beyond it the turn is scaled by
   * curveGain (the early segment under-reads a curve's true start tangent).
   */
  curveDeadZone: 0.05,
  curveGain: 1.5,
  /** Most the start line may turn from the chord (radians) */
  curveMaxTurn: 0.6,
  tapMaxLen: 0.04,
  tapMaxMs: 200,
  keeperMaxLen: 0.35,
} as const;

/** A touch sample in CSS pixels (y down) with a timestamp in ms. */
export interface SwipeSample {
  x: number;
  y: number;
  t: number;
}

export interface SwipeAnalysis {
  /** Chord in screen heights (y down) */
  dx: number;
  dy: number;
  length: number;
  durMs: number;
  /** Peak finger speed, screen heights / s */
  speed: number;
  power: number;
  /** Swiped up then pulled back down: a chip, aimed at the turn-around point */
  chip: boolean;
  /** Index of the sample the aim is read from: the last one, or the top of a chip */
  aimIndex: number;
  /**
   * The start line, as a screen direction (unit, y down): the chord turned by
   * the swipe's curve. Equal to the chord's direction for a straight swipe.
   */
  startDx: number;
  startDy: number;
  /** Signed turn from the chord to the start line, radians; positive = starts right of the chord (curls left) */
  turn: number;
}

/**
 * Shooter input (SPEC §3.1): the aim point on the goal plane (metres), power
 * 0 … 1, and sx, where on the goal line the ball's initial direction points
 * (sx = x for a straight shot; the sim finds the bend between them).
 */
export interface KickInput {
  x: number;
  y: number;
  p: number;
  sx: number;
  durMs: number;
  /** A chip (lofted with backspin, SPEC §3.1); absent = a normal strike */
  chip?: boolean;
}

/**
 * Keeper input (SPEC §3.2): the flick vector in screen heights as seen from
 * behind the keeper (screen-right = keeper's right, y down), and the sim tick it
 * happened on relative to ball contact (negative during the run-up).
 */
export interface KeeperInput {
  vx: number;
  vy: number;
  durMs: number;
  flickTick: number;
}

/** Whether the path turns back on itself at sample `at` (directions over `span` pixels either side). */
function reversesAt(samples: SwipeSample[], at: number, span: number): boolean {
  const reach = (step: number) => {
    let i = at;
    let len = 0;
    while (i + step >= 0 && i + step < samples.length && len < span) {
      len += Math.hypot(samples[i + step].x - samples[i].x, samples[i + step].y - samples[i].y);
      i += step;
    }
    return samples[i];
  };
  const p = samples[at];
  const before = reach(-1);
  const after = reach(1);
  const ix = p.x - before.x;
  const iy = p.y - before.y;
  const ox = after.x - p.x;
  const oy = after.y - p.y;
  const li = Math.hypot(ix, iy);
  const lo = Math.hypot(ox, oy);
  if (li < 1e-6 || lo < 1e-6) return false;
  return (ix * ox + iy * oy) / (li * lo) < Math.cos((INPUT.chipReversalDeg * Math.PI) / 180);
}

export function analyzeSwipe(samples: SwipeSample[], screenH: number): SwipeAnalysis | null {
  if (samples.length < 2) return null;
  // A chip: the path tops out and comes back down. Everything up to the top is the shot.
  let top = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i].y < samples[top].y) top = i;
  const end = samples[samples.length - 1];
  const back = (end.y - samples[top].y) / screenH;
  const backSide = Math.abs(end.x - samples[top].x) / screenH;
  const rise = (samples[0].y - samples[top].y) / screenH;
  const chip =
    top > 0 &&
    back >= INPUT.chipPullback &&
    back >= INPUT.chipPullbackShare * rise &&
    back >= INPUT.chipSteepness * backSide &&
    reversesAt(samples, top, INPUT.chipCornerLen * screenH);
  const path = chip ? samples.slice(0, top + 1) : samples;

  const n = path.length;
  const first = path[0];
  const last = path[n - 1];
  const dx = (last.x - first.x) / screenH;
  const dy = (last.y - first.y) / screenH;
  const length = Math.hypot(dx, dy);
  const durMs = last.t - first.t;
  if (length < INPUT.minSwipeLen || durMs > INPUT.maxSwipeMs || durMs <= 0 || dy >= 0) return null;
  if ((Math.abs(Math.atan2(dx, -dy)) * 180) / Math.PI > INPUT.maxSwipeAngleDeg) return null;

  // Path length; then the peak speed over any window of ≥ peakWindowMs after
  // the first 15% of the path (a slow start doesn't count against it).
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y) / screenH);
  const total = cum[n - 1];
  let i0 = 0;
  while (i0 < n - 2 && cum[i0] < 0.15 * total) i0++;
  let speed = (total - cum[i0]) / (Math.max(30, last.t - path[i0].t) / 1000);
  for (let j = i0, i = i0 + 1; i < n; i++) {
    while (j + 1 < i && path[i].t - path[j + 1].t >= INPUT.peakWindowMs) j++;
    const dt = path[i].t - path[j].t;
    if (dt >= INPUT.peakWindowMs) speed = Math.max(speed, (cum[i] - cum[j]) / (dt / 1000));
  }
  const reach = clamp(Math.sqrt(INPUT.powerRefLen / length), 1, 1.35);
  const power = clamp((speed * reach - INPUT.minSwipeSpeed) / (INPUT.maxSwipeSpeed - INPUT.minSwipeSpeed), 0, 1);

  // Start line: the direction of the first part of the path, against the chord.
  const target = INPUT.startFraction * total;
  let k = 1;
  while (k < n - 1 && cum[k] < target) k++;
  const f = cum[k] > cum[k - 1] ? (target - cum[k - 1]) / (cum[k] - cum[k - 1]) : 1;
  const ex = path[k - 1].x + (path[k].x - path[k - 1].x) * f - first.x;
  const ey = path[k - 1].y + (path[k].y - path[k - 1].y) * f - first.y;
  const cx = dx / length;
  const cy = dy / length;
  // Signed angle from the chord to the early segment (y down: positive = clockwise = to the right).
  const raw = Math.atan2(cx * ey - cy * ex, cx * ex + cy * ey);
  const mag = chip ? 0 : Math.max(0, Math.abs(raw) - INPUT.curveDeadZone) * INPUT.curveGain;
  const turn = Math.sign(raw) * Math.min(INPUT.curveMaxTurn, mag);
  const ct = Math.cos(turn);
  const st = Math.sin(turn);
  return {
    dx,
    dy,
    length,
    durMs,
    speed,
    power,
    chip,
    aimIndex: chip ? top : samples.length - 1,
    startDx: cx * ct - cy * st,
    startDy: cx * st + cy * ct,
    turn,
  };
}

/** Shot height from the flick's length. */
export function heightFromLength(length: number, maxTargetHeight: number): number {
  return clamp((length - INPUT.minAimLen) / (INPUT.maxAimLen - INPUT.minAimLen), 0, 1) * maxTargetHeight;
}

interface Pt {
  x: number;
  y: number;
}

/**
 * Where the start line meets the goal on screen. The swipe's opening direction
 * is carried over to the shot: the ray from the ball's screen position, turned
 * from the ball → aim-point direction by `turn` (y down, positive = clockwise),
 * meets the on-screen line through a and b (the goal line at the aimed
 * height). Null if it points away from that line.
 */
export function startLineOnScreen(ball: Pt, aim: Pt, turn: number, a: Pt, b: Pt): Pt | null {
  const dx = aim.x - ball.x;
  const dy = aim.y - ball.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return null;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const rx = (dx * c - dy * s) / l;
  const ry = (dx * s + dy * c) / l;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = rx * ey - ry * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - ball.x) * ey - (a.y - ball.y) * ex) / den;
  if (t <= 0) return null;
  return { x: ball.x + rx * t, y: ball.y + ry * t };
}

export function keeperInputFromSwipe(samples: SwipeSample[], screenH: number, flickTick: number): KeeperInput {
  const first = samples[0];
  const last = samples[samples.length - 1] ?? first;
  return {
    vx: (last.x - first.x) / screenH,
    vy: (last.y - first.y) / screenH,
    durMs: last.t - first.t,
    flickTick,
  };
}
