// Full-screen touch layer. One finger flicks (routed by the current mode,
// SPEC §3); two fingers move the camera (drag to orbit, pinch to zoom). On
// desktop, right-drag orbits and the wheel zooms.

import { analyzeSwipe, type SwipeSample } from '@fk/shared';
import type { Trail } from '../ui/trail';

export type GestureMode = 'none' | 'shoot' | 'keep' | 'wall';

/** Fraction of the screen height a flick may start below (SPEC §3.1, §3.2). */
const ZONE_TOP: Record<GestureMode, number> = { none: 0, shoot: 0.4, keep: 0.3, wall: 0 };
const EDGE_GUARD = 24;

export class Gestures {
  mode: GestureMode = 'none';
  onShoot: ((samples: SwipeSample[], screenH: number) => void) | null = null;
  onKeep: ((samples: SwipeSample[], screenH: number, endTime: number) => void) | null = null;
  /** Keep mode, while the finger is still down */
  onKeepDrag: ((samples: SwipeSample[]) => void) | null = null;
  onWallDrag: ((dxFraction: number) => void) | null = null;
  onTap: (() => void) | null = null;
  /** Camera: orbit by a fraction of the screen, zoom by a factor (> 1 = closer) */
  onOrbit: ((dx: number, dy: number) => void) | null = null;
  onZoom: ((factor: number) => void) | null = null;
  /** Draws every one-finger swipe */
  trail: Trail | null = null;
  /** A swipe that couldn't count, with why (started too high, say) */
  onRejected: ((why: string) => void) | null = null;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private samples: SwipeSample[] = [];
  private flicking = false;
  /** How the current stroke is read: a shot, a keeper flick, or one that won't count */
  private kind: 'shoot' | 'keep' | 'idle' | null = null;
  private startedHigh = false;
  private camera: { cx: number; cy: number; dist: number } | null = null;
  private mouseOrbit: { x: number; y: number } | null = null;
  private lastX = 0;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.cancel(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.onZoom?.(Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  private down(e: PointerEvent): void {
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone (or synthetic); moves still arrive on this element.
    }
    if (e.pointerType === 'mouse' && e.button === 2) {
      this.mouseOrbit = { x: e.clientX, y: e.clientY };
      return;
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      // A second finger turns the gesture into a camera move.
      this.flicking = false;
      this.trail?.clear();
      this.camera = this.pinchState();
      return;
    }
    const h = window.innerHeight;
    const w = window.innerWidth;
    this.startedHigh = false;
    if (this.mode === 'shoot' || this.mode === 'keep') {
      const inZone = e.clientY >= h * ZONE_TOP[this.mode] && e.clientX >= EDGE_GUARD && e.clientX <= w - EDGE_GUARD;
      this.kind = inZone ? this.mode : 'idle';
      this.startedHigh = !inZone;
    } else {
      this.kind = this.mode === 'wall' ? null : 'idle';
    }
    this.flicking = true;
    this.lastX = e.clientX;
    this.samples = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    // Every swipe draws, so you always see your input; ones that won't count are grey.
    if (this.kind) this.trail?.begin(e.clientX, e.clientY, this.kind);
  }

  private move(e: PointerEvent): void {
    if (this.mouseOrbit) {
      this.onOrbit?.((e.clientX - this.mouseOrbit.x) / window.innerWidth, (e.clientY - this.mouseOrbit.y) / window.innerHeight);
      this.mouseOrbit = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.camera) {
      const now = this.pinchState();
      if (!now) return;
      this.onOrbit?.((now.cx - this.camera.cx) / window.innerWidth, (now.cy - this.camera.cy) / window.innerHeight);
      if (this.camera.dist > 0) this.onZoom?.(now.dist / this.camera.dist);
      this.camera = now;
      return;
    }
    if (!this.flicking) return;
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) {
      this.samples.push({ x: ev.clientX, y: ev.clientY, t: ev.timeStamp });
      if (this.kind) this.trail?.add(ev.clientX, ev.clientY);
    }
    if (this.kind === 'shoot') {
      // Live power: the trail's colour and the percentage at the fingertip.
      const a = analyzeSwipe(this.samples, window.innerHeight);
      if (a) this.trail?.setPower(a.power);
    }
    if (this.kind === 'keep') this.onKeepDrag?.(this.samples);
    if (this.mode === 'wall') {
      this.onWallDrag?.((e.clientX - this.lastX) / window.innerWidth);
      this.lastX = e.clientX;
    }
  }

  private up(e: PointerEvent): void {
    if (this.mouseOrbit && e.pointerType === 'mouse' && e.button === 2) {
      this.mouseOrbit = null;
      return;
    }
    this.pointers.delete(e.pointerId);
    if (this.camera) {
      if (this.pointers.size < 2) this.camera = null;
      return;
    }
    if (!this.flicking) return;
    this.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (this.kind) this.trail?.add(e.clientX, e.clientY);
    this.finish(e.timeStamp);
  }

  /** The stroke is over: hand it to whoever reads it. */
  private finish(endTime: number): void {
    this.flicking = false;
    this.trail?.end();
    const s = this.samples;
    const moved = Math.hypot(s[s.length - 1].x - s[0].x, s[s.length - 1].y - s[0].y);
    const h = window.innerHeight;
    if (this.kind === 'shoot') this.onShoot?.(s, h);
    else if (this.kind === 'keep') this.onKeep?.(s, h, endTime);
    else if (this.kind === 'idle') {
      this.trail?.reject();
      if (this.startedHigh && moved > 30) this.onRejected?.(this.mode === 'shoot' ? 'Start your swipe lower, near the ball' : 'Start your flick lower down');
      else if (this.mode === 'none' && moved < 12) this.onTap?.();
    }
    this.kind = null;
  }

  private cancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.mouseOrbit = null;
    if (this.pointers.size < 2) this.camera = null;
    if (!this.flicking) return;
    // iOS cancels a touch that strays into a system gesture (the home bar,
    // the screen edge). A flick that got going still counts, up to where it got.
    const s = this.samples;
    const moved = s.length > 1 ? Math.hypot(s[s.length - 1].x - s[0].x, s[s.length - 1].y - s[0].y) : 0;
    if ((this.kind === 'shoot' || this.kind === 'keep') && moved > 0.06 * window.innerHeight) {
      this.finish(e.timeStamp);
      return;
    }
    this.flicking = false;
    this.kind = null;
    this.trail?.clear();
  }

  private pinchState(): { cx: number; cy: number; dist: number } | null {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }
}
