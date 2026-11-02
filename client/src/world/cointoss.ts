// The coin toss before a match, at the centre spot (or on the 50): the
// referee between the two captains, each with his kicker at his shoulder.
// The captains shake hands; the referee shows the coin and, on the call,
// flips it high off his thumb; it tumbles, lands on the grass, bobbles and
// settles; he points to the captain who won it, and that side celebrates
// while the other shrugs it off. The camera comes down from high to stand
// with them, follows the coin up, drops in to see how it landed and pulls
// back out for the reaction.

import * as THREE from 'three';
import { bodyPose, breathe, emptyJoints, Figure, KITS, type Gear, type Kit } from './figure';

export type CoinSide = 'heads' | 'tails';
export type Team = 'you' | 'ai';

/** The handshake (s into the toss), and when the referee has the coin out to show. */
const SHAKE_FROM = 0.5;
const SHAKE_TO = 1.5;
const SHOW_AT = 1.6;
/** The flip: up off his thumb at this speed (m/s), and how long it's in the air. */
const FLIP_UP = 4.6;
const RELEASE_Y = 1.36;
export const COIN_FLIGHT = (FLIP_UP + Math.sqrt(FLIP_UP * FLIP_UP + 2 * 9.81 * (RELEASE_Y - 0.006))) / 9.81;
/** After it lands: the referee points, and the winners celebrate. */
const POINT_AT = 0.55;
const CELEBRATE_AT = 0.75;
/** Bigger than any real coin, so it reads from the camera. */
const COIN_R = 0.1;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** A face of the coin: heads (a profile, in relief) or tails (a star), in a beaded rim. */
function coinFace(side: CoinSide): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(50, 44, 8, 64, 64, 64);
  grad.addColorStop(0, '#fff3b0');
  grad.addColorStop(0.6, '#e8b830');
  grad.addColorStop(1, '#a8781a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#8a6010';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#9a6c12';
  if (side === 'heads') {
    // A head in profile, facing left, over the shoulders.
    g.beginPath();
    g.ellipse(66, 52, 20, 24, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(46, 54);
    g.lineTo(38, 62);
    g.lineTo(47, 64);
    g.fill();
    g.fillRect(56, 70, 20, 14);
    g.beginPath();
    g.ellipse(66, 98, 32, 16, 0, Math.PI, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? 18 : 42;
      g.lineTo(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Where everyone stands, around the referee at (0, z0) facing +x (the camera's side). */
const PLACES: Record<Team, { captain: THREE.Vector3; kicker: THREE.Vector3 }> = {
  you: { captain: new THREE.Vector3(0.2, 0, 0.95), kicker: new THREE.Vector3(-0.35, 0, 1.5) },
  ai: { captain: new THREE.Vector3(0.2, 0, -0.95), kicker: new THREE.Vector3(-0.35, 0, -1.5) },
};

export interface TossCam {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

export class CoinToss {
  readonly group = new THREE.Group();
  private readonly ref = new Figure(KITS.refA);
  private readonly captains: Record<Team, Figure> = { you: new Figure(KITS.you), ai: new Figure(KITS.ai) };
  private readonly kickers: Record<Team, Figure> = { you: new Figure(KITS.you), ai: new Figure(KITS.ai) };
  private readonly coin: THREE.Mesh;
  /** A glint off the coin each time it turns its face to the floodlights */
  private readonly glint: THREE.Sprite;
  private readonly joints = emptyJoints();
  private z0 = 52.5;
  private flipAt: number | null = null;
  private side: CoinSide = 'heads';
  private winner: Team = 'you';

  constructor() {
    for (const f of [this.ref, this.captains.you, this.captains.ai, this.kickers.you, this.kickers.ai]) this.group.add(f.group);
    const gold = new THREE.MeshPhongMaterial({ color: 0xe0b030, emissive: 0x4a3008, specular: 0xfff0a0, shininess: 80 });
    const face = (side: CoinSide) => new THREE.MeshPhongMaterial({ map: coinFace(side), emissive: 0x4a3008, specular: 0xfff0a0, shininess: 80 });
    // Cylinder groups: the edge, then the top (heads) and the bottom (tails).
    this.coin = new THREE.Mesh(new THREE.CylinderGeometry(COIN_R, COIN_R, 0.012, 24), [gold, face('heads'), face('tails')]);
    this.group.add(this.coin);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,250,220,1)');
    grad.addColorStop(0.25, 'rgba(255,220,120,0.6)');
    grad.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glint = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    this.glint.scale.setScalar(0.5);
    this.group.add(this.glint);
    this.group.visible = false;
  }

  /**
   * Dress it for the game: soccer (the referee in yellow) or football (the
   * striped shirt and cap, the players in helmets), at the halfway line z0.
   */
  setup(gear: 'soccer' | 'football', you: Kit, ai: Kit, z0: number): void {
    this.z0 = z0;
    this.flipAt = null;
    this.winner = 'you';
    const fb = gear === 'football';
    this.ref.setKit(fb ? KITS.refA : KITS.soccerRef);
    this.ref.setGear(fb ? 'referee' : 'soccer');
    const players: [Figure, Kit, number][] = [
      [this.captains.you, you, fb ? 54 : 4],
      [this.kickers.you, you, you.number],
      [this.captains.ai, ai, fb ? 12 : 5],
      [this.kickers.ai, ai, ai.number],
    ];
    for (const [f, kit, num] of players) {
      f.setKit(kit, num);
      f.setGear(gear as Gear);
    }
  }

  /** The call's made: flip it now (`at`, s into the toss); it lands `side` up, and `winner` has won it. */
  flip(side: CoinSide, winner: Team, at: number): void {
    this.side = side;
    this.winner = winner;
    this.flipAt = at;
  }

  /** The coin at `t` s into the toss: in the referee's hand, in the air (turning over and over), or on the grass. */
  private coinAt(t: number, hand: THREE.Vector3): { pos: THREE.Vector3; turn: number; tilt: number } {
    const s = this.flipAt === null ? -1 : t - this.flipAt;
    // In his palm, tipped to show the camera (a turn about z tips the top face toward +x).
    if (s < 0) return { pos: hand.clone().add(new THREE.Vector3(0.03, 0.02, 0)), turn: -0.5, tilt: 0 };
    const end = this.side === 'heads' ? 0 : Math.PI;
    if (s < COIN_FLIGHT) {
      const k = s / COIN_FLIGHT;
      const pos = new THREE.Vector3(0.36 + 0.3 * k, RELEASE_Y + FLIP_UP * s - 4.905 * s * s, this.z0 + 0.2 - 0.2 * k);
      return { pos, turn: -0.5 * (1 - k) + (Math.PI * 2 * 9 + end) * k, tilt: 0 };
    }
    // Down: a couple of little bounces, and it rattles flat.
    const after = s - COIN_FLIGHT;
    const bounce = Math.abs(Math.sin(after * 18)) * 0.07 * Math.exp(-after * 9);
    const wobble = 0.35 * Math.exp(-after * 5) * Math.sin(after * 30);
    return { pos: new THREE.Vector3(0.66, 0.006 + bounce, this.z0), turn: end, tilt: wobble };
  }

  /** Everyone, `t` seconds into the toss. */
  pose(t: number): void {
    const z0 = this.z0;
    const j = this.joints;
    const UP = new THREE.Vector3(0, 1, 0);
    const s = this.flipAt === null ? -Infinity : t - this.flipAt;
    const landed = s - COIN_FLIGHT;

    // The referee, facing the camera's side.
    {
      const f = new THREE.Vector3(1, 0, 0);
      const r = new THREE.Vector3(0, 0, 1);
      const base = new THREE.Vector3(0, 0, z0);
      const pelvis = base.clone().setY(0.94);
      // Leaning in to watch it land.
      const look = smooth(0.4, 0.9, s) * (1 - smooth(0.2, 0.6, landed));
      const chest = f.clone().multiplyScalar(0.05 + 0.1 * look).setY(0.5);
      const sh = pelvis.clone().add(chest);
      const side = (k: number) => pelvis.clone().addScaledVector(r, k * 0.24).addScaledVector(f, 0.04).setY(0.42);
      // Right hand: out, palm up with the coin; the flick (up off the thumb); back down.
      const show = sh.clone().addScaledVector(f, 0.34).addScaledVector(r, 0.2).setY(RELEASE_Y - 0.03);
      const flick = show.clone().add(new THREE.Vector3(0.05, 0.28, 0));
      let hr = side(1).lerp(show, smooth(SHOW_AT - 0.4, SHOW_AT, t));
      if (s > -0.15) hr = show.clone().lerp(flick, smooth(-0.15, 0, s)).lerp(side(1), smooth(0.25, 0.8, s));
      let hl = side(-1);
      // Then the point: the arm out at the winning captain.
      const point = smooth(POINT_AT, POINT_AT + 0.2, landed);
      if (point > 0) {
        const at = PLACES[this.winner].captain.clone().setZ(z0 + PLACES[this.winner].captain.z);
        const arm = at.clone().sub(sh).setY(0).normalize();
        const out = sh.clone().addScaledVector(arm, 0.6).setY(sh.y + 0.05);
        if (this.winner === 'you') hr = hr.lerp(out, point);
        else hl = hl.lerp(out, point);
      }
      bodyPose(j, pelvis, f, chest, base.clone().addScaledVector(r, -0.14).setY(0.09), base.clone().addScaledVector(r, 0.14).setY(0.09), hl, hr);
      breathe(j, t, 70);
      this.ref.setPose(j);
      const c = this.coinAt(t, j.handR);
      this.coin.position.copy(c.pos);
      this.coin.rotation.set(c.tilt, 0, c.turn, 'XZY');
      // Flashing as it turns over in the air.
      const flying = this.flipAt !== null && s > 0 && s < COIN_FLIGHT;
      this.glint.position.copy(c.pos);
      this.glint.material.opacity = flying ? Math.pow(Math.abs(Math.cos(c.turn - 0.6)), 6) : 0;
    }

    // The captains and their kickers, turned in to the referee.
    for (const team of ['you', 'ai'] as Team[]) {
      const sign = team === 'you' ? 1 : -1;
      const won = this.winner === team;
      const party = smooth(CELEBRATE_AT, CELEBRATE_AT + 0.25, landed);
      for (const who of ['captain', 'kicker'] as const) {
        const fig = who === 'captain' ? this.captains[team] : this.kickers[team];
        const place = PLACES[team][who];
        const seed = (team === 'you' ? 10 : 20) + (who === 'captain' ? 0 : 5);
        // The captains step in for the handshake, then back.
        const step = who === 'captain' ? smooth(SHAKE_FROM - 0.3, SHAKE_FROM, t) * (1 - smooth(SHAKE_TO, SHAKE_TO + 0.35, t)) : 0;
        const base = new THREE.Vector3(place.x + 0.05 * step, 0, z0 + place.z - sign * 0.3 * step);
        const toRef = new THREE.Vector3(0.9, 0, z0).sub(base).setY(0).normalize();
        const f = toRef.clone().add(new THREE.Vector3(0.45, 0, 0)).normalize();
        const r = new THREE.Vector3(-f.z, 0, f.x);
        // A bounce in the step when they've won it.
        const hop = won && party > 0 ? party * Math.max(0, Math.sin((landed - CELEBRATE_AT) * 9)) * 0.12 : 0;
        const pelvis = base.clone().setY(0.94 + hop);
        const slump = won ? 0 : party;
        const chest = f.clone().multiplyScalar(0.03 + 0.06 * slump).setY(0.5 - 0.03 * slump);
        const sh = pelvis.clone().add(chest);
        const shL = sh.clone().addScaledVector(r, -0.2);
        const shR = sh.clone().addScaledVector(r, 0.2);
        let hl = shL.clone().addScaledVector(f, 0.05).setY(sh.y - 0.58);
        let hr = shR.clone().addScaledVector(f, 0.05).setY(sh.y - 0.58);
        // Kickers stand with their hands behind their backs; captains with them loose.
        if (who === 'kicker') {
          hl = pelvis.clone().addScaledVector(f, -0.16).addScaledVector(r, -0.06).setY(0.92);
          hr = pelvis.clone().addScaledVector(f, -0.16).addScaledVector(r, 0.06).setY(0.92);
        }
        if (who === 'captain' && step > 0) {
          // Right hands meet in front of the referee, pumping.
          const meet = new THREE.Vector3(0.42, 1.0 + 0.04 * Math.sin(t * 14), z0 + sign * 0.05);
          hr = hr.lerp(meet, smooth(SHAKE_FROM, SHAKE_FROM + 0.25, t) * (1 - smooth(SHAKE_TO - 0.15, SHAKE_TO, t)));
        }
        if (party > 0) {
          if (won && who === 'captain') {
            // Fist pumped, the other arm out.
            const pump = 0.12 * Math.sin((landed - CELEBRATE_AT) * 11);
            hr = hr.lerp(shR.clone().addScaledVector(r, 0.05).setY(sh.y + 0.5 + pump), party);
            hl = hl.lerp(shL.clone().addScaledVector(r, -0.25).setY(sh.y - 0.15), party);
          } else if (won) {
            // Clapping.
            const clap = 0.07 + 0.07 * Math.abs(Math.sin((landed - CELEBRATE_AT) * 10));
            const mid = sh.clone().addScaledVector(f, 0.32).setY(sh.y - 0.12);
            hl = hl.lerp(mid.clone().addScaledVector(r, -clap), party);
            hr = hr.lerp(mid.clone().addScaledVector(r, clap), party);
          } else {
            // Hands on hips.
            hl = hl.lerp(pelvis.clone().addScaledVector(r, -0.27).addScaledVector(f, 0.02).setY(pelvis.y + 0.08), party);
            hr = hr.lerp(pelvis.clone().addScaledVector(r, 0.27).addScaledVector(f, 0.02).setY(pelvis.y + 0.08), party);
          }
        }
        const foot = (k: number) => base.clone().addScaledVector(r, k * 0.15).setY(0.09 + hop);
        bodyPose(j, pelvis, f, chest, foot(-1), foot(1), hl, hr, f.clone().add(UP.clone().multiplyScalar(0.1)));
        breathe(j, t, seed);
        fig.setPose(j);
      }
    }
  }

  /**
   * The camera at `t` s into the toss: down from high to stand with them; up
   * with the coin; in close to see how it landed; back out for the reaction.
   */
  cam(t: number, aspect: number): TossCam {
    const z0 = this.z0;
    // Wide enough for all five across a portrait screen.
    const dist = Math.max(5.2, 2.0 / Math.max(0.3, aspect) / 0.75);
    const near = new THREE.Vector3(dist, 1.45, z0 + 0.2);
    const far = new THREE.Vector3(dist * 2.4, 5.5, z0 + 6);
    const intro = smooth(0, 1.8, t);
    const pos = far.clone().lerp(near, intro);
    const look = new THREE.Vector3(0, 1.1, z0);
    let fov = (2 * Math.atan(Math.max(1.35 / dist, 2.0 / dist / aspect)) * 180) / Math.PI;
    const s = this.flipAt === null ? -1 : t - this.flipAt;
    if (s > 0) {
      // Following it up and back down.
      const c = this.coin.position;
      const follow = smooth(0, 0.25, s) * (1 - smooth(COIN_FLIGHT - 0.2, COIN_FLIGHT, s));
      look.y += (Math.min(c.y, 2.6) - 1.1) * 0.75 * follow;
      // Then in low over it, and back out.
      const landed = s - COIN_FLIGHT;
      const close = smooth(-0.05, 0.25, landed) * (1 - smooth(POINT_AT - 0.1, POINT_AT + 0.3, landed));
      if (close > 0) {
        const coinPos = new THREE.Vector3(0.66, 0, z0);
        pos.lerp(coinPos.clone().add(new THREE.Vector3(0.45, 0.85, 0.12)), close);
        look.lerp(coinPos, close);
        fov += (38 - fov) * close;
      }
    }
    return { pos, look, fov };
  }
}
