// Player figures in an early-2000s console style: low-poly bodies with kit
// textures (collar, crest, shirt number), a little Phong sheen, posed from
// joint positions. The keeper is posed directly from the sim's hitbox each
// frame (procedural dive): what you see is exactly what the ball collides with.

import * as THREE from 'three';
import type { KeeperPart, KickStyle } from '@fk/shared';
import { BlobShadows } from './shadows';

export interface Kit {
  shirt: number;
  /** Collar, cuffs, numbers and sock bands */
  trim: number;
  shorts: number;
  socks: number;
  skin: number;
  hair: number;
  /** Bare hands, or the keeper's gloves */
  hands: number;
  boots: number;
  number: number;
  /** American football: the helmet shell (defaults to the shirt colour) */
  helmet?: number;
  /** An official's shirt: black and white stripes, no number */
  stripes?: boolean;
}

/**
 * Soccer kit; American football gear (helmet and facemask, shoulder pads,
 * pants to the knee); or an official's (pants to the knee, a cap, no helmet).
 */
export type Gear = 'soccer' | 'football' | 'referee';

export const KITS = {
  you: { shirt: 0x1f4fbf, trim: 0xffffff, shorts: 0xffffff, socks: 0x1f4fbf, skin: 0xd9a77c, hair: 0x2b1d12, hands: 0xd9a77c, boots: 0x111111, number: 10 },
  ai: { shirt: 0xc8262c, trim: 0xffffff, shorts: 0x15151a, socks: 0xc8262c, skin: 0xa8734f, hair: 0x120d09, hands: 0xa8734f, boots: 0x15151a, number: 4 },
  youKeeper: { shirt: 0x7ed321, trim: 0x10300a, shorts: 0x10300a, socks: 0x7ed321, skin: 0xd9a77c, hair: 0x3a2414, hands: 0xf2f2f2, boots: 0x111111, number: 1 },
  aiKeeper: { shirt: 0xf08a1c, trim: 0x2a1505, shorts: 0x2a1505, socks: 0xf08a1c, skin: 0xa8734f, hair: 0x120d09, hands: 0xf2f2f2, boots: 0x111111, number: 1 },
  // Field goal units: jersey, numbers, pants, socks, helmet.
  fbYou: { shirt: 0x1f4fbf, trim: 0xffffff, shorts: 0xd8d2bf, socks: 0x1f4fbf, skin: 0xd9a77c, hair: 0x2b1d12, hands: 0xf2f2f2, boots: 0x111111, number: 3, helmet: 0x173b8f },
  fbAi: { shirt: 0xc8262c, trim: 0xffffff, shorts: 0xf2f2f2, socks: 0xc8262c, skin: 0xa8734f, hair: 0x120d09, hands: 0x222222, boots: 0x111111, number: 7, helmet: 0xb01e24 },
  // The officials under the posts: stripes, black pants, white cap (the hair, coloured).
  refA: { shirt: 0xf4f4f4, trim: 0x111111, shorts: 0x15151a, socks: 0x15151a, skin: 0xd9a77c, hair: 0xf4f4f4, hands: 0xd9a77c, boots: 0x111111, number: 0, stripes: true },
  refB: { shirt: 0xf4f4f4, trim: 0x111111, shorts: 0x15151a, socks: 0x15151a, skin: 0x8d5a3b, hair: 0xf4f4f4, hands: 0x8d5a3b, boots: 0x111111, number: 0, stripes: true },
  // The soccer referee (the coin toss): all in black (so the gold coin shows up against him), no number.
  soccerRef: { shirt: 0x18181c, trim: 0xe8e8e8, shorts: 0x111111, socks: 0x111111, skin: 0xc68e66, hair: 0x2a1c12, hands: 0xc68e66, boots: 0x111111, number: 0 },
} satisfies Record<string, Kit>;

const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export interface Joints {
  pelvis: THREE.Vector3;
  chest: THREE.Vector3;
  head: THREE.Vector3;
  shoulderL: THREE.Vector3;
  shoulderR: THREE.Vector3;
  elbowL: THREE.Vector3;
  elbowR: THREE.Vector3;
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  hipL: THREE.Vector3;
  hipR: THREE.Vector3;
  kneeL: THREE.Vector3;
  kneeR: THREE.Vector3;
  ankleL: THREE.Vector3;
  ankleR: THREE.Vector3;
  /** Direction the toes point */
  forward: THREE.Vector3;
}

export function emptyJoints(): Joints {
  return {
    pelvis: V(), chest: V(), head: V(), shoulderL: V(), shoulderR: V(), elbowL: V(), elbowR: V(),
    handL: V(), handR: V(), hipL: V(), hipR: V(), kneeL: V(), kneeR: V(), ankleL: V(), ankleR: V(),
    forward: new THREE.Vector3(0, 0, 1),
  };
}

const UPPER_ARM = 0.31;
const FOREARM = 0.3;
const THIGH = 0.44;
const SHIN = 0.44;

/** Two-bone IK: the middle joint for root → end, bending toward `pole`. Stretches if out of reach. */
export function solveMid(root: THREE.Vector3, end: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const dir = end.clone().sub(root);
  const d = dir.length();
  if (d < 1e-6) return out.copy(root);
  dir.divideScalar(d);
  const stretch = Math.max(1, d / (l1 + l2));
  const a1 = l1 * stretch;
  const a2 = l2 * stretch;
  const a = (a1 * a1 - a2 * a2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a1 * a1 - a * a));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1).addScaledVector(dir, -dir.z);
  p.normalize();
  return out.copy(root).addScaledVector(dir, a).addScaledVector(p, h);
}

// ── Geometry and textures ──────────────────────────────────────────────────

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * A rounded body section, unit height (y from −0.5 to 0.5) and unit radius,
 * whose radius follows `profile` from bottom (0) to top (1). Scaled per
 * instance into an ellipse (wide across the shoulders, thin front to back).
 * thetaStart π/2 puts the seam on the left side: the front (+z) is at u = 0.75
 * and the back at u = 0.25 of a wrapped texture.
 */
function bodySection(profile: number[]): THREE.BufferGeometry {
  const rings = profile.length - 1;
  const g = new THREE.CylinderGeometry(1, 1, 1, 12, rings, false, Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round((pos.getY(i) + 0.5) * rings);
    pos.setX(i, pos.getX(i) * profile[k]);
    pos.setZ(i, pos.getZ(i) * profile[k]);
  }
  g.computeVertexNormals();
  return g;
}

/** A unit box (y from −0.5 to 0.5) tapering from bottom to top, for boots. */
function taperedBox(wBot: number, wTop: number, dBot: number, dTop: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const top = pos.getY(i) > 0;
    pos.setX(i, pos.getX(i) * (top ? wTop : wBot));
    pos.setZ(i, pos.getZ(i) * (top ? dTop : dBot));
  }
  g.computeVertexNormals();
  return g;
}

/** Unit-length limb along y (from −0.5 to 0.5), tapering toward `rEnd`. */
const limb = (rStart: number, rEnd: number) => new THREE.CylinderGeometry(rEnd, rStart, 1, 8, 1);

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Creases painted into the cloth (a console kit texture bakes its lighting in): soft dark folds with a highlight on each. */
function folds(g: CanvasRenderingContext2D, W: number, H: number): void {
  g.lineCap = 'round';
  const crease = (x0: number, y0: number, x1: number, y1: number) => {
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(0,0,0,0.13)';
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo((x0 + x1) / 2 + 10, (y0 + y1) / 2, x1, y1);
    g.stroke();
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,255,255,0.09)';
    g.beginPath();
    g.moveTo(x0 + 6, y0 + 3);
    g.quadraticCurveTo((x0 + x1) / 2 + 16, (y0 + y1) / 2 + 3, x1 + 6, y1 + 3);
    g.stroke();
  };
  for (const side of [0, W / 2]) {
    // Pulled from under the arms toward the waist, front and back.
    crease(side + 40, 30, side + 90, 120);
    crease(side + W / 2 - 40, 40, side + W / 2 - 95, 135);
    crease(side + 70, H - 40, side + 140, H - 22);
  }
}

/**
 * The shirt, wrapped round the torso: front centred at u = 0.75 (V collar,
 * crest, a little shading down the sides), back at u = 0.25 (name bar and
 * number).
 */
function shirtTexture(kit: Kit, num: number, gear: Gear = 'soccer'): THREE.CanvasTexture {
  if (kit.stripes) return stripedTexture(kit);
  if (gear === 'football') return jerseyTexture(kit, num);
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = hex(kit.shirt);
  g.fillRect(0, 0, W, H);
  // Side shading and seams under the arms (u = 0 and 0.5).
  for (const cx of [0, W / 2, W]) {
    const grad = g.createLinearGradient(cx - 60, 0, cx + 60, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(cx - 60, 0, 120, H);
  }
  folds(g, W, H);
  // Hem.
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.fillRect(0, H - 14, W, 14);
  const fx = W * 0.75;
  // V collar.
  g.fillStyle = hex(kit.trim);
  g.beginPath();
  g.moveTo(fx - 34, 0);
  g.lineTo(fx, 44);
  g.lineTo(fx + 34, 0);
  g.lineTo(fx + 22, 0);
  g.lineTo(fx, 26);
  g.lineTo(fx - 22, 0);
  g.fill();
  // Crest on the left chest (viewer's right) and a small maker's mark opposite.
  g.beginPath();
  g.moveTo(fx + 30, 62);
  g.lineTo(fx + 52, 62);
  g.lineTo(fx + 52, 80);
  g.quadraticCurveTo(fx + 41, 94, fx + 30, 80);
  g.closePath();
  g.fill();
  g.fillRect(fx - 50, 66, 16, 8);
  // Back: collar, then the number (officials have none).
  const bx = W * 0.25;
  g.fillRect(bx - 30, 0, 60, 8);
  if (num <= 0) return texture(c);
  g.font = 'bold 110px "Arial Black", Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.strokeText(String(num), bx, 130);
  g.fillText(String(num), bx, 130);
  return texture(c);
}

/** An official's shirt: inch-wide black and white stripes all the way round, a black collar. */
function stripedTexture(kit: Kit): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = hex(kit.shirt);
  g.fillRect(0, 0, W, H);
  g.fillStyle = hex(kit.trim);
  for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 16, H);
  folds(g, W, H);
  g.fillRect(0, 0, W, 10);
  return texture(c);
}

/** A football jersey: crew collar, shoulder stripes, big numbers on the front and the back. */
function jerseyTexture(kit: Kit, num: number): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = hex(kit.shirt);
  g.fillRect(0, 0, W, H);
  for (const cx of [0, W / 2, W]) {
    const grad = g.createLinearGradient(cx - 50, 0, cx + 50, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(cx - 50, 0, 100, H);
  }
  folds(g, W, H);
  g.fillStyle = hex(kit.trim);
  g.fillRect(0, 0, W, 9);
  g.font = 'bold 132px "Arial Black", Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  for (const cx of [W * 0.25, W * 0.75]) {
    g.strokeText(String(num), cx, 128);
    g.fillText(String(num), cx, 128);
  }
  return texture(c);
}

/** Face, wrapped round a sphere: three's sphere UVs put +z (the front) at u = 0.25. */
function faceTexture(kit: Kit): THREE.CanvasTexture {
  const [c, g] = canvas(256, 128);
  g.fillStyle = hex(kit.skin);
  g.fillRect(0, 0, 256, 128);
  const cx = 64;
  // Soft shading round the jaw and the back of the head.
  const grad = g.createLinearGradient(0, 70, 0, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = grad;
  g.fillRect(0, 70, 256, 58);
  g.fillStyle = 'rgba(30,20,12,0.7)';
  g.fillRect(cx - 19, 49, 13, 4); // brows
  g.fillRect(cx + 6, 49, 13, 4);
  g.fillStyle = '#f4f1ea';
  g.fillRect(cx - 17, 57, 10, 6); // eyes
  g.fillRect(cx + 7, 57, 10, 6);
  g.fillStyle = '#20160e';
  g.fillRect(cx - 14, 57, 5, 6);
  g.fillRect(cx + 10, 57, 5, 6);
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(cx - 3, 60, 6, 16); // nose
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(cx - 6, 74, 12, 4);
  g.fillStyle = 'rgba(110,40,40,0.6)';
  g.fillRect(cx - 10, 84, 20, 4); // mouth
  return texture(c);
}

class Segment {
  readonly mesh: THREE.Mesh;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) {
    this.mesh = new THREE.Mesh(geo, mat);
      }
  /** Stretch the unit-length piece from a to b. */
  place(a: THREE.Vector3, b: THREE.Vector3): void {
    const dir = b.clone().sub(a);
    const len = dir.length();
    this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    if (len > 1e-6) this.mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(len));
    this.mesh.scale.set(1, Math.max(0.02, len), 1);
  }
}

type Pair<T> = [T, T];
const pair = <T>(make: () => T): Pair<T> => [make(), make()];
const along = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
const ball = (r: number, mat: THREE.Material) => new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);

// Torso: waist → chest → rounded shoulders. Shorts flare a little at the hem.
const TORSO_PROFILE = [0.8, 0.86, 0.97, 1.0, 0.9];
const SHORTS_PROFILE = [1.08, 1.0, 0.95];

export class Figure {
  readonly group = new THREE.Group();
  private readonly shadow = new BlobShadows(1.7, 0.7, 0.32);
  private readonly mats: {
    shirt: THREE.MeshPhongMaterial;
    body: THREE.MeshPhongMaterial;
    trim: THREE.MeshPhongMaterial;
    shorts: THREE.MeshPhongMaterial;
    socks: THREE.MeshPhongMaterial;
    skin: THREE.MeshPhongMaterial;
    face: THREE.MeshPhongMaterial;
    hair: THREE.MeshPhongMaterial;
    hands: THREE.MeshPhongMaterial;
    boots: THREE.MeshPhongMaterial;
    helmet: THREE.MeshPhongMaterial;
    mask: THREE.MeshPhongMaterial;
  };
  private readonly torso: THREE.Mesh;
  private readonly shorts: THREE.Mesh;
  private readonly neck: Segment;
  private readonly head: THREE.Mesh;
  private readonly hair: THREE.Mesh;
  private readonly ears: Pair<THREE.Mesh>;
  private readonly shoulder: Pair<THREE.Mesh>;
  private readonly sleeve: Pair<Segment>;
  private readonly elbow: Pair<THREE.Mesh>;
  private readonly forearm: Pair<Segment>;
  private readonly hand: Pair<THREE.Mesh>;
  private readonly thighShorts: Pair<Segment>;
  private readonly thigh: Pair<Segment>;
  private readonly knee: Pair<THREE.Mesh>;
  private readonly sockBand: Pair<Segment>;
  private readonly shin: Pair<Segment>;
  private readonly boot: Pair<THREE.Mesh>;
  private readonly helmet = new THREE.Group();
  private readonly pads: THREE.Mesh;
  private gear: Gear = 'soccer';
  private kit: Kit;
  private num: number;

  constructor(kit: Kit, private readonly keeper = false) {
    const phong = (shininess: number) => new THREE.MeshPhongMaterial({ shininess, specular: 0x303030 });
    this.mats = {
      shirt: phong(24),
      body: phong(24),
      trim: phong(24),
      shorts: phong(20),
      socks: phong(10),
      skin: phong(8),
      face: phong(8),
      hair: phong(4),
      hands: phong(keeper ? 14 : 8),
      boots: phong(70),
      helmet: phong(90),
      mask: phong(30),
    };
    const m = this.mats;
    this.torso = new THREE.Mesh(bodySection(TORSO_PROFILE), m.body);
    this.shorts = new THREE.Mesh(bodySection(SHORTS_PROFILE), m.shorts);
    this.neck = new Segment(limb(0.058, 0.05), m.skin);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), m.face);
    this.head.scale.set(0.098, 0.122, 0.11);
    this.hair = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 1.95), m.hair);
    this.hair.scale.set(0.108, 0.118, 0.122);
    this.ears = pair(() => ball(0.024, m.skin));
    this.shoulder = pair(() => ball(0.072, m.shirt));
    // Short sleeves for outfield players; the keeper wears long ones and gloves.
    this.sleeve = pair(() => new Segment(limb(0.066, 0.056), m.shirt));
    this.elbow = pair(() => ball(0.044, keeper ? m.shirt : m.skin));
    this.forearm = pair(() => new Segment(limb(0.046, 0.036), keeper ? m.shirt : m.skin));
    this.hand = pair(() => {
      const h = ball(1, m.hands);
      if (keeper) h.scale.set(0.065, 0.085, 0.04);
      else h.scale.set(0.042, 0.05, 0.03);
      return h;
    });
    this.thighShorts = pair(() => new Segment(limb(0.1, 0.088), m.shorts));
    this.thigh = pair(() => new Segment(limb(0.082, 0.062), m.skin));
    this.knee = pair(() => ball(0.06, m.skin));
    this.sockBand = pair(() => new Segment(limb(0.06, 0.057), m.trim));
    this.shin = pair(() => new Segment(limb(0.058, 0.04), m.socks));
    const bootGeo = taperedBox(0.11, 0.09, 0.28, 0.22);
    this.boot = pair(() => new THREE.Mesh(bootGeo, m.boots));

    const meshes = [
      this.torso, this.shorts, this.neck.mesh, this.head, this.hair,
      ...this.ears, ...this.shoulder, ...this.elbow, ...this.hand, ...this.knee, ...this.boot,
      ...[...this.sleeve, ...this.forearm, ...this.thighShorts, ...this.thigh, ...this.sockBand, ...this.shin].map((s) => s.mesh),
    ];
    for (const mesh of meshes) {
      this.group.add(mesh);
    }

    // Football gear. The helmet: a full dome over a band open at the face, the
    // facemask's bars across the opening, in the head's frame (+z the face).
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), m.helmet);
    const gap = 1.25;
    const band = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 5, Math.PI / 2 + gap / 2, Math.PI * 2 - gap, Math.PI * 0.42, Math.PI * 0.36), m.helmet);
    for (const shell of [dome, band]) {
      shell.scale.set(0.132, 0.142, 0.15);
      this.helmet.add(shell);
    }
    const arc = 1.9;
    for (const y of [-0.03, -0.075]) {
      const bar = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.008, 5, 14, arc), m.mask);
      bar.rotation.x = Math.PI / 2;
      const holder = new THREE.Group();
      holder.rotation.y = -(Math.PI - arc) / 2;
      holder.position.set(0, y, 0.025);
      holder.add(bar);
      this.helmet.add(holder);
    }
    const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.075, 5), m.mask);
    upright.position.set(0, -0.052, 0.155);
    this.helmet.add(upright);
    this.helmet.visible = false;
    this.group.add(this.helmet);
    // Shoulder pads under the jersey: wide and squared off over the shoulders.
    this.pads = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), m.shirt);
    this.pads.visible = false;
    this.group.add(this.pads);
    this.group.add(this.shadow.group);

    this.kit = kit;
    this.num = kit.number;
    this.setKit(kit);
  }

  /** Soccer kit or American football gear. */
  setGear(gear: Gear): void {
    if (gear === this.gear) return;
    this.gear = gear;
    // Football gear and officials both wear pants to the knee; only the players wear helmets and pads.
    const fb = gear !== 'soccer';
    const helmet = gear === 'football';
    this.helmet.visible = helmet;
    this.pads.visible = helmet;
    this.hair.visible = !helmet;
    for (const e of this.ears) e.visible = !helmet;
    for (const t of this.thigh) t.mesh.visible = !fb;
    for (const b of this.sockBand) b.mesh.visible = !fb;
    for (const k of this.knee) k.material = fb ? this.mats.shorts : this.mats.skin;
    this.setKit(this.kit, this.num);
  }

  /** Show the floodlight shadows or not. */
  setShadows(on: boolean): void {
    this.shadow.group.visible = on;
  }

  setKit(kit: Kit, num = kit.number): void {
    this.kit = kit;
    this.num = num;
    const m = this.mats;
    m.helmet.color.setHex(kit.helmet ?? kit.shirt);
    m.mask.color.setHex(0x9aa0a8);
    m.shirt.color.setHex(kit.shirt);
    m.trim.color.setHex(kit.trim);
    m.shorts.color.setHex(kit.shorts);
    m.socks.color.setHex(kit.socks);
    m.skin.color.setHex(kit.skin);
    m.hair.color.setHex(kit.hair);
    m.hands.color.setHex(kit.hands);
    m.boots.color.setHex(kit.boots);
    for (const [mat, tex] of [
      [m.body, shirtTexture(kit, num, this.gear)],
      [m.face, faceTexture(kit)],
    ] as const) {
      mat.map?.dispose();
      mat.map = tex;
      mat.needsUpdate = true;
    }
  }

  setPose(j: Joints): void {
    // Body frame: x to the left shoulder, y up the spine, z (the shirt front) forward.
    const yAxis = j.chest.clone().sub(j.pelvis).normalize();
    const xAxis = j.shoulderL.clone().sub(j.shoulderR);
    xAxis.addScaledVector(yAxis, -xAxis.dot(yAxis)).normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
    const frame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));

    // Torso from the waist to just over the shoulders, elliptical in section.
    const top = j.chest.clone().addScaledVector(yAxis, 0.09);
    const waist = j.pelvis.clone().addScaledVector(yAxis, 0.03);
    const len = top.distanceTo(waist);
    this.torso.position.copy(top).add(waist).multiplyScalar(0.5);
    this.torso.quaternion.copy(frame);
    this.torso.scale.set(0.205, len, 0.125);
    const hem = j.pelvis.clone().addScaledVector(yAxis, -0.16);
    const belt = waist.clone().addScaledVector(yAxis, 0.04);
    this.shorts.position.copy(hem).add(belt).multiplyScalar(0.5);
    this.shorts.quaternion.copy(frame);
    this.shorts.scale.set(0.18, hem.distanceTo(belt), 0.125);

    this.neck.place(top.clone().addScaledVector(yAxis, -0.04), j.head.clone().addScaledVector(yAxis, -0.07));
    this.head.position.copy(j.head);
    this.head.quaternion.copy(frame);
    this.hair.position.copy(j.head).addScaledVector(yAxis, 0.008).addScaledVector(zAxis, -0.012);
    this.hair.quaternion.copy(frame);
    this.ears.forEach((e, i) => e.position.copy(j.head).addScaledVector(xAxis, (i ? -1 : 1) * 0.097).addScaledVector(zAxis, -0.008));
    const fb = this.gear !== 'soccer';
    if (this.gear === 'football') {
      this.helmet.position.copy(j.head).addScaledVector(yAxis, 0.012);
      this.helmet.quaternion.copy(frame);
      this.pads.position.copy(top).addScaledVector(yAxis, -0.05);
      this.pads.quaternion.copy(frame);
      this.pads.scale.set(0.27, 0.1, 0.165);
    }

    const shoulder = [j.shoulderL, j.shoulderR];
    const elbow = [j.elbowL, j.elbowR];
    const hand = [j.handL, j.handR];
    const hip = [j.hipL, j.hipR];
    const knee = [j.kneeL, j.kneeR];
    const ankle = [j.ankleL, j.ankleR];
    const fwd = j.forward.clone().setY(0).normalize();
    for (let i = 0; i < 2; i++) {
      this.shoulder[i].position.copy(shoulder[i]).addScaledVector(yAxis, -0.01);
      this.sleeve[i].place(shoulder[i], this.keeper ? elbow[i] : along(shoulder[i], elbow[i], 0.62));
      this.elbow[i].position.copy(elbow[i]);
      this.forearm[i].place(this.keeper ? elbow[i] : along(shoulder[i], elbow[i], 0.6), hand[i]);
      this.hand[i].position.copy(hand[i]);
      this.hand[i].quaternion.copy(frame);
      this.thighShorts[i].place(hip[i], fb ? along(hip[i], knee[i], 1.05) : along(hip[i], knee[i], 0.42));
      this.thigh[i].place(along(hip[i], knee[i], 0.4), knee[i]);
      this.knee[i].position.copy(knee[i]);
      this.sockBand[i].place(along(knee[i], ankle[i], 0.1), along(knee[i], ankle[i], 0.22));
      this.shin[i].place(along(knee[i], ankle[i], fb ? 0.05 : 0.2), ankle[i]);
      const b = this.boot[i];
      b.position.copy(ankle[i]).addScaledVector(fwd, 0.06);
      b.position.y = Math.max(0.04, ankle[i].y - 0.05);
      b.scale.set(1, 0.085, 1);
      b.lookAt(b.position.clone().add(fwd));
    }

    // Under the body: between the feet and the hips (a diving keeper's is under his middle).
    const low = Math.min(j.ankleL.y, j.ankleR.y, j.pelvis.y - 0.3);
    const cx = (j.ankleL.x + j.ankleR.x + j.pelvis.x * 2) / 4;
    const cz = (j.ankleL.z + j.ankleR.z + j.pelvis.z * 2) / 4;
    this.shadow.place(cx, cz, low - 0.09);
  }
}

// ── Pose builders ──────────────────────────────────────────────────────────

const P = (v: { x: number; y: number; z: number }, out: THREE.Vector3) => out.set(v.x, v.y, v.z);

/** Keeper pose straight from the sim hitbox (see shared/src/keeper.ts part order). */
export function keeperJoints(parts: KeeperPart[], j: Joints): Joints {
  P(parts[0].a, j.pelvis);
  P(parts[0].b, j.chest);
  P(parts[1].a, j.head);
  P(parts[2].a, j.shoulderL);
  P(parts[3].a, j.shoulderR);
  P(parts[4].a, j.handL);
  P(parts[5].a, j.handR);
  P(parts[6].a, j.hipL);
  P(parts[7].a, j.hipR);
  P(parts[6].b, j.ankleL);
  P(parts[7].b, j.ankleR);
  const down = j.pelvis.clone().sub(j.chest).normalize();
  const poleL = j.shoulderL.clone().sub(j.chest).normalize().addScaledVector(down, 0.7).add(new THREE.Vector3(0, 0, -0.3));
  const poleR = j.shoulderR.clone().sub(j.chest).normalize().addScaledVector(down, 0.7).add(new THREE.Vector3(0, 0, -0.3));
  solveMid(j.shoulderL, j.handL, UPPER_ARM, FOREARM, poleL, j.elbowL);
  solveMid(j.shoulderR, j.handR, UPPER_ARM, FOREARM, poleR, j.elbowR);
  const knee = new THREE.Vector3(0, 0, 1);
  solveMid(j.hipL, j.ankleL, THIGH, SHIN, knee, j.kneeL);
  solveMid(j.hipR, j.ankleR, THIGH, SHIN, knee, j.kneeR);
  j.forward.set(0, 0, 1);
  return j;
}

/** Simple standing body: pelvis on the ground plane at (x, z), facing `facing`. */
function standing(
  j: Joints,
  x: number,
  z: number,
  facing: THREE.Vector3,
  lift: number,
  hands: (side: number, shoulder: THREE.Vector3, right: THREE.Vector3) => THREE.Vector3,
): void {
  const f = facing.clone().setY(0).normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x);
  j.pelvis.set(x, 0.95 + lift, z);
  j.chest.copy(j.pelvis).add(new THREE.Vector3(0, 0.5, 0));
  j.head.copy(j.chest).add(new THREE.Vector3(0, 0.24, 0));
  j.shoulderL.copy(j.chest).addScaledVector(r, -0.2);
  j.shoulderR.copy(j.chest).addScaledVector(r, 0.2);
  j.handL.copy(hands(-1, j.shoulderL, r));
  j.handR.copy(hands(1, j.shoulderR, r));
  j.hipL.copy(j.pelvis).addScaledVector(r, -0.11);
  j.hipR.copy(j.pelvis).addScaledVector(r, 0.11);
  const tuck = Math.min(0.25, lift * 0.6);
  j.ankleL.copy(j.hipL).add(new THREE.Vector3(0, -0.86 + tuck, 0)).addScaledVector(f, -tuck * 0.5);
  j.ankleR.copy(j.hipR).add(new THREE.Vector3(0, -0.86 + tuck, 0)).addScaledVector(f, -tuck * 0.5);
  const back = f.clone().negate().add(new THREE.Vector3(0, -0.5, 0));
  solveMid(j.shoulderL, j.handL, UPPER_ARM, FOREARM, back.clone().addScaledVector(r, -0.5), j.elbowL);
  solveMid(j.shoulderR, j.handR, UPPER_ARM, FOREARM, back.clone().addScaledVector(r, 0.5), j.elbowR);
  solveMid(j.hipL, j.ankleL, THIGH, SHIN, f, j.kneeL);
  solveMid(j.hipR, j.ankleR, THIGH, SHIN, f, j.kneeR);
  j.forward.copy(f);
}

/** Wall player: hands covering, jumping by `jumpY`. */
export function wallJoints(x: number, z: number, facing: THREE.Vector3, jumpY: number, j: Joints): Joints {
  standing(j, x, z, facing, jumpY, (side, _s, r) => {
    const f = facing.clone().setY(0).normalize();
    return new THREE.Vector3(x, 0.85 + jumpY, z).addScaledVector(f, 0.16).addScaledVector(r, side * 0.05);
  });
  return j;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Shooter run-up and strike, t seconds relative to contact (−1.2 … +0.8).
 * Right-footed, approaching from the left. The run-up is identical for every
 * kick (SPEC §5.3); the style only shows from the moment of the strike: an
 * instep drive follows through straight, a curler wraps across the body, a
 * trivela swings out to the right off the outside of the boot, and a chip
 * stabs under the ball and stops short.
 */
export function kickerJoints(t: number, ball: THREE.Vector3, goalward: THREE.Vector3, j: Joints, style: KickStyle = 'instep'): Joints {
  const f = goalward.clone().setY(0).normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x);
  const start = ball.clone().addScaledVector(f, -3.4).addScaledVector(r, -1.6);
  const plant = ball.clone().addScaledVector(f, -0.42).addScaledVector(r, -0.32);
  const tc = Math.min(Math.max(t, -1.2), 0.8);
  let pelvisXZ: THREE.Vector3;
  if (tc < 0) {
    const s = (tc + 1.2) / 1.2;
    pelvisXZ = start.clone().lerp(plant, 1 - (1 - s) * (1 - s * 0.35));
  } else {
    pelvisXZ = plant.clone().addScaledVector(f, Math.min(0.7, tc * 1.6));
  }
  const approach = plant.clone().sub(start).setY(0).normalize();
  const heading = approach.clone().lerp(f, smooth(-0.45, 0, tc)).normalize();
  const hr = new THREE.Vector3(-heading.z, 0, heading.x);

  const running = 1 - smooth(-0.3, -0.05, tc);
  const phase = (tc + 1.2) * Math.PI * 2 * 1.7;
  const kick = smooth(-0.42, -0.28, tc) * (1 - smooth(0.3, 0.6, tc));

  j.pelvis.copy(pelvisXZ).setY(0.93 + 0.04 * Math.abs(Math.sin(phase)) * running - 0.05 * kick);
  const lean = heading.clone().multiplyScalar(0.08 * running - 0.07 * kick).addScaledVector(hr, -0.05 * kick);
  j.chest.copy(j.pelvis).add(new THREE.Vector3(0, 0.5, 0)).add(lean);
  j.head.copy(j.chest).add(new THREE.Vector3(0, 0.23, 0)).addScaledVector(heading, 0.03);
  j.shoulderL.copy(j.chest).addScaledVector(hr, -0.2);
  j.shoulderR.copy(j.chest).addScaledVector(hr, 0.2);
  j.hipL.copy(j.pelvis).addScaledVector(hr, -0.11);
  j.hipR.copy(j.pelvis).addScaledVector(hr, 0.11);

  // Gait.
  const stride = 0.38 * running;
  const ground = (hip: THREE.Vector3, s: number, lift: number) =>
    hip.clone().setY(0.09 + lift).addScaledVector(heading, s);
  const gaitL = ground(j.hipL, stride * Math.sin(phase), 0.16 * Math.max(0, Math.cos(phase)) * running);
  const gaitR = ground(j.hipR, -stride * Math.sin(phase), 0.16 * Math.max(0, -Math.cos(phase)) * running);

  // Plant foot beside the ball, kicking foot: backswing → ball → follow-through.
  const plantFoot = ball.clone().addScaledVector(r, -0.28).addScaledVector(f, -0.08).setY(0.09);
  j.ankleL.copy(gaitL).lerp(plantFoot, kick);
  const back = j.pelvis.clone().addScaledVector(heading, -0.55).addScaledVector(hr, 0.12).setY(0.55);
  const strike = ball.clone().addScaledVector(f, -0.12).setY(style === 'chip' ? 0.06 : 0.12);
  const follow = j.pelvis.clone();
  if (style === 'chip') follow.addScaledVector(f, 0.3).setY(0.4);
  else if (style === 'trivela') follow.addScaledVector(f, 0.5).addScaledVector(hr, 0.45).setY(0.6);
  else if (style === 'curler') follow.addScaledVector(f, 0.6).addScaledVector(hr, -0.4).setY(0.8);
  else follow.addScaledVector(f, 0.75).addScaledVector(hr, -0.1).setY(0.85);
  const kickFoot =
    tc < -0.1 ? back : tc < 0 ? back.clone().lerp(strike, smooth(-0.1, 0, tc)) : strike.clone().lerp(follow, smooth(0, 0.22, tc));
  j.ankleR.copy(gaitR).lerp(kickFoot, kick);

  // Arms swing against the legs; the left arm goes out for balance at the strike.
  const swing = 0.28 * Math.sin(phase) * running;
  j.handL.copy(j.shoulderL).add(new THREE.Vector3(0, -0.5, 0)).addScaledVector(heading, -swing + 0.05);
  j.handR.copy(j.shoulderR).add(new THREE.Vector3(0, -0.5, 0)).addScaledVector(heading, swing + 0.05);
  j.handL.lerp(j.shoulderL.clone().addScaledVector(hr, -0.55).add(new THREE.Vector3(0, 0.05, 0)), kick);
  j.handR.lerp(j.shoulderR.clone().addScaledVector(hr, 0.25).addScaledVector(heading, -0.3).add(new THREE.Vector3(0, -0.35, 0)), kick);

  const elbowPole = heading.clone().negate().add(new THREE.Vector3(0, -0.4, 0));
  solveMid(j.shoulderL, j.handL, UPPER_ARM, FOREARM, elbowPole.clone().addScaledVector(hr, -0.3), j.elbowL);
  solveMid(j.shoulderR, j.handR, UPPER_ARM, FOREARM, elbowPole.clone().addScaledVector(hr, 0.3), j.elbowR);
  solveMid(j.hipL, j.ankleL, THIGH, SHIN, heading, j.kneeL);
  solveMid(j.hipR, j.ankleR, THIGH, SHIN, heading, j.kneeR);
  j.forward.copy(heading);
  return j;
}

/**
 * Generic pose: pelvis and chest placed, feet and hands where given, elbows
 * (back and down) and knees (toward `kneeL` / `kneeR`) solved.
 */
export function bodyPose(
  j: Joints,
  pelvis: THREE.Vector3,
  facing: THREE.Vector3,
  chestOffset: THREE.Vector3,
  ankleL: THREE.Vector3,
  ankleR: THREE.Vector3,
  handL: THREE.Vector3,
  handR: THREE.Vector3,
  kneeL: THREE.Vector3 = facing,
  kneeR: THREE.Vector3 = kneeL,
): Joints {
  const f = facing.clone().setY(0).normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x);
  j.pelvis.copy(pelvis);
  j.chest.copy(pelvis).add(chestOffset);
  const spine = j.chest.clone().sub(j.pelvis).normalize();
  j.head.copy(j.chest).addScaledVector(spine, 0.24);
  j.shoulderL.copy(j.chest).addScaledVector(r, -0.2);
  j.shoulderR.copy(j.chest).addScaledVector(r, 0.2);
  j.hipL.copy(pelvis).addScaledVector(r, -0.11);
  j.hipR.copy(pelvis).addScaledVector(r, 0.11);
  j.ankleL.copy(ankleL);
  j.ankleR.copy(ankleR);
  j.handL.copy(handL);
  j.handR.copy(handR);
  const back = f.clone().negate().add(new THREE.Vector3(0, -0.5, 0));
  solveMid(j.shoulderL, j.handL, UPPER_ARM, FOREARM, back.clone().addScaledVector(r, -0.5), j.elbowL);
  solveMid(j.shoulderR, j.handR, UPPER_ARM, FOREARM, back.clone().addScaledVector(r, 0.5), j.elbowR);
  solveMid(j.hipL, j.ankleL, THIGH, SHIN, kneeL, j.kneeL);
  solveMid(j.hipR, j.ankleR, THIGH, SHIN, kneeR, j.kneeR);
  j.forward.copy(f);
  return j;
}

const JOINT_KEYS = Object.keys(emptyJoints()) as (keyof Joints)[];

/** Blend pose `b` into `a` by w (0 = a, 1 = b), in place on a. */
export function blendJoints(a: Joints, b: Joints, w: number): Joints {
  for (const k of JOINT_KEYS) a[k].lerp(b[k], w);
  a.forward.normalize();
  return a;
}

/** When the field goal kicker sets off (s before contact): as the holder catches the snap. */
export const FG_APPROACH_START = -0.68;

const lerpV = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.clone().lerp(b, k);
/** A foot stepping from `a` to `b` over u ∈ 0 … 1, lifted `lift` at the middle. */
const stepFoot = (a: THREE.Vector3, b: THREE.Vector3, u: number, lift: number) => {
  const k = smooth(0, 1, u);
  return lerpV(a, b, k).setY(0.09 + lift * Math.sin(Math.PI * Math.min(1, Math.max(0, u))));
};

/**
 * A field goal kicker (right-footed), t seconds relative to contact: set three
 * steps back and two across at about 30° to the kick, until the holder
 * catches the snap; then a short jab step with the right foot, a long one
 * onto the planted left beside the ball, the right leg cocked behind and
 * whipped through almost straight, finishing up above the waist with the body
 * leaning back and away from it and the left arm out for balance; a hop off
 * the plant foot, and down onto the kicking foot to watch it go.
 */
export function fieldGoalKickerJoints(t: number, ball: THREE.Vector3, goalward: THREE.Vector3, j: Joints): Joints {
  const f = goalward.clone().setY(0).normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x);
  const UP = new THREE.Vector3(0, 1, 0);
  const a = f.clone().multiplyScalar(0.86).addScaledVector(r, 0.5).normalize();
  const ar = new THREE.Vector3(-a.z, 0, a.x);
  const plant = ball.clone().addScaledVector(r, -0.3).addScaledVector(f, -0.08).setY(0.09);
  const start = plant.clone().addScaledVector(a, -2.4).setY(0);
  const tc = Math.min(Math.max(t, -1.2), 1);
  const T0 = FG_APPROACH_START;

  // Feet: set (left a little ahead), the jab, the plant.
  const left0 = start.clone().addScaledVector(a, 0.1).addScaledVector(ar, -0.12).setY(0.09);
  const right0 = start.clone().addScaledVector(a, -0.12).addScaledVector(ar, 0.12).setY(0.09);
  const jab = start.clone().addScaledVector(a, 1.05).addScaledVector(ar, 0.12).setY(0.09);
  let ankleL: THREE.Vector3;
  let ankleR: THREE.Vector3;
  if (tc < T0) {
    ankleL = left0;
    ankleR = right0;
  } else {
    ankleR = tc < -0.36 ? stepFoot(right0, jab, (tc - T0) / (-0.36 - T0), 0.13) : jab;
    ankleL = tc < -0.34 ? left0 : tc < -0.06 ? stepFoot(left0, plant, (tc + 0.34) / 0.28, 0.17) : plant.clone();
  }

  // The body: along the approach, accelerating, squaring up to the kick at the plant.
  const settle = plant.clone().addScaledVector(r, 0.1).addScaledVector(f, -0.15).setY(0);
  let pelvis: THREE.Vector3;
  let height: number;
  if (tc < T0) {
    pelvis = start.clone();
    height = 0.92;
  } else if (tc < 0) {
    const u = (tc - T0) / -T0;
    pelvis = lerpV(start, settle, 0.45 * u + 0.55 * u * u * (3 - 2 * u));
    // Down onto the jab, up between the steps, sinking onto the plant.
    height = 0.92 - 0.04 * Math.exp(-(((tc + 0.36) / 0.06) ** 2)) + 0.04 * Math.exp(-(((tc + 0.2) / 0.08) ** 2)) - 0.06 * smooth(-0.12, -0.02, tc);
  } else {
    // Carried on through by the swing, lifted off the plant foot (a hop), then down.
    pelvis = settle.clone().addScaledVector(f, 0.55 * smooth(0, 0.55, tc));
    height = 0.86 + 0.12 * smooth(0, 0.18, tc) - 0.06 * smooth(0.3, 0.6, tc);
  }
  pelvis.setY(height);
  const heading = a.clone().lerp(f, smooth(-0.3, -0.04, tc)).normalize();
  const hr = new THREE.Vector3(-heading.z, 0, heading.x);
  const hipR = pelvis.clone().addScaledVector(hr, 0.11);

  // The kicking leg: pushes off the jab, cocks behind (heel up), whips through
  // to the ball and swings on up, straight, across the body a little.
  const contact = ball.clone().addScaledVector(f, -0.07).setY(0.1);
  const cocked = hipR.clone().addScaledVector(heading, -0.38).setY(0.5);
  if (tc > -0.24 && tc < 0) {
    ankleR = tc < -0.1 ? lerpV(jab, cocked, smooth(-0.24, -0.1, tc)).setY(0.09 + (0.5 - 0.09) * smooth(-0.24, -0.1, tc)) : lerpV(cocked, contact, ((tc + 0.1) / 0.1) ** 2);
  } else if (tc >= 0) {
    const L = 0.86;
    const th = 0.2 + 1.85 * (1 - (1 - smooth(0, 0.22, tc)) ** 2);
    const arc = hipR.clone().addScaledVector(f, L * Math.sin(th)).addScaledVector(r, -0.22 * Math.sin(th)).setY(hipR.y - L * Math.cos(th));
    const land = ball.clone().addScaledVector(f, 0.55).addScaledVector(r, 0.02).setY(0.09);
    ankleR = tc < 0.24 ? lerpV(contact, arc, smooth(0, 0.03, tc)) : lerpV(arc, land, smooth(0.24, 0.55, tc));
    // The plant foot hops forward under him.
    const hop = smooth(0.06, 0.34, tc);
    ankleL = plant.clone().addScaledVector(f, 0.3 * hop).setY(0.09 + 0.12 * Math.sin(Math.PI * hop));
  }

  // Leaning: forward into the run, then back and away from the kicking leg through the strike.
  const strike = smooth(-0.1, 0, tc) * (1 - smooth(0.4, 0.8, tc));
  const run = 1 - smooth(-0.12, 0, tc);
  const chest = heading
    .clone()
    .multiplyScalar(tc < T0 ? 0.08 : 0.07 * run - 0.13 * strike)
    .addScaledVector(r, -0.13 * strike)
    .setY(0.5);

  // Arms: hanging loose in the set; pumping against the legs on the way in;
  // the left flung out wide and up for balance, the right swung back then across.
  const sh = pelvis.clone().add(chest);
  const shL = sh.clone().addScaledVector(hr, -0.2);
  const shR = sh.clone().addScaledVector(hr, 0.2);
  let handL: THREE.Vector3;
  let handR: THREE.Vector3;
  if (tc < T0) {
    handL = shL.clone().addScaledVector(heading, 0.08).addScaledVector(hr, -0.05).setY(sh.y - 0.56);
    handR = shR.clone().addScaledVector(heading, 0.08).addScaledVector(hr, 0.05).setY(sh.y - 0.56);
  } else {
    const pump = Math.sin(((tc - T0) / 0.32) * Math.PI) * 0.25 * run;
    handL = shL.clone().addScaledVector(heading, 0.1 - pump).setY(sh.y - 0.5);
    handR = shR.clone().addScaledVector(heading, 0.1 + pump).setY(sh.y - 0.5);
    const out = smooth(-0.16, 0, tc) * (1 - smooth(0.5, 0.9, tc));
    handL.lerp(shL.clone().addScaledVector(r, -0.55).addScaledVector(f, 0.15).setY(sh.y + 0.12), out);
    const back = shR.clone().addScaledVector(f, -0.3).addScaledVector(r, 0.15).setY(sh.y - 0.42);
    const across = sh.clone().addScaledVector(f, 0.32).addScaledVector(r, -0.12).setY(sh.y - 0.2);
    handR.lerp(lerpV(back, across, smooth(0, 0.2, tc)), out);
  }

  // The kicking knee leads (forward and up) through the swing.
  const kneePole = heading.clone().addScaledVector(UP, tc > -0.1 && tc < 0.3 ? 0.6 : 0);
  return bodyPose(j, pelvis, heading, chest, ankleL, ankleR, handL, handR, heading, kneePole);
}

function copyJoints(to: Joints, from: Joints): Joints {
  for (const k of JOINT_KEYS) to[k].copy(from[k]);
  return to;
}

/**
 * The small movements of someone standing waiting: breathing, a slow sway of
 * the weight, hands drifting (not ones planted on the turf). `seed` keeps
 * each figure on its own rhythm. Applied on top of a pose, in place.
 */
export function breathe(j: Joints, clock: number, seed: number, amount = 1): Joints {
  if (amount <= 0) return j;
  const a = clock * (1.5 + (seed % 7) * 0.09) + seed * 1.7;
  const rise = Math.sin(a) * 0.012 * amount;
  const sway = Math.sin(a * 0.31 + seed * 0.5) * 0.022 * amount;
  const side = new THREE.Vector3(-j.forward.z, 0, j.forward.x);
  const move = (p: THREE.Vector3, k: number) => {
    p.y += rise * k;
    p.addScaledVector(side, sway * k);
  };
  move(j.head, 1);
  move(j.chest, 0.8);
  move(j.shoulderL, 0.8);
  move(j.shoulderR, 0.8);
  move(j.elbowL, 0.7);
  move(j.elbowR, 0.7);
  if (j.handL.y > 0.15) move(j.handL, 0.5);
  if (j.handR.y > 0.15) move(j.handR, 0.5);
  move(j.pelvis, 0.3);
  return j;
}

// ── Taunts ────────────────────────────────────────────────────────────────
// Big, whole-body and readable from across the pitch, and made to be spammed:
// each tap cuts straight into the new one (a quick blend from wherever the
// last one was), and the figure only settles back once the taps stop.

export type KeeperEmote = 'wobble' | 'barslap' | 'starman';
export type GunnerEmote = 'hype' | 'airplane' | 'wardance';
export type Emote = KeeperEmote | GunnerEmote;

/** How long one taunt runs if nothing follows it, s. */
export const EMOTE_TIME = 1.6;

/** A taunt in progress: which, when it started, when this run of taps started, and the one it cut off. */
export interface EmoteState {
  kind: Emote;
  at: number;
  chainStart: number;
  prev: { kind: Emote; at: number } | null;
}

const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Bar height for the keeper's slap (the underside of the crossbar). */
const BAR = 2.44;

/**
 * A taunt, `t` seconds in, for someone standing at `base` (on the ground)
 * facing `facing`:
 * - wobble: the keeper's jelly legs, knees knocking, arms flapping, head going;
 * - barslap: a leap off both feet to slap the crossbar with both hands, twice;
 * - starman: arms and legs spread wide, bounding side to side across the goal;
 * - hype: jumping on the spot, both fists pumping over his head at the crowd;
 * - airplane: arms out like wings, banking left and right, swaying round;
 * - wardance: high knees stomping, fists pumping, chest out.
 */
export function emoteJoints(kind: Emote, t: number, base: THREE.Vector3, facing: THREE.Vector3, j: Joints): Joints {
  const f = facing.clone().setY(0).normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x);
  let pelvisY = 0.97;
  let lean = 0.04;
  let tilt = 0;
  let side = 0;
  let feet = 0.17;
  let liftL = 0;
  let liftR = 0;
  let knees = f.clone();
  let kneeR: THREE.Vector3 | undefined;
  let hl: THREE.Vector3;
  let hr: THREE.Vector3;
  const P = () => base.clone().addScaledVector(r, side).setY(pelvisY);
  const chestOf = () => f.clone().multiplyScalar(lean).addScaledVector(r, tilt).setY(0.5);
  const C = () => P().add(chestOf());
  switch (kind) {
    case 'wobble': {
      const w = Math.sin(t * 15);
      pelvisY = 0.88 + 0.05 * Math.abs(Math.sin(t * 7.5));
      side = 0.06 * Math.sin(t * 7.5);
      feet = 0.3;
      knees = f.clone().addScaledVector(r, -1.6 * w);
      kneeR = f.clone().addScaledVector(r, 1.6 * w);
      const c = C();
      hl = c.clone().addScaledVector(r, -0.55).setY(c.y - 0.05 + 0.25 * Math.sin(t * 11));
      hr = c.clone().addScaledVector(r, 0.55).setY(c.y - 0.05 + 0.25 * Math.sin(t * 11 + 2));
      break;
    }
    case 'barslap': {
      // Two leaps (0.8 s each): crouch, spring, slap at the top, land.
      const u = (t % 0.8) / 0.8;
      const air = u > 0.2 && u < 0.75 ? Math.sin(((u - 0.2) / 0.55) * Math.PI) : 0;
      const load = u < 0.2 ? Math.sin((u / 0.2) * Math.PI) : u > 0.75 ? Math.sin(((u - 0.75) / 0.25) * Math.PI) * 0.8 : 0;
      pelvisY = 0.97 - 0.22 * load + 0.42 * air;
      liftL = liftR = 0.42 * air;
      lean = -0.06 * air;
      const c = C();
      // Arms swing back on the load, up through the jump to the bar.
      const reachY = Math.min(BAR + 0.05, c.y + 0.6);
      const up = (s: number) => c.clone().addScaledVector(r, s * 0.25).addScaledVector(f, -0.2 - 0.05 * air).setY(reachY);
      const down = (s: number) => c.clone().addScaledVector(r, s * 0.25).addScaledVector(f, -0.35).setY(c.y - 0.45);
      const k = ease(air * 1.6);
      hl = down(-1).lerp(up(-1), k);
      hr = down(1).lerp(up(1), k);
      break;
    }
    case 'starman': {
      // Bounding across the line, a hop on each landing, a big X with the arms.
      side = 0.75 * Math.sin(t * 3.6);
      const hop = Math.abs(Math.sin(t * 7.2));
      pelvisY = 0.9 + 0.16 * hop;
      liftL = liftR = 0.12 * hop;
      feet = 0.36;
      tilt = -0.08 * Math.cos(t * 3.6);
      const c = C();
      const wave = 0.12 * Math.sin(t * 14);
      hl = c.clone().addScaledVector(r, -0.52).setY(c.y + 0.32 + wave);
      hr = c.clone().addScaledVector(r, 0.52).setY(c.y + 0.32 - wave);
      break;
    }
    case 'hype': {
      // Jumping on the spot, three a second, fists punching up on each one.
      const u = (t * 2.6) % 1;
      const air = Math.sin(u * Math.PI);
      pelvisY = 0.9 + 0.3 * air;
      liftL = liftR = 0.24 * air;
      const c = C();
      const punch = (s: number, ph: number) => c.clone().addScaledVector(r, s * 0.26).addScaledVector(f, 0.05).setY(c.y + 0.12 + 0.44 * Math.max(0, Math.sin(u * Math.PI * 2 + ph)));
      hl = punch(-1, 0);
      hr = punch(1, Math.PI);
      break;
    }
    case 'airplane': {
      // Wings out, banking one way then the other, weaving.
      const bank = Math.sin(t * 4);
      side = 0.35 * Math.sin(t * 2);
      pelvisY = 0.88;
      lean = 0.2;
      tilt = 0.16 * bank;
      const c = C();
      hl = c.clone().addScaledVector(r, -0.6).setY(c.y - 0.32 * bank);
      hr = c.clone().addScaledVector(r, 0.6).setY(c.y + 0.32 * bank);
      feet = 0.24;
      break;
    }
    case 'wardance': {
      // High knees, stomping, alternating, fists pumping with them.
      const ph = t * 8;
      liftL = Math.max(0, Math.sin(ph)) * 0.45;
      liftR = Math.max(0, -Math.sin(ph)) * 0.45;
      pelvisY = 0.93 + 0.05 * Math.abs(Math.cos(ph));
      lean = -0.04;
      const c = C();
      const fist = (s: number, k: number) => c.clone().addScaledVector(r, s * 0.3).addScaledVector(f, 0.15).setY(c.y + 0.05 + 0.3 * k);
      hl = fist(-1, Math.max(0, -Math.sin(ph)));
      hr = fist(1, Math.max(0, Math.sin(ph)));
      knees = f.clone().add(new THREE.Vector3(0, 0.6, 0));
      break;
    }
  }
  const pelvis = P();
  const ankle = (s: number, lift: number) =>
    base.clone().addScaledVector(r, side + s * feet).addScaledVector(f, lift * 0.35).setY(0.09 + lift);
  bodyPose(j, pelvis, f, chestOf(), ankle(-1, liftL), ankle(1, liftR), hl, hr, knees, kneeR ?? knees);
  if (kind === 'wobble') j.head.addScaledVector(r, Math.sin(t * 13) * 0.05);
  return j;
}

/**
 * Lay a taunt over pose `j` (in place) at time `now`: eased in at the start
 * of a run of taps and out after the last, cutting from the taunt it
 * interrupted over a tenth of a second or so; `fade` scales the lot (to let
 * it go as a run-up starts).
 */
export function poseEmote(j: Joints, e: EmoteState, now: number, base: THREE.Vector3, facing: THREE.Vector3, a: Joints, b: Joints, fade = 1): void {
  const t = now - e.at;
  const w = Math.min(ease((now - e.chainStart) / 0.2), ease((EMOTE_TIME - t) / 0.3)) * fade;
  if (w <= 0) return;
  emoteJoints(e.kind, t, base, facing, a);
  if (e.prev && t < 0.15) blendJoints(emoteJoints(e.prev.kind, now - e.prev.at, base, facing, b), a, ease(t / 0.15));
  else copyJoints(b, a);
  blendJoints(j, b, w);
}
