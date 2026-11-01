// The two officials under the uprights: they watch the kick come in, then
// give the call a moment after it's decided: both arms straight up for
// good; arms scissoring across in front for no good.

import * as THREE from 'three';
import { FG_HALF_WIDTH } from '@fk/shared';
import { bodyPose, breathe, emptyJoints, Figure, KITS } from './figure';

/** Where they stand: under each upright, a pace behind the plane of the posts. */
const SPOTS = [new THREE.Vector3(-(FG_HALF_WIDTH + 0.35), 0, -0.9), new THREE.Vector3(FG_HALF_WIDTH + 0.35, 0, -0.9)];
/** They take this long to give it. */
const REACT = 0.3;

export interface RefCall {
  /** Seconds after contact the kick was decided */
  at: number;
  good: boolean;
}

export class RefereeCrew {
  readonly group = new THREE.Group();
  private readonly refs: Figure[];
  private readonly joints = emptyJoints();
  call: RefCall | null = null;

  constructor() {
    this.refs = [new Figure(KITS.refA), new Figure(KITS.refB)];
    for (const f of this.refs) {
      f.setGear('referee');
      this.group.add(f.group);
    }
    this.group.visible = false;
  }

  /** `kickT` seconds after contact (negative before it); `clock` is wall time. */
  pose(kickT: number, clock: number, ball: THREE.Vector3): void {
    const j = this.joints;
    const UP = new THREE.Vector3(0, 1, 0);
    const since = this.call ? kickT - this.call.at - REACT : -1;
    this.refs.forEach((fig, i) => {
      const base = SPOTS[i];
      // Facing up the field, turned a little toward the ball.
      const toBall = ball.clone().sub(base).setY(0);
      const f = new THREE.Vector3(0, 0, 1).lerp(toBall.lengthSq() > 1 ? toBall.normalize() : new THREE.Vector3(0, 0, 1), 0.35).normalize();
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const k = since > 0 ? Math.min(1, since / 0.3) : 0;
      const e = k * k * (3 - 2 * k);
      const pelvis = base.clone().setY(0.94 + 0.03 * e);
      const chest = f.clone().multiplyScalar(0.07 * (1 - e)).setY(0.5);
      const shoulderY = pelvis.y + 0.5;
      // Watching: hands resting on the thighs, knees soft.
      const rest = (s: number) => pelvis.clone().addScaledVector(r, s * 0.2).addScaledVector(f, 0.16).setY(pelvis.y - 0.2);
      let call: (s: number) => THREE.Vector3;
      if (this.call?.good) {
        call = (s) => pelvis.clone().addScaledVector(r, s * 0.21).addScaledVector(f, 0.03).setY(shoulderY + 0.58);
      } else {
        // Scissoring across in front, at the chest.
        const sw = Math.sin(Math.max(0, since) * 8 + i);
        call = (s) => pelvis.clone().addScaledVector(r, s * 0.45 * sw).addScaledVector(f, 0.36).setY(shoulderY - 0.04 + 0.04 * s);
      }
      const hand = (s: number) => rest(s).lerp(call(s), e);
      const foot = (s: number) => base.clone().addScaledVector(r, s * 0.2).setY(0.09);
      bodyPose(j, pelvis, f, chest, foot(-1), foot(1), hand(-1), hand(1), f.clone().add(UP.clone().multiplyScalar(0.1)));
      if (since < 0) breathe(j, clock, 60 + i * 7);
      fig.setPose(j);
    });
  }
}
