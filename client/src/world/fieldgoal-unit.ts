// The field goal unit and the rush: the snapper and the line, the holder who
// takes the snap and spots the ball, and the seven defenders posed straight
// from the sim's rush model (shared/src/fieldgoal.ts), so what you see block
// a kick is exactly what the ball hit. Also the snap itself: the ball's path
// from the snapper to the holder's hands and down onto the spot.

import * as THREE from 'three';
import { HOLD_TIME, LOS_DISTANCE, RUSHER_COUNT, RUSH_PELVIS_Y, RUSH_REACH, RUSH_SHOULDER, kickFrame, rusherAt, type Spot, type Vec3 } from '@fk/shared';
import { bodyPose, breathe, emptyJoints, Figure, poseEmote, type EmoteState, type Kit } from './figure';

/** The snap takes this long to reach the holder's hands. */
export const SNAP_FLIGHT = 0.36;
/** Where the holder catches it, in the kick's frame (lateral, forward, height): his hands, held out to the snapper. */
const CATCH: [number, number, number] = [0.2, 0.6, 0.74];
/** Where the holder kneels (lateral, forward), and the way he faces: at the snapper, turned in toward the spot. */
const HOLDER: [number, number] = [0.52, 0.08];
const HOLDER_FACING: [number, number] = [-0.5, 0.86];
/** Football's centre when it stands on its tip. */
export const HELD_Y = 0.14;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function at(spot: Spot, lat: number, fwd: number, y: number): THREE.Vector3 {
  const p = kickFrame(spot, lat, fwd);
  return new THREE.Vector3(p.x, y, p.z);
}

/**
 * The ball before the kick, τ seconds after the snap: on the ground at the
 * line, spiralling back to the holder, then brought down onto the spot.
 */
export function snapBallAt(spot: Spot, tau: number): Vec3 {
  const start = at(spot, 0, LOS_DISTANCE - 0.1, 0.13);
  const leave = at(spot, 0, LOS_DISTANCE - 0.55, 0.32);
  const hands = at(spot, ...CATCH);
  const down = new THREE.Vector3(spot.x, HELD_Y, spot.z);
  let p: THREE.Vector3;
  if (tau <= 0) p = start;
  else if (tau < 0.05) p = start.clone().lerp(leave, tau / 0.05);
  else if (tau < SNAP_FLIGHT) {
    const s = (tau - 0.05) / (SNAP_FLIGHT - 0.05);
    p = leave.clone().lerp(hands, s);
    p.y += 0.25 * 4 * s * (1 - s);
  } else p = hands.clone().lerp(down, smooth(SNAP_FLIGHT, HOLD_TIME, tau));
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * The football's long axis before the kick: along its flight on the snap (a
 * spiral), turning upright as the holder spots it; null once it's down.
 */
export function snapBallAxis(spot: Spot, tau: number): THREE.Vector3 | null {
  if (tau >= HOLD_TIME) return null;
  const goalward = new THREE.Vector3(-spot.x, 0, -spot.z).normalize();
  const flat = goalward.clone().negate().setY(0.15).normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(goalward, -0.12).normalize();
  return flat.lerp(up, smooth(SNAP_FLIGHT, HOLD_TIME, tau)).normalize();
}

/** The interior line and the snapper, laterally from the kick line. */
const LINE = [-1.8, -0.9, 0, 0.9, 1.8];

/** The edge rushers leave their feet this long after the snap, diving across the kick point (the ball's long gone). */
const DIVE_AT = 1.45;
const DIVE_TIME = 0.5;
/** The rusher who taunts: the gunner on the right of the kicker's screen. */
const TAUNTER = RUSHER_COUNT - 1;

/** A little per-man difference (0 … 1) so nobody moves like his neighbour. */
const quirk = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export class FieldGoalUnit {
  readonly group = new THREE.Group();
  readonly holder: Figure;
  private readonly line: Figure[] = [];
  private readonly rushers: Figure[] = [];
  private readonly los: THREE.Mesh;
  private readonly joints = emptyJoints();
  private readonly emoteA = emptyJoints();
  private readonly emoteB = emptyJoints();
  private spot: Spot | null = null;

  constructor(offense: Kit, defense: Kit) {
    this.holder = new Figure(offense);
    this.holder.setGear('football');
    this.group.add(this.holder.group);
    for (let i = 0; i < LINE.length; i++) {
      const f = new Figure(offense);
      f.setGear('football');
      this.line.push(f);
      this.group.add(f.group);
    }
    for (let i = 0; i < RUSHER_COUNT; i++) {
      const f = new Figure(defense);
      f.setGear('football');
      this.rushers.push(f);
      this.group.add(f.group);
    }
    // The broadcast's blue line of scrimmage, painted across the field.
    this.los = new THREE.Mesh(
      new THREE.PlaneGeometry(48.8, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x2f6bff, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.los.rotation.x = -Math.PI / 2;
    this.los.position.y = 0.015;
    this.group.add(this.los);
    this.group.visible = false;
  }

  setTeams(offense: Kit, defense: Kit): void {
    this.holder.setKit(offense, 4);
    this.line.forEach((f, i) => f.setKit(offense, [64, 72, 58, 66, 77][i]));
    this.rushers.forEach((f, i) => f.setKit(defense, [91, 55, 97, 93, 99, 52, 94][i]));
  }

  setSpot(spot: Spot): void {
    this.spot = spot;
    this.los.position.z = at(spot, 0, LOS_DISTANCE, 0).z;
  }

  /**
   * Everyone, τ seconds after the snap (negative: set, waiting for it);
   * `kickT` is relative to the kick, and `clock` is wall time (for the small
   * movements of men waiting).
   */
  pose(tau: number, kickT: number, clock = 0, emote: EmoteState | null = null): void {
    const spot = this.spot;
    if (!spot) return;
    const j = this.joints;
    const F = new THREE.Vector3(-spot.x, 0, -spot.z).normalize();
    const R = new THREE.Vector3(-F.z, 0, F.x);
    const UP = new THREE.Vector3(0, 1, 0);
    const t = Math.max(0, tau);

    // The holder kneels on his right knee at the kicker's right of the spot,
    // facing the snapper (turned in toward the spot): both hands held out as
    // the target, catches the snap, brings it down onto the spot and holds it
    // on its tip with a finger of his left hand, the right resting on his
    // thigh; whips the finger away as the kicker swings through, and comes up
    // onto his knee to watch it go.
    {
      const base = at(spot, HOLDER[0], HOLDER[1], 0);
      const f = F.clone().multiplyScalar(HOLDER_FACING[1]).addScaledVector(R, HOLDER_FACING[0]).normalize();
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const watch = smooth(0.15, 0.6, kickT);
      const pelvis = base.clone().setY(0.52 + 0.12 * watch);
      const kneel = base.clone().addScaledVector(r, 0.11).addScaledVector(f, -0.42).setY(0.08);
      const plant = base.clone().addScaledVector(r, -0.12).addScaledVector(f, 0.36).setY(0.09);
      const ball = new THREE.Vector3().copy(snapBallAt(spot, tau) as THREE.Vector3);
      const target = at(spot, ...CATCH);
      // Leaning out over the ball while he holds it, upright to take the snap and to watch.
      const over = smooth(SNAP_FLIGHT, HOLD_TIME, tau) * (1 - watch);
      const chest = f.clone().multiplyScalar(0.1 + 0.12 * over).addScaledVector(r, -0.08 * over).setY(0.47);
      const rest = pelvis.clone().addScaledVector(r, 0.2).addScaledVector(f, 0.2).setY(0.5);
      let hl: THREE.Vector3;
      let hr: THREE.Vector3;
      if (tau < SNAP_FLIGHT) {
        // Palms out to the snapper, a ball's width apart; reaching in to meet it.
        const reach = smooth(SNAP_FLIGHT - 0.1, SNAP_FLIGHT, tau);
        hl = target.clone().addScaledVector(r, -0.09 + 0.02 * reach);
        hr = target.clone().addScaledVector(r, 0.09 - 0.02 * reach);
      } else if (tau < HOLD_TIME) {
        hl = ball.clone().addScaledVector(r, -0.08).setY(ball.y + 0.06);
        hr = ball.clone().addScaledVector(r, 0.08).setY(ball.y - 0.02).lerp(rest, smooth(HOLD_TIME - 0.08, HOLD_TIME, tau));
      } else {
        // The finger on top, then whipped away up and back out of the kicker's path.
        const off = smooth(-0.03, 0.08, kickT);
        const finger = new THREE.Vector3(spot.x, HELD_Y + 0.17, spot.z).addScaledVector(r, -0.02);
        hl = finger.lerp(pelvis.clone().addScaledVector(f, 0.15).addScaledVector(r, -0.3).setY(0.95), off);
        hr = rest;
      }
      bodyPose(j, pelvis, f, chest, plant, kneel, hl, hr, f.clone().add(UP), f);
      if (tau < 0) breathe(j, clock, 1);
      this.holder.setPose(j);
    }

    // The snapper and the line: set in a crouch, then up into their blocks,
    // giving a little ground to the rush.
    LINE.forEach((lat, i) => {
      const snapper = lat === 0;
      const up = smooth(0.08, 0.3, tau);
      const give = Math.min(0.45, 0.35 * Math.max(0, t - 0.2));
      const base = at(spot, lat, LOS_DISTANCE - (snapper ? 0.5 : 0.45) - give, 0);
      const pelvis = base.clone().setY((snapper ? 0.74 : 0.8) + 0.1 * up);
      const bend = snapper ? 0.4 * (1 - up) + 0.16 * up : 0.26 * (1 - up) + 0.14 * up;
      const chest = F.clone().multiplyScalar(bend).setY(0.5 - bend * 0.5);
      // Taking on the man in front: rocked side to side and back a little, each on his own beat.
      chest.addScaledVector(R, Math.sin(t * 6.5 + i * 1.7) * 0.035 * up).addScaledVector(F, -Math.abs(Math.sin(t * 4.3 + i)) * 0.04 * up);
      const foot = (side: number) => base.clone().addScaledVector(R, side * 0.3).addScaledVector(F, -0.05).setY(0.09);
      let hl: THREE.Vector3;
      let hr: THREE.Vector3;
      const block = (side: number) => pelvis.clone().add(chest).addScaledVector(F, 0.32).addScaledVector(R, side * 0.16).add(new THREE.Vector3(0, -0.08, 0));
      if (snapper && tau < 0.12) {
        // Hands on the ball, then swung back between the legs.
        const ball = new THREE.Vector3().copy(snapBallAt(spot, Math.min(tau, 0.04)) as THREE.Vector3);
        const swing = smooth(0, 0.12, tau);
        hl = ball.clone().addScaledVector(R, -0.1).lerp(base.clone().addScaledVector(F, -0.15).setY(0.35), swing);
        hr = ball.clone().addScaledVector(R, 0.1).lerp(base.clone().addScaledVector(F, -0.15).setY(0.35), swing);
      } else if (tau < 0.08) {
        const knee = (side: number) => base.clone().addScaledVector(R, side * 0.24).addScaledVector(F, 0.25).setY(0.48);
        hl = knee(-1);
        hr = knee(1);
      } else {
        hl = block(-1);
        hr = block(1);
      }
      bodyPose(j, pelvis, F, chest, foot(-1), foot(1), hl, hr);
      if (tau < 0.05) breathe(j, clock, 10 + i);
      this.line[i].setPose(j);
    });

    // The rush, exactly as the sim has it: the middle fights the blockers,
    // then each man loads and jumps on his own read, arms going up as he
    // leaves the ground; the edges come off a stance, run round and dive.
    const back = F.clone().negate();
    this.rushers.forEach((fig, i) => {
      const rs = rusherAt(i, t);
      const base = at(spot, rs.lat, rs.fwd, 0);
      if (rs.edge) {
        this.poseEdge(fig, i, spot, tau, clock, back, i === TAUNTER ? emote : null);
        return;
      }
      const q = quirk(i, 1);
      // Square to the kicker, turned a touch toward the ball.
      const f = back.clone().addScaledVector(R, (rs.lat > 0 ? 1 : -1) * 0.12 + (q - 0.5) * 0.15).normalize();
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const pelvis = base.clone().setY(RUSH_PELVIS_Y - rs.crouch + rs.lift);
      // Leaning into the man in front until he goes up; tall in the air.
      const lean = (0.2 + 0.25 * rs.crouch) * (1 - rs.armUp) + 0.05;
      const chest = f.clone().multiplyScalar(lean).setY(Math.sqrt(RUSH_SHOULDER * RUSH_SHOULDER - lean * lean));
      const shoulderY = pelvis.y + chest.y;
      const hand = (side: number) => {
        // Engaged: hands on the blocker's chest. Up: a loose V, elbows soft, one hand a little higher.
        const lead = side === (q > 0.5 ? 1 : -1) ? 1 : 0;
        const fight = pelvis.clone().add(chest).addScaledVector(f, 0.36).addScaledVector(r, side * 0.17).setY(shoulderY - 0.15);
        if (tau < 0.05) {
          // Set: hands down on the thighs, or one on the turf.
          const down = pelvis.clone().addScaledVector(f, 0.3).addScaledVector(r, side * 0.2);
          return down.setY(lead && q > 0.7 ? 0.08 : pelvis.y - 0.15);
        }
        const up = pelvis.clone().add(chest).addScaledVector(r, side * (0.25 + 0.05 * q)).addScaledVector(f, 0.1 + 0.06 * lead);
        up.y = shoulderY + RUSH_REACH * (0.93 + 0.07 * lead);
        return fight.lerp(up, rs.armUp);
      };
      // Feet planted under the hips, tucked up under him in the air.
      const tuck = Math.min(0.28, rs.lift * 0.55);
      const foot = (side: number) =>
        base.clone().addScaledVector(r, side * (0.19 + 0.04 * q)).addScaledVector(f, side * (q - 0.5) * 0.2 - tuck * 0.25).setY(0.09 + Math.max(0, rs.lift - tuck));
      bodyPose(j, pelvis, f, chest, foot(-1), foot(1), hand(-1), hand(1), f.clone().add(UP.clone().multiplyScalar(0.2)));
      if (tau < 0.05) breathe(j, clock, 20 + i);
      fig.setPose(j);
    });
  }

  /**
   * An edge rusher: a three-point stance, then a real run (strides that
   * lengthen as he gets going, knees up, arms pumping against the legs,
   * leaning into the acceleration) and a dive across the kick point, landing
   * on his front.
   */
  private poseEdge(fig: Figure, i: number, spot: Spot, tau: number, clock: number, back: THREE.Vector3, emote: EmoteState | null): void {
    const j = this.joints;
    const UP = new THREE.Vector3(0, 1, 0);
    const t = Math.max(0, Math.min(tau, DIVE_AT));
    const rs = rusherAt(i, t);
    const ahead = rusherAt(i, t + 0.05);
    const base = at(spot, rs.lat, rs.fwd, 0);
    const heading = at(spot, ahead.lat, ahead.fwd, 0).sub(base).setY(0);
    const f = heading.lengthSq() > 1e-6 ? heading.normalize() : back.clone();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const q = quirk(i, 2);

    if (tau < 0.05) {
      // Three-point stance: hips high, back flat, one hand down.
      const pelvis = base.clone().setY(0.78);
      const chest = f.clone().multiplyScalar(0.36).setY(0.3);
      const handDown = pelvis.clone().addScaledVector(f, 0.62).addScaledVector(r, 0.1).setY(0.06);
      const handRest = pelvis.clone().addScaledVector(f, 0.3).addScaledVector(r, -0.22).setY(0.45);
      const foot = (side: number) => base.clone().addScaledVector(r, side * 0.2).addScaledVector(f, side * 0.18 - 0.1).setY(0.09);
      bodyPose(j, pelvis, f, chest, foot(-1), foot(1), handRest, handDown);
      breathe(j, clock, 30 + i);
      // Up out of his stance to give the kicker something to think about.
      if (emote) poseEmote(j, emote, clock, base, at(spot, -1, -1, 0).sub(base).setY(0), this.emoteA, this.emoteB);
      fig.setPose(j);
      return;
    }

    if (tau < DIVE_AT) {
      const speed = rs.speed;
      // Stride (one step) grows with speed; the cycle runs off the distance covered, so feet don't skate.
      const step = 0.45 + 0.13 * speed;
      const phase = (rs.run / (2 * step)) * Math.PI * 2 + q * 6;
      const go = Math.min(1, speed / 3);
      const accel = Math.max(0, 1 - tau / 0.9);
      const lean = 0.12 + 0.28 * accel;
      const pelvis = base.clone().setY(0.93 - rs.crouch + 0.035 * Math.abs(Math.cos(phase)) * go);
      const chest = f.clone().multiplyScalar(lean).setY(Math.sqrt(0.5 * 0.5 - lean * lean));
      const leg = (side: number) => {
        const p = phase + (side > 0 ? Math.PI : 0);
        const fore = Math.sin(p) * step * 0.55 * go;
        // Swinging through (moving forward relative to the hips): knee and foot come up.
        const swing = Math.max(0, Math.cos(p));
        return base.clone().addScaledVector(r, side * 0.12).addScaledVector(f, fore).setY(0.09 + swing * 0.3 * go);
      };
      const arm = (side: number) => {
        // Opposite arm to the leg; elbows bent, hands from the hip to chin height.
        const p = phase + (side > 0 ? 0 : Math.PI);
        const s2 = Math.sin(p);
        return pelvis.clone().add(chest).addScaledVector(r, side * 0.24).addScaledVector(f, 0.05 + s2 * 0.32 * go).setY(pelvis.y + chest.y - 0.32 + 0.22 * Math.max(0, s2) * go);
      };
      const knee = f.clone().add(UP.clone().multiplyScalar(0.3));
      bodyPose(j, pelvis, f, chest, leg(-1), leg(1), arm(-1), arm(1), knee);
      fig.setPose(j);
      return;
    }

    // The dive: off the ground along his line, body tipping flat, arms out for the ball, down on his front.
    const d = Math.min(1, (tau - DIVE_AT) / DIVE_TIME);
    const out = 1 - (1 - d) * (1 - d);
    const pelvis = base.clone().addScaledVector(f, 1.9 * out);
    pelvis.y = 0.9 + 0.3 * Math.sin(Math.PI * Math.min(1, d * 1.3)) - 0.62 * d * d;
    const tip = 0.35 + 1.15 * out;
    const chest = f.clone().multiplyScalar(0.5 * Math.sin(tip)).setY(0.5 * Math.cos(tip));
    const reach = pelvis.clone().add(chest).addScaledVector(f, 0.55);
    reach.y = Math.max(0.12, reach.y + 0.15 * (1 - d));
    const hand = (side: number) => reach.clone().addScaledVector(r, side * (0.2 + 0.06 * q));
    const trail = (side: number) => {
      const a = pelvis.clone().addScaledVector(f, -0.8 * Math.sin(tip)).addScaledVector(r, side * (0.14 + 0.08 * d));
      a.y = Math.max(0.1, pelvis.y - 0.8 * Math.cos(tip) + (side > 0 ? 0.12 : 0) * (1 - d));
      return a;
    };
    bodyPose(j, pelvis, f, chest, trail(-1), trail(1), hand(-1), hand(1), UP.clone().negate().add(f));
    fig.setPose(j);
  }
}
