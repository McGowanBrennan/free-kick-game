// The player's own camera: two fingers (or right-drag / wheel) orbit and zoom
// around the ball or the keeper. Saved per role, so your preferred shooting
// view and keeping view stick between kicks and sessions.

import * as THREE from 'three';
import type { ViewOffset, World } from '../world/world';

export type ViewRole = 'shoot' | 'keep' | 'replay';

const STORE_KEY = 'fk.view';
const neutral = (): ViewOffset => ({ yaw: 0, pitch: 0, dist: 1 });

function load(): Record<ViewRole, ViewOffset> {
  const base = { shoot: neutral(), keep: neutral(), replay: neutral() };
  try {
    const saved: Record<ViewRole, ViewOffset> = { ...base, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') };
    // Views saved under older, looser limits are pulled back inside the current ones.
    for (const o of Object.values(saved)) o.dist = THREE.MathUtils.clamp(o.dist, 0.45, 2.2);
    return saved;
  } catch {
    return base;
  }
}

export class ViewControl {
  private readonly offsets = load();
  private role: ViewRole | null = null;

  constructor(
    private readonly world: World,
    private readonly onChange: (adjusted: boolean) => void,
  ) {}

  /** Switch which saved view applies; null = the game's own camera only. */
  setRole(role: ViewRole | null, pivot?: { x: number; y: number; z: number }): void {
    this.role = role;
    const rig = this.world.rig;
    rig.offset = role ? this.offsets[role] : neutral();
    rig.pivot = role && pivot ? new THREE.Vector3(pivot.x, pivot.y, pivot.z) : null;
    this.onChange(this.adjusted());
  }

  orbit(dx: number, dy: number): void {
    if (!this.role) return;
    const o = this.offsets[this.role];
    o.yaw -= dx * 3;
    o.pitch = THREE.MathUtils.clamp(o.pitch + dy * 2, -1.2, 1.4);
    this.changed();
  }

  zoom(factor: number): void {
    if (!this.role) return;
    const o = this.offsets[this.role];
    o.dist = THREE.MathUtils.clamp(o.dist / factor, 0.45, 2.2);
    this.changed();
  }

  /** Forget every saved view (settings). */
  resetAll(): void {
    for (const role of Object.keys(this.offsets) as ViewRole[]) this.offsets[role] = neutral();
    if (this.role) this.world.rig.offset = this.offsets[this.role];
    this.changed();
  }

  reset(): void {
    if (!this.role) return;
    this.offsets[this.role] = neutral();
    this.world.rig.offset = this.offsets[this.role];
    this.changed();
  }

  private adjusted(): boolean {
    if (!this.role) return false;
    const o = this.offsets[this.role];
    return Math.abs(o.yaw) > 0.01 || Math.abs(o.pitch) > 0.01 || Math.abs(o.dist - 1) > 0.01;
  }

  private changed(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.offsets));
    } catch {
      // Storage unavailable: the view just won't persist.
    }
    this.onChange(this.adjusted());
  }
}
