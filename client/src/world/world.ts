// The 3D scene: renderer, lights, stadium, ball, figures and the camera rig.

import * as THREE from 'three';
import {
  BALL_RADIUS,
  FG_BAR_Y,
  LOS_DISTANCE,
  kickFrame,
  FG_HALF_WIDTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  KEEPER_Z,
  type KeeperPart,
  type CableCam,
  type KickStyle,
  type Spot,
  type Vec3,
} from '@fk/shared';
import {
  breathe,
  EMOTE_TIME,
  emptyJoints,
  FG_APPROACH_START,
  fieldGoalKickerJoints,
  Figure,
  keeperJoints,
  kickerJoints,
  KITS,
  poseEmote,
  wallJoints,
  type Emote,
  type EmoteState,
  type Kit,
} from './figure';
import { BallTrail } from './balltrail';
import { CableCamModel } from './cablecam';
import { CoinToss } from './cointoss';
import { RefereeCrew, type RefCall } from './fieldgoal-refs';
import { FieldGoalPosts, football } from './fieldgoal-posts';
import { FieldGoalUnit, snapBallAxis } from './fieldgoal-unit';
import { buildStadium, FLOODLIGHTS, type Stadium } from './pitch';
import { RetroRenderer } from './retro';
import { soccerBall } from './soccerball';
import { BlobShadows } from './shadows';

export interface CamPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

/** The player's own adjustment on top of the framed view: orbit and dolly around a pivot. */
export interface ViewOffset {
  yaw: number;
  pitch: number;
  dist: number;
}

const Y = new THREE.Vector3(0, 1, 0);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The keeper's camera: this far back and up from the keeper, and never further back than this z (the stand front is at −8). */
const KEEPER_CAM_BACK = 9;
const KEEPER_CAM_HEIGHT = 10.5;
const KEEPER_CAM_MIN_Z = -7.6;

/** Stiffness of the ball-tracking spring (rad/s): critically damped, so it eases in and out without overshoot. */
const TRACK_OMEGA = 7;

class CameraRig {
  /** The view the player asked for; the rendered one glides to it. */
  offset: ViewOffset = { yaw: 0, pitch: 0, dist: 1 };
  pivot: THREE.Vector3 | null = null;
  private readonly shown: ViewOffset = { yaw: 0, pitch: 0, dist: 1 };
  private from: CamPose | null = null;
  private to: CamPose;
  private t = 1;
  private dur = 0;
  private done: (() => void) | null = null;
  private track: THREE.Vector3 | null = null;
  private trackWeight = 0;
  /** How far tracking has pulled the look point off the framed one (spring state). */
  private readonly shift = new THREE.Vector3();
  private readonly shiftVel = new THREE.Vector3();
  private snap = true;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.to = { pos: new THREE.Vector3(0, 10, 30), look: new THREE.Vector3(), fov: 50 };
  }

  /** Cut straight to a pose. */
  set(pose: CamPose): void {
    this.from = null;
    this.to = pose;
    this.t = 1;
    this.snap = true;
    this.done?.();
    this.done = null;
  }

  /** Follow a moving pose (a chase), keeping the tracking spring's state. */
  move(pose: CamPose): void {
    this.from = null;
    this.to = pose;
    this.t = 1;
  }

  flyTo(pose: CamPose, seconds: number): Promise<void> {
    this.from = this.base();
    this.to = pose;
    this.t = 0;
    this.dur = seconds;
    this.done?.();
    return new Promise((resolve) => (this.done = resolve));
  }

  /** Blend the look-at point toward a moving target (the ball) so it stays in frame. */
  setTrack(point: Vec3 | null, weight = 0): void {
    if (!point) {
      this.track = null;
      return;
    }
    (this.track ??= new THREE.Vector3()).set(point.x, point.y, point.z);
    this.trackWeight = weight;
  }

  private base(): CamPose {
    if (!this.from || this.t >= 1) return { pos: this.to.pos.clone(), look: this.to.look.clone(), fov: this.to.fov };
    const k = ease(this.t);
    return {
      pos: this.from.pos.clone().lerp(this.to.pos, k),
      look: this.from.look.clone().lerp(this.to.look, k),
      fov: this.from.fov + (this.to.fov - this.from.fov) * k,
    };
  }

  private withOffset(pose: CamPose): CamPose {
    const o = this.shown;
    if (!this.pivot || (Math.abs(o.yaw) < 1e-4 && Math.abs(o.pitch) < 1e-4 && Math.abs(o.dist - 1) < 1e-4)) return pose;
    const pivot = this.pivot;
    const rel = pose.pos.clone().sub(pivot);
    const look = pose.look.clone().sub(pivot);
    rel.applyAxisAngle(Y, o.yaw);
    look.applyAxisAngle(Y, o.yaw);
    const axis = new THREE.Vector3().crossVectors(rel, Y);
    if (axis.lengthSq() > 1e-8) {
      axis.normalize();
      // Keep the camera between just above the grass and nearly overhead.
      const elev = Math.asin(THREE.MathUtils.clamp(rel.y / rel.length(), -1, 1));
      const pitch = THREE.MathUtils.clamp(o.pitch, 0.03 - elev, 1.45 - elev);
      rel.applyAxisAngle(axis, -pitch);
      look.applyAxisAngle(axis, -pitch);
    }
    rel.multiplyScalar(o.dist);
    const pos = pivot.clone().add(rel);
    // Stay inside the bowl: in front of the stands and under the roofs.
    pos.set(THREE.MathUtils.clamp(pos.x, -37, 37), THREE.MathUtils.clamp(pos.y, 0.3, 21), THREE.MathUtils.clamp(pos.z, -7.5, 64));
    return { pos, look: pivot.clone().add(look), fov: pose.fov };
  }

  update(dt: number): void {
    if (this.from && this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      if (this.t >= 1) {
        this.done?.();
        this.done = null;
      }
    }
    // The player's view glides to what they asked for (smooths finger noise and role changes).
    const k = this.snap ? 1 : 1 - Math.exp(-dt * 14);
    this.shown.yaw += (this.offset.yaw - this.shown.yaw) * k;
    this.shown.pitch += (this.offset.pitch - this.shown.pitch) * k;
    this.shown.dist += (this.offset.dist - this.shown.dist) * k;
    const pose = this.withOffset(this.base());

    // Tracking only nudges the look point; a critically damped spring keeps
    // that nudge smooth however abruptly the ball (or the weight) changes.
    const want = this.track ? this.track.clone().sub(pose.look).multiplyScalar(this.trackWeight) : new THREE.Vector3();
    if (this.snap) {
      this.shift.copy(want);
      this.shiftVel.set(0, 0, 0);
      this.snap = false;
    } else {
      const w = TRACK_OMEGA;
      for (let left = dt; left > 1e-6; left -= 1 / 240) {
        const h = Math.min(left, 1 / 240);
        const ax = w * w * (want.x - this.shift.x) - 2 * w * this.shiftVel.x;
        const ay = w * w * (want.y - this.shift.y) - 2 * w * this.shiftVel.y;
        const az = w * w * (want.z - this.shift.z) - 2 * w * this.shiftVel.z;
        this.shiftVel.x += ax * h;
        this.shiftVel.y += ay * h;
        this.shiftVel.z += az * h;
        this.shift.addScaledVector(this.shiftVel, h);
      }
    }
    this.camera.position.copy(pose.pos);
    this.camera.lookAt(pose.look.clone().add(this.shift));
    if (this.camera.fov !== pose.fov) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#060b18');
  grad.addColorStop(0.55, '#13213d');
  grad.addColorStop(1, '#2c3d5c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Vertical framing: the pitch and vertical FOV that put `top` at ndc topNdc
 * and `bottom` at ndc bottomNdc, for a camera at `pos` facing `heading`.
 */
function frameVertically(
  pos: THREE.Vector3,
  heading: THREE.Vector3,
  top: THREE.Vector3,
  bottom: THREE.Vector3,
  topNdc: number,
  bottomNdc: number,
): { pitch: number; tanHalf: number } {
  const angle = (p: THREE.Vector3) => Math.atan2(p.y - pos.y, Math.max(0.1, p.clone().sub(pos).dot(heading)));
  const at = angle(top);
  const ab = angle(bottom);
  let lo = ab + 0.01;
  let hi = at - 0.01;
  let pitch = (lo + hi) / 2;
  for (let i = 0; i < 40; i++) {
    pitch = (lo + hi) / 2;
    const tanHalf = Math.tan(ab - pitch) / bottomNdc;
    if (Math.tan(at - pitch) / tanHalf > topNdc) lo = pitch;
    else hi = pitch;
  }
  return { pitch, tanHalf: Math.tan(ab - pitch) / bottomNdc };
}

function poseFrom(pos: THREE.Vector3, heading: THREE.Vector3, pitch: number, tanHalf: number): CamPose {
  const dir = heading.clone().multiplyScalar(Math.cos(pitch)).setY(Math.sin(pitch));
  return { pos, look: pos.clone().addScaledVector(dir, 10), fov: (2 * Math.atan(tanHalf) * 180) / Math.PI };
}

/**
 * Frame `top` and `bottom` vertically, then widen if any of `sides` would fall
 * off the left or right (portrait screens are narrow), re-aiming so `bottom`
 * keeps its place. Reports whether everything fits.
 */
function fitFrame(
  pos: THREE.Vector3,
  heading: THREE.Vector3,
  top: THREE.Vector3,
  bottom: THREE.Vector3,
  topNdc: number,
  bottomNdc: number,
  sides: THREE.Vector3[],
  aspect: number,
): { pose: CamPose; fits: boolean } {
  let { pitch, tanHalf } = frameVertically(pos, heading, top, bottom, topNdc, bottomNdc);
  const right = new THREE.Vector3(-heading.z, 0, heading.x);
  const lateral = (p: THREE.Vector3) => {
    const d = p.clone().sub(pos);
    return Math.abs(d.dot(right)) / Math.max(0.1, d.dot(heading));
  };
  const needH = Math.max(...sides.map(lateral)) / 0.88;
  if (tanHalf * aspect < needH) {
    tanHalf = needH / aspect;
    const ab = Math.atan2(bottom.y - pos.y, Math.max(0.1, bottom.clone().sub(pos).dot(heading)));
    pitch = ab - Math.atan(bottomNdc * tanHalf);
  }
  const at = Math.atan2(top.y - pos.y, Math.max(0.1, top.clone().sub(pos).dot(heading)));
  const pose = poseFrom(pos, heading, pitch, tanHalf);
  return { pose, fits: Math.tan(at - pitch) / tanHalf < 0.95 && pose.fov < 80 };
}

/** The field goal view's heading: from the spot dead at the middle of the uprights. */
export function fieldGoalHeading(spot: Spot): THREE.Vector3 {
  return new THREE.Vector3(-spot.x, 0, -spot.z).normalize();
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly retro: RetroRenderer;
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
  readonly rig = new CameraRig(this.camera);
  private readonly scene = new THREE.Scene();
  private readonly sun: THREE.DirectionalLight;
  readonly stadium: Stadium;
  private readonly ball: THREE.Group;
  private readonly lastBall = new THREE.Vector3();
  private readonly ballShadow = new BlobShadows(0.6, 0.34, 0.4);
  readonly keeper = new Figure(KITS.aiKeeper, true);
  readonly kicker = new Figure(KITS.you);
  private readonly wall: Figure[] = [];
  private wallSpots: { x: number; z: number }[] = [];
  private readonly trace: THREE.Line;
  private readonly aim: THREE.Mesh;
  private aimFade = 0;
  private readonly diveMark: THREE.Mesh;
  private diveFade = 0;
  private readonly joints = emptyJoints();
  private spot: Spot | null = null;
  /** How the shooter strikes this kick (shows from contact on) */
  kickStyle: KickStyle = 'instep';
  /** Free kicks (goal, net, keeper, soccer ball) or field goals (H-posts, the football, the unit and the rush) */
  mode: 'freekick' | 'fieldgoal' = 'freekick';
  private readonly fgPosts = new FieldGoalPosts();
  private readonly football = football();
  /** The streak behind a field goal in flight */
  private readonly trail = new BallTrail();
  private readonly unit = new FieldGoalUnit(KITS.fbYou, KITS.fbAi);
  private readonly cableCam = new CableCamModel();
  private readonly refs = new RefereeCrew();
  /** The coin toss at midfield before a match */
  readonly coinToss = new CoinToss();
  /** A taunt going on (world time), and whose */
  private emoting: (EmoteState & { who: 'keeper' | 'gunner' }) | null = null;
  private readonly emoteA = emptyJoints();
  private readonly emoteB = emptyJoints();
  private cam: CableCam | null = null;
  /** Field goals: seconds from the snap to the kick, once it's known (poses the unit for a given kickT). */
  opTime = 1.3;
  /** End-over-end turn of the football in flight */
  private tumble = 0;
  private time = 0;

  constructor(container: HTMLElement) {
    // No anti-aliasing: the retro frame wants its jaggies.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.retro = new RetroRenderer(this.renderer, FLOODLIGHTS.map(([x, z]) => new THREE.Vector3(x, 41, z).lerp(new THREE.Vector3(0, 0, 25), 0.03)));
    // No filmic tone curve: saturated, punchy colours like the floodlit console games of the early 2000s.
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0x1a2a46, 70, 160);

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2f5a2f, 0.8));
    // Floodlights: a warm key from one corner, a cool fill from the other.
    const fill = new THREE.DirectionalLight(0xe8f0ff, 0.7);
    fill.position.set(-30, 35, 60);
    this.scene.add(fill);
    this.sun = new THREE.DirectionalLight(0xfff8ea, 1.9);
    this.scene.add(this.sun, this.sun.target);
    this.placeSun(new THREE.Vector3(0, 0, 12));

    this.stadium = buildStadium(this.scene, this.renderer.capabilities.getMaxAnisotropy());

    this.ball = soccerBall(BALL_RADIUS);
    this.scene.add(this.ball, this.ballShadow.group);
    this.football.visible = false;
    this.scene.add(this.football, this.trail.mesh, this.fgPosts.group, this.unit.group, this.cableCam.group, this.refs.group);

    this.scene.add(this.keeper.group, this.kicker.group, this.coinToss.group);
    for (let i = 0; i < 4; i++) {
      const f = new Figure(KITS.ai);
      f.group.visible = false;
      this.wall.push(f);
      this.scene.add(f.group);
    }

    this.trace = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85 }),
    );
    this.trace.frustumCulled = false;
    this.trace.visible = false;
    this.scene.add(this.trace);

    this.aim = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.24, 32),
      new THREE.MeshBasicMaterial({ color: 0x5ee0ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.scene.add(this.aim);
    this.diveMark = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.32, 32),
      new THREE.MeshBasicMaterial({ color: 0x8fe0ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
    );
    this.diveMark.renderOrder = 10;
    this.scene.add(this.diveMark);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private placeSun(focus: THREE.Vector3): void {
    this.sun.position.copy(focus).add(new THREE.Vector3(14, 30, 10));
    this.sun.target.position.copy(focus);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.retro.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setKits(shooter: Kit, keeper: Kit, wall: Kit): void {
    this.kicker.setKit(shooter);
    this.keeper.setKit(keeper);
    this.wall.forEach((f, i) => f.setKit(wall, [4, 5, 6, 8][i]));
  }

  /** Field goals: the kicking team (kicker, holder, line) and the team rushing it. */
  setFieldGoalTeams(offense: Kit, defense: Kit): void {
    this.kicker.setKit(offense, offense.number);
    this.unit.setTeams(offense, defense);
  }

  /** Switch between the free-kick goal and field goal posts (and the ball that goes with each). */
  setMode(mode: 'freekick' | 'fieldgoal'): void {
    this.mode = mode;
    const fg = mode === 'fieldgoal';
    this.stadium.setSoccerGoal(!fg);
    this.fgPosts.group.visible = fg;
    this.ball.visible = !fg;
    this.football.visible = fg;
    this.trail.clear();
    this.unit.group.visible = fg;
    this.refs.group.visible = fg;
    if (!fg) this.setCableCam(null);
    this.keeper.group.visible = !fg;
    this.kicker.setGear(fg ? 'football' : 'soccer');
    this.stadium.setTheme(fg ? 'football' : 'soccer');
  }

  /**
   * The coin toss: the captains, kickers and referee at midfield, everyone
   * else off (so nothing from the kicking end wanders into shot); off again,
   * the current mode's scene comes back.
   */
  showCoinToss(on: boolean): void {
    this.coinToss.group.visible = on;
    if (!on) {
      this.kicker.group.visible = true;
      this.setMode(this.mode);
      return;
    }
    for (const o of [this.kicker.group, this.keeper.group, this.unit.group, this.refs.group, this.ball, this.football, this.cableCam.group]) o.visible = false;
    this.setWall([]);
    this.trail.clear();
    this.showAim(null);
  }

  /** Field goals: the round's cable cam over the field, or none. */
  setCableCam(cam: CableCam | null): void {
    this.cam = cam;
    this.cableCam.set(cam);
  }

  /** Put the cable cam where it is `t` seconds into the round. */
  poseCableCam(t: number): void {
    this.cableCam.pose(t, this.time);
  }

  /** Field goals: the officials' call, once the kick's simulated (null: nothing to call yet). */
  setRefCall(call: RefCall | null): void {
    this.refs.call = call;
  }

  /** Start a taunt: the keeper's, or the field goal rush's right-hand gunner's. */
  emote(who: 'keeper' | 'gunner', kind: Emote): void {
    // Tapping again mid-taunt cuts straight into the new one.
    const cur = this.emoting;
    const live = !!cur && cur.who === who && this.time - cur.at < EMOTE_TIME;
    this.emoting = { who, kind, at: this.time, chainStart: live ? cur!.chainStart : this.time, prev: live ? { kind: cur!.kind, at: cur!.at } : null };
  }

  /** A taunt still playing (the kick waits for it). */
  get emoteBusy(): boolean {
    return !!this.emoting && this.time - this.emoting.at < EMOTE_TIME;
  }

  /** The round's wind: the ribbons on the uprights and the corner flags show it. */
  setWind(w: Vec3): void {
    this.fgPosts.setWind(w);
    this.stadium.setWind(w);
  }

  setSpot(spot: Spot): void {
    this.spot = spot;
    this.unit.setSpot(spot);
    this.tumble = 0;
    this.kickStyle = 'instep';
    this.placeSun(new THREE.Vector3(spot.x / 2, 0, spot.z / 2));
    this.setWall([]);
    this.setRefCall(null);
    this.emoting = null;
    this.setTrace(null);
    this.showAim(null);
    this.showDive(null);
  }

  setWall(players: { x: number; z: number }[]): void {
    this.wallSpots = players;
    this.wall.forEach((f, i) => (f.group.visible = i < players.length));
  }

  setTrace(ball: Float64Array | null): void {
    this.trace.visible = !!ball;
    if (!ball) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(ball), 3));
    this.trace.geometry.dispose();
    this.trace.geometry = geo;
  }

  /** Marker where the shooter aimed (on the goal plane); fades out over a few seconds. */
  showAim(p: { x: number; y: number } | null): void {
    this.aimFade = p ? 4 : 0;
    if (p) this.aim.position.set(p.x, p.y, 0.05);
  }

  /**
   * Pose everything for one rendered moment. `kickT` is seconds relative to
   * contact; for field goals `tau` is seconds since the snap (by default from
   * the known operation time).
   */
  pose(ball: Vec3, keeperParts: KeeperPart[] | null, wallY: number, kickT: number, tau = this.opTime + kickT): void {
    const spot = this.spot;
    if (!spot) return;
    const b = new THREE.Vector3(ball.x, ball.y, ball.z);
    const step = b.clone().sub(this.lastBall);
    const dist = step.length();
    if (dist > 1e-5 && dist < 2) {
      const axis = new THREE.Vector3().crossVectors(Y, step).normalize();
      this.ball.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / BALL_RADIUS));
    }
    this.lastBall.copy(b);
    this.ball.position.copy(b);
    this.ballShadow.place(b.x, b.z, b.y - BALL_RADIUS);
    if (this.mode === 'freekick') this.stadium.pressNet(b.x, b.y, b.z);
    if (this.mode === 'fieldgoal') {
      this.poseFootball(b, step, dist, spot, kickT, tau);
      const em = this.emoting?.who === 'gunner' && tau < 0 ? this.emoting : null;
      this.unit.pose(tau, kickT, this.time, em);
      this.refs.pose(kickT, this.time, b);
    }

    if (keeperParts) {
      const j = keeperJoints(keeperParts, this.joints);
      // A taunt on the line, before the run-up.
      const em = this.emoting?.who === 'keeper' ? this.emoting : null;
      if (em) {
        const base = j.pelvis.clone().setY(0);
        const facing = new THREE.Vector3(spot.x - base.x, 0, spot.z - base.z);
        // (It fades out over the first moment of the run-up if the shooter goes mid-taunt.)
        poseEmote(j, em, this.time, base, facing, this.emoteA, this.emoteB, THREE.MathUtils.clamp((-0.9 - kickT) / 0.3, 0, 1));
      }
      this.keeper.setPose(j);
    }

    const spotV = new THREE.Vector3(spot.x, 0, spot.z);
    const goalward = new THREE.Vector3(-spot.x, 0, -spot.z).normalize();
    const fg = this.mode === 'fieldgoal';
    const kicker = fg ? fieldGoalKickerJoints(kickT, spotV, goalward, this.joints) : kickerJoints(kickT, spotV, goalward, this.joints, this.kickStyle);
    // Waiting to go: breathing, settling, until the approach starts.
    this.kicker.setPose(breathe(kicker, this.time, 3, THREE.MathUtils.clamp(((fg ? FG_APPROACH_START : -1.15) - kickT) / 0.3, 0, 1)));

    this.wallSpots.forEach((w, i) => {
      const facing = new THREE.Vector3(spot.x - w.x, 0, spot.z - w.z);
      this.wall[i].setPose(breathe(wallJoints(w.x, w.z, facing, wallY, this.joints), this.time, 40 + i * 3, THREE.MathUtils.clamp((-0.4 - kickT) / 0.3, 0, 1)));
    });
  }

  /**
   * Before the kick: spiralling back on the snap, then stood on its tip under
   * the holder's finger, tipped a little back; after it, tumbling end over end.
   */
  private poseFootball(b: THREE.Vector3, step: THREE.Vector3, dist: number, spot: Spot, kickT: number, tau: number): void {
    const f = this.football;
    const goalward = new THREE.Vector3(-spot.x, 0, -spot.z).normalize();
    f.position.copy(b);
    // Drawn bigger the further it gets from the camera (never under ~10 rows of
    // the retro frame), and streaked, so a long kick stays easy to follow.
    const big = Math.max(1, b.distanceTo(this.camera.position) / 13);
    f.scale.set(0.085 * big, 0.14 * big, 0.085 * big);
    this.trail.width = 0.11 * big;
    let axis: THREE.Vector3;
    if (kickT <= 0) {
      this.trail.clear();
      this.tumble = 0;
      axis = snapBallAxis(spot, tau) ?? new THREE.Vector3(0, 1, 0).addScaledVector(goalward, -0.12);
      // The spiral on the snap.
      f.rotation.set(0, 0, 0);
    } else {
      const heading = dist > 1e-5 ? step.clone().setY(0).normalize() : goalward;
      if (heading.lengthSq() < 0.5) heading.copy(goalward);
      if (dist < 2) this.tumble += dist * 2.6;
      axis = new THREE.Vector3(0, 1, 0).multiplyScalar(Math.cos(this.tumble)).addScaledVector(heading, Math.sin(this.tumble));
      f.position.y = Math.max(b.y, 0.09);
      if (b.y > 0.2) this.trail.push(f.position, this.time);
    }
    f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    if (kickT <= 0 && tau > 0 && tau < 0.4) f.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tau * 60));
  }

  // ── Camera poses ────────────────────────────────────────────────────────
  // Each one is framed by solving for pitch and FOV, so the ball and the goal
  // are always on screen whatever the spot and screen shape (SPEC §5).

  /** Behind the ball: crossbar in the upper third, ball near the bottom, both posts in view. */
  shooterCam(spot: Spot): CamPose {
    const aspect = this.camera.aspect;
    const fg = this.mode === 'fieldgoal';
    const away = fg ? fieldGoalHeading(spot).negate() : new THREE.Vector3(spot.x, 0, spot.z).normalize();
    const right = new THREE.Vector3(away.z, 0, -away.x);
    const ball = new THREE.Vector3(spot.x, 0, spot.z);
    // Field goals frame the uprights well above the bar; free kicks the goal.
    const goalTop = fg ? new THREE.Vector3(0, FG_BAR_Y + 6, 0) : new THREE.Vector3(0, GOAL_HEIGHT + 0.5, 0);
    // And the cable cam, if it's up.
    const camTop = fg && this.cam ? new THREE.Vector3(this.cam.x, this.cam.y + 1.2, this.cam.z) : null;
    const half = fg ? FG_HALF_WIDTH + 1 : GOAL_HALF_WIDTH + 0.5;
    const posts = [new THREE.Vector3(-half, 1, 0), new THREE.Vector3(half, 1, 0)];
    // Field goals: both gunners on the edges of the line, in full (they taunt).
    const gunners = fg
      ? [-1, 1].map((side) => {
          const p = kickFrame(spot, side * 4.8, LOS_DISTANCE + 0.55);
          return new THREE.Vector3(p.x, 0.5, p.z);
        })
      : [];
    let back = fg ? Math.min(9.5, 64 - spot.distance) : 4 + Math.max(0, 18 - spot.distance) * 0.25;
    let framed = null as { pose: CamPose; fits: boolean } | null;
    for (let i = 0; i < 10; i++) {
      // Raised to see over the wall; nudged right so the run-up (from the left) doesn't hide the ball.
      // Field goals: further back, dead in line with the middle of the uprights.
      const pos = ball.clone().addScaledVector(away, back).addScaledVector(right, fg ? 0 : 0.6).setY((fg ? 3.4 : 2.2) + i * 0.25);
      const heading = fg ? away.clone().negate() : new THREE.Vector3(-pos.x, 0, -pos.z).normalize();
      const rise = (p: THREE.Vector3) => (p.y - pos.y) / Math.max(0.1, p.clone().sub(pos).dot(heading));
      const top = camTop && rise(camTop) > rise(goalTop) ? camTop : goalTop;
      framed = fitFrame(pos, heading, top, ball, top === camTop ? 0.62 : 0.5, -0.72, [...posts, ball, ...gunners], aspect);
      if (framed.fits) break;
      back += 1.5;
    }
    return framed!.pose;
  }

  /** Behind the net, over the keeper's shoulder: keeper at the bottom, ball and wall in view. */
  /**
   * The keeper's view: high at the front of the stand behind the goal, on the
   * line from the ball through the keeper. A portrait screen is tall, so it
   * holds the whole kick: the shooter at the top, the flight down the middle,
   * the keeper and the full width of the goal across the bottom. Never inside
   * the stand (no crowd clipping), never behind the net.
   */
  keeperCam(spot: Spot): CamPose {
    const keeper = new THREE.Vector3(spot.keeperX, 0, KEEPER_Z);
    const ball = new THREE.Vector3(spot.x, 0.11, spot.z);
    const toBall = ball.clone().sub(keeper).setY(0).normalize();
    const pos = keeper.clone().addScaledVector(toBall, -KEEPER_CAM_BACK).setY(KEEPER_CAM_HEIGHT);
    pos.z = Math.max(pos.z, KEEPER_CAM_MIN_Z);
    pos.x = THREE.MathUtils.clamp(pos.x, -6, 6);
    const heading = ball.clone().sub(pos).setY(0).normalize();
    const posts = [new THREE.Vector3(-GOAL_HALF_WIDTH, 1.2, 0), new THREE.Vector3(GOAL_HALF_WIDTH, 1.2, 0)];
    // Shooter (and the ball's rise) near the top; the keeper's feet low on the screen.
    return fitFrame(pos, heading, ball.clone().setY(2.2), keeper, 0.62, -0.6, [...posts, ball], this.camera.aspect).pose;
  }

  /** Where a keeper flick sends the hands, shown on the keeper's plane. */
  showDive(p: { x: number; y: number } | null): void {
    this.diveFade = p ? 1.6 : 0;
    if (p) this.diveMark.position.set(p.x, p.y, KEEPER_Z + 0.02);
  }

  /**
   * Where the chase after the strike ends: up the pitch along the ball's line,
   * further for longer shots (a 35 m free kick is followed to ~16 m out; a
   * penalty only steps up past the ball), framing the whole goal.
   */
  chaseEnd(spot: Spot): CamPose {
    const d = spot.distance;
    const away = new THREE.Vector3(spot.x, 0, spot.z).normalize();
    const advance = Math.min(d - 9, Math.max(d * 0.25, d - 16));
    const pos = new THREE.Vector3(spot.x, 3.0, spot.z).addScaledVector(away, -advance);
    const heading = new THREE.Vector3(-pos.x, 0, -pos.z).normalize();
    const fg = this.mode === 'fieldgoal';
    const half = fg ? FG_HALF_WIDTH + 1.2 : GOAL_HALF_WIDTH + 0.6;
    const posts = [new THREE.Vector3(-half, 1, 0), new THREE.Vector3(half, 1, 0)];
    const top = new THREE.Vector3(0, fg ? FG_BAR_Y + 8 : GOAL_HEIGHT + 0.8, 0);
    return fitFrame(pos, heading, top, new THREE.Vector3(0, 0, 0), 0.55, -0.4, posts, this.camera.aspect).pose;
  }

  /** Reverse angle from behind and above the goal: fits a portrait screen. */
  replayCam(spot: Spot): CamPose {
    const side = spot.x >= 0 ? -1 : 1;
    if (this.mode === 'fieldgoal') {
      // High behind the end line, off to one side of the upright: the rush and the whole flight.
      return {
        pos: new THREE.Vector3(side * 8, 8, -7.4),
        look: new THREE.Vector3(spot.x * 0.6, 1.5, spot.z * 0.55),
        fov: this.camera.aspect < 1 ? 58 : 42,
      };
    }
    return {
      pos: new THREE.Vector3(spot.x * 0.2 + side * 2.5, 4.6, -9.5),
      look: new THREE.Vector3(spot.x * 0.35, 0.9, spot.z * 0.42),
      fov: this.camera.aspect < 1 ? 62 : 45,
    };
  }

  /** Sudden death's opening shot: low behind the goal (or the posts), looking out at the field. */
  suddenDeathCam(): CamPose {
    const fg = this.mode === 'fieldgoal';
    return { pos: new THREE.Vector3(0, 1.1, -6.6), look: new THREE.Vector3(0, fg ? 4 : 1.6, 20), fov: 58 };
  }

  aerialCam(spot: Spot): CamPose {
    const mid = new THREE.Vector3(spot.x * 0.5, 0, spot.z * 0.5);
    return { pos: mid.clone().add(new THREE.Vector3(spot.x * 0.4 + 6, 30, spot.z * 0.6 + 14)), look: mid, fov: 50 };
  }

  menuCam(t: number): CamPose {
    const a = t * 0.05;
    return {
      // A slow broadcast sweep round the box, low enough to stay under the roofs.
      pos: new THREE.Vector3(Math.sin(a) * 16, 3.6 + 0.8 * Math.sin(t * 0.13), 17 + Math.cos(a) * 7),
      look: new THREE.Vector3(Math.sin(a) * 3, 2.2, 0),
      fov: 55,
    };
  }

  update(dt: number): void {
    this.time += dt;
    this.fgPosts.update(this.time);
    this.stadium.flutter(this.time);
    this.trail.update(this.camera, this.time);
    this.rig.update(dt);
    this.stadium.update(dt);
    if (this.aimFade > 0) {
      this.aimFade = Math.max(0, this.aimFade - dt);
      (this.aim.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, this.aimFade);
    }
    this.aim.visible = this.aimFade > 0;
    if (this.diveFade > 0) {
      this.diveFade = Math.max(0, this.diveFade - dt);
      (this.diveMark.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, this.diveFade * 1.5);
    }
    this.diveMark.visible = this.diveFade > 0;
  }

  render(): void {
    this.retro.render(this.scene, this.camera);
  }
}
