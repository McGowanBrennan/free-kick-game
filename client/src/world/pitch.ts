// The stadium, dressed like an early-2000s console football game: a
// cross-mown pitch with a worn goalmouth, rotating LED boards (made-up
// sponsors), two-tier stands with a living pixel crowd, flags and fan banners
// under lit roofs, big screens, floodlight towers, corner flags, and the goal
// with a rippling net. For field goals it turns into an American football
// stadium: a gridiron with yard lines, numbers, hashes and a painted end zone,
// and a crowd in jerseys with towels and signs.

import * as THREE from 'three';
import { LedBoards, Screen, fascia } from './ads';
import { Flashes, banner, crowdExcite, crowdMaterial, crowdTexture, crowdTime, flag, towel, type CrowdTheme } from './crowd';
import {
  BALL_RADIUS,
  BAR_Y,
  BOX_DEPTH,
  BOX_HALF_WIDTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  HASH_X,
  NET_DEPTH,
  PENALTY_SPOT_Z,
  POST_RADIUS,
  POST_X,
  SIX_DEPTH,
  SIX_HALF_WIDTH,
  WALL_DISTANCE,
} from '@fk/shared';

const PITCH_HALF_W = 38;
const PITCH_MIN_Z = -8;
const PITCH_MAX_Z = 60;
const TOUCHLINE_X = 34;
const HALFWAY_Z = 52.5;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function pitchTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const ppm = 26; // pixels per metre
  const w = PITCH_HALF_W * 2 * ppm;
  const h = (PITCH_MAX_Z - PITCH_MIN_Z) * ppm;
  const [c, g] = canvas(w, h);
  const X = (x: number) => (x + PITCH_HALF_W) * ppm;
  const Z = (z: number) => (z - PITCH_MIN_Z) * ppm;

  // Cross-mown: bands every 5.5 m from the goal line, crossed by fainter ones.
  for (let z = PITCH_MIN_Z; z < PITCH_MAX_Z; z += 5.5) {
    const i = Math.round((z - PITCH_MIN_Z) / 5.5);
    g.fillStyle = i % 2 ? '#2c9a3a' : '#37ab45';
    g.fillRect(0, Z(z), w, 5.5 * ppm + 1);
  }
  for (let x = -PITCH_HALF_W; x < PITCH_HALF_W; x += 5.5) {
    if (Math.round((x + PITCH_HALF_W) / 5.5) % 2) continue;
    g.fillStyle = 'rgba(255,255,255,0.045)';
    g.fillRect(X(x), 0, 5.5 * ppm, h);
  }
  for (let i = 0; i < 30000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
    g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
  }
  // Wear: the goalmouth and the penalty spot are scuffed down to the soil.
  const wear = (x: number, z: number, rx: number, rz: number, a: number) => {
    g.save();
    g.translate(X(x), Z(z));
    g.scale(rx * ppm, rz * ppm);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, `rgba(118,112,62,${a})`);
    grad.addColorStop(0.6, `rgba(110,118,58,${a * 0.5})`);
    grad.addColorStop(1, 'rgba(110,118,58,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  wear(0, 1.4, 3.6, 2.2, 0.55);
  wear(-1.6, 0.6, 1.4, 0.9, 0.4);
  wear(1.8, 0.7, 1.2, 0.9, 0.35);
  wear(0, PENALTY_SPOT_Z, 0.9, 0.7, 0.4);

  g.strokeStyle = 'rgba(250,252,250,0.95)';
  g.lineWidth = 0.12 * ppm;
  const line = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.stroke();
  };
  line([[-TOUCHLINE_X, 0], [TOUCHLINE_X, 0]]);
  line([[-TOUCHLINE_X, 0], [-TOUCHLINE_X, PITCH_MAX_Z]]);
  line([[TOUCHLINE_X, 0], [TOUCHLINE_X, PITCH_MAX_Z]]);
  line([[-TOUCHLINE_X, HALFWAY_Z], [TOUCHLINE_X, HALFWAY_Z]]);
  line([[-BOX_HALF_WIDTH, 0], [-BOX_HALF_WIDTH, BOX_DEPTH], [BOX_HALF_WIDTH, BOX_DEPTH], [BOX_HALF_WIDTH, 0]]);
  line([[-SIX_HALF_WIDTH, 0], [-SIX_HALF_WIDTH, SIX_DEPTH], [SIX_HALF_WIDTH, SIX_DEPTH], [SIX_HALF_WIDTH, 0]]);
  const a0 = Math.acos((BOX_DEPTH - PENALTY_SPOT_Z) / WALL_DISTANCE);
  g.beginPath();
  g.arc(X(0), Z(PENALTY_SPOT_Z), WALL_DISTANCE * ppm, Math.PI / 2 - a0, Math.PI / 2 + a0);
  g.stroke();
  g.beginPath();
  g.arc(X(0), Z(HALFWAY_Z), WALL_DISTANCE * ppm, Math.PI, Math.PI * 2);
  g.stroke();
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(X(sx * TOUCHLINE_X), Z(0), ppm, sx < 0 ? 0 : Math.PI / 2, sx < 0 ? Math.PI / 2 : Math.PI);
    g.stroke();
  }
  g.fillStyle = 'rgba(250,252,250,0.95)';
  for (const z of [PENALTY_SPOT_Z, HALFWAY_Z]) {
    g.beginPath();
    g.arc(X(0), Z(z), 0.12 * ppm, 0, Math.PI * 2);
    g.fill();
  }

  const tex = texture(c);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

const YD = 0.9144;
/** The gridiron: the posts on the end line (z = 0), the goal line 10 yards out, 53⅓ yards wide. */
const GOAL_LINE_Z = 10 * YD;
const SIDELINE_X = (160 / 6) * YD;

/**
 * The football field, on the same plane as the soccer pitch: mown in 5-yard
 * bands, a painted end zone with a wordmark, yard lines every 5 yards,
 * numbers every 10, college hash marks every yard, and the white border.
 */
function footballTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const ppm = 22;
  const w = PITCH_HALF_W * 2 * ppm;
  const h = (PITCH_MAX_Z - PITCH_MIN_Z) * ppm;
  const [c, g] = canvas(w, h);
  const X = (x: number) => (x + PITCH_HALF_W) * ppm;
  const Z = (z: number) => (z - PITCH_MIN_Z) * ppm;
  g.fillStyle = '#2a7f34';
  g.fillRect(0, 0, w, h);
  for (let k = 0; GOAL_LINE_Z + k * 5 * YD < PITCH_MAX_Z; k++) {
    g.fillStyle = k % 2 ? '#2f9a3c' : '#37a845';
    g.fillRect(X(-SIDELINE_X), Z(GOAL_LINE_Z + k * 5 * YD), 2 * SIDELINE_X * ppm, 5 * YD * ppm + 1);
  }
  for (let i = 0; i < 24000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
    g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
  }
  // End zone, painted, with the home wordmark across it.
  g.fillStyle = '#173b8f';
  g.fillRect(X(-SIDELINE_X), Z(0), 2 * SIDELINE_X * ppm, GOAL_LINE_Z * ppm);
  g.save();
  g.translate(X(0), Z(GOAL_LINE_Z / 2));
  g.font = 'italic 900 ' + Math.round(5.2 * ppm) + 'px "Arial Black", Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 0.35 * ppm;
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#c8262c';
  g.strokeText('KICKERS', 0, 0);
  g.fillText('KICKERS', 0, 0);
  g.restore();

  const white = 'rgba(250,252,250,0.95)';
  g.fillStyle = white;
  const rect = (x0: number, z0: number, x1: number, z1: number) => g.fillRect(X(x0), Z(z0), (x1 - x0) * ppm, (z1 - z0) * ppm);
  // The 6-foot border round the field, and the goal line.
  const border = 1.83;
  rect(-SIDELINE_X - border, -border, -SIDELINE_X, PITCH_MAX_Z);
  rect(SIDELINE_X, -border, SIDELINE_X + border, PITCH_MAX_Z);
  rect(-SIDELINE_X, -border, SIDELINE_X, 0);
  rect(-SIDELINE_X, GOAL_LINE_Z - 0.1, SIDELINE_X, GOAL_LINE_Z + 0.1);
  // Yard lines, hash marks and the yard numbers.
  g.font = 'bold ' + Math.round(1.83 * ppm) + 'px "Arial Black", Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let yd = 1; GOAL_LINE_Z + yd * YD < PITCH_MAX_Z; yd++) {
    const z = GOAL_LINE_Z + yd * YD;
    if (yd % 5 === 0) rect(-SIDELINE_X, z - 0.05, SIDELINE_X, z + 0.05);
    else {
      for (const sx of [-1, 1]) {
        rect(sx * HASH_X - 0.3, z - 0.05, sx * HASH_X + 0.3, z + 0.05);
        rect(sx > 0 ? SIDELINE_X - 0.61 : -SIDELINE_X, z - 0.05, sx > 0 ? SIDELINE_X : -SIDELINE_X + 0.61, z + 0.05);
      }
    }
    if (yd % 10 === 0) {
      const label = String(yd <= 50 ? yd : 100 - yd).split('').join(' ');
      for (const sx of [-1, 1]) {
        // Read from the sideline: the bottom of the digits toward it.
        g.save();
        g.translate(X(sx * (SIDELINE_X - 8.23 + 0.92)), Z(z));
        g.rotate(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        g.fillText(label, 0, 0);
        g.restore();
      }
    }
  }
  // Midfield logo.
  g.strokeStyle = white;
  g.lineWidth = 0.3 * ppm;
  g.beginPath();
  g.arc(X(0), Z(GOAL_LINE_Z + 50 * YD), 3.2 * ppm, 0, Math.PI * 2);
  g.stroke();
  const tex = texture(c);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,245,1)');
  grad.addColorStop(0.2, 'rgba(255,250,225,0.65)');
  grad.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return texture(c);
}

function netTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#fff';
  g.lineWidth = 4;
  g.strokeRect(0, 0, 64, 64);
  return texture(c, true);
}

export interface Stadium {
  /** The wind (m/s): the corner flags stream with it. */
  setWind(w: { x: number; z: number }): void;
  /** Flags flutter (world time, s). */
  flutter(time: number): void;
  /** Where the ball is (each frame): the back netting wraps round it while it's pressed in, and springs back when it lets go. */
  pressNet(x: number, y: number, z: number): void;
  update(dt: number): void;
  /** How excited the crowd is (0 … 1); it eases there and calms back down. */
  cheer(level: number): void;
  /** What the big screens show: header, main line, footer. */
  setScreens(lines: [string, string, string]): void;
  /** Show or hide the soccer goal and net (field goals use their own posts). */
  setSoccerGoal(on: boolean): void;
  /** A soccer ground or an American football stadium: the field, the crowd and how it's dressed. */
  setTheme(theme: CrowdTheme): void;
}

interface StandSpec {
  length: number;
  front: THREE.Vector3;
  rotY: number;
  colors: [string, string];
  /** Big screen on the roof fascia */
  screen: boolean;
}

/** A plane from (x0, y0, z0) to (x1, y1, z1) in a stand's local frame (x along the stand, z away from the pitch). */
function slab(length: number, y0: number, z0: number, y1: number, z1: number, mat: THREE.Material): THREE.Mesh {
  const depth = Math.hypot(y1 - y0, z1 - z0);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(length, depth), mat);
  m.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2);
  // Plane's y runs up the slab; its face (z) points up and toward the pitch.
  const up = new THREE.Vector3(0, y1 - y0, z1 - z0).normalize();
  const face = new THREE.Vector3(0, up.z, -up.y);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, face), up, face));
  return m;
}

/** Height of the tier surface `z` metres back from a stand's front (its local frame). */
function tierY(z: number): number {
  return z <= 12 ? 1.4 + (z * 7.6) / 12 : 11 + ((z - 12.5) * 9) / 12.5;
}

/**
 * A two-tier stand. Its local frame: x along the stand, +z away from the pitch;
 * placed with its front edge at `front` and turned by `rotY`. Dressed with the
 * stadium name on the tier front, fan banners on the wall, flags in the
 * front rows, and maybe a big screen; flash points go into `flashes`.
 */
function stand(scene: THREE.Scene, spec: StandSpec, flashes: THREE.Vector3[], screens: Screen[]): (theme: CrowdTheme) => void {
  const { length, colors } = spec;
  const group = new THREE.Group();
  const tiers = (theme: CrowdTheme) =>
    [0, 1].map(() => {
      const t = crowdTexture(colors[0], colors[1], theme);
      t.repeat.set(length / 16, 1.6);
      return t;
    });
  const maps = { soccer: tiers('soccer'), football: tiers('football') };
  const lowerMat = crowdMaterial(maps.soccer[0], 0xc4cad4);
  const upperMat = crowdMaterial(maps.soccer[1], 0xb0b6c0);
  const concrete = new THREE.MeshLambertMaterial({ color: 0x4a505a });
  group.add(slab(length, 1.4, 0, 9, 12, lowerMat));
  group.add(slab(length, 11, 12.5, 20, 25, upperMat));
  const soccer = new THREE.Group();
  const gridiron = new THREE.Group();
  gridiron.visible = false;
  group.add(soccer, gridiron);
  // Front wall, the tier front with the stadium's name, and the back wall.
  group.add(slab(length, 0, 0, 1.4, 0, concrete));
  group.add(slab(length, 9, 12, 11, 12.5, fascia(length)));
  group.add(slab(length, 20, 25, 24, 25.5, concrete));
  // Fan banners hung on the front wall, between the advertising.
  for (const theme of ['soccer', 'football'] as const) {
    const pick = Math.floor(Math.random() * 8);
    for (let k = 0; k < 4; k++) {
      const b = banner(k % 2 ? [colors[1], colors[0]] : colors, pick + k, 7, theme);
      b.position.set((k - 1.5) * (length / 5) + (Math.random() - 0.5) * 6, 0.72, -0.03);
      b.rotation.y = Math.PI;
      (theme === 'soccer' ? soccer : gridiron).add(b);
    }
  }
  // Football: towels twirled over heads in the front rows.
  for (let k = 0; k < 16; k++) {
    const z = 1 + Math.random() * 9;
    const t = towel(Math.random() < 0.6 ? '#f4f1ea' : '#ffd23f');
    t.position.set((Math.random() - 0.5) * (length - 12), tierY(z) + 1.75, z);
    gridiron.add(t);
  }
  // Flags waving in the front rows of both tiers.
  for (let k = 0; k < 7; k++) {
    const z = 1 + Math.random() * 4;
    const f = flag(Math.random() < 0.5 ? colors : [colors[1], colors[0]], k, 1.3 + Math.random() * 0.6);
    f.position.set((Math.random() - 0.5) * (length - 20), tierY(z) + 0.3, z);
    f.rotation.y = Math.PI + (Math.random() - 0.5) * 0.6;
    soccer.add(f);
  }
  for (let k = 0; k < 3; k++) {
    const z = 13.5 + Math.random() * 3;
    const f = flag(colors, k + 1, 2.2);
    f.position.set((Math.random() - 0.5) * (length - 30), tierY(z) + 0.3, z);
    f.rotation.y = Math.PI;
    soccer.add(f);
  }
  // Roof with a strip of lights along its front edge.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(length, 0.6, 22), new THREE.MeshLambertMaterial({ color: 0x2b2f36 }));
  roof.position.set(0, 24.5, 15);
  roof.rotation.x = -0.06;
  group.add(roof);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(length, 0.35, 0.2), new THREE.MeshBasicMaterial({ color: 0xfff6dc }));
  strip.position.set(0, 23.8, 4.1);
  group.add(strip);
  for (let x = -length / 2 + 10; x < length / 2; x += 20) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 13, 6), concrete);
    col.position.set(x, 17.5, 24.5);
    group.add(col);
  }
  if (spec.screen) {
    const screen = new Screen(14);
    screen.mesh.position.set(length * 0.18, 19.4, 4.4);
    screen.mesh.rotation.y = Math.PI;
    group.add(screen.mesh);
    screens.push(screen);
  }
  group.position.copy(spec.front);
  group.rotation.y = spec.rotY;
  scene.add(group);
  group.updateMatrixWorld(true);
  for (let k = 0; k < 90; k++) {
    const z = Math.random() < 0.6 ? Math.random() * 12 : 12.5 + Math.random() * 12.5;
    flashes.push(new THREE.Vector3((Math.random() - 0.5) * length, tierY(z) + 0.6, z).applyMatrix4(group.matrixWorld));
  }
  return (theme) => {
    soccer.visible = theme === 'soccer';
    gridiron.visible = theme === 'football';
    lowerMat.map = maps[theme][0];
    upperMat.map = maps[theme][1];
  };
}

/** The four floodlight towers (x, z); the lamps are 41 m up. */
export const FLOODLIGHTS: [number, number][] = [
  [-52, -12],
  [52, -12],
  [-52, 70],
  [52, 70],
];

function floodlight(scene: THREE.Scene, x: number, z: number, glow: THREE.Texture): void {
  const steel = new THREE.MeshLambertMaterial({ color: 0x6b7280 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 40, 8), steel);
  pole.position.set(x, 20, z);
  scene.add(pole);
  const panel = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(7, 4.5, 0.6), steel);
  panel.add(frame);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12), lampMat);
      lamp.position.set(-2.4 + i * 1.6, -1.3 + j * 1.3, 0.31);
      panel.add(lamp);
    }
  }
  panel.position.set(x, 41, z);
  panel.lookAt(0, 0, 25);
  scene.add(panel);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glow, color: 0xfff2d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  sprite.scale.set(22, 22, 1);
  sprite.position.set(x, 41, z).lerp(new THREE.Vector3(0, 0, 25), 0.02);
  scene.add(sprite);
}

/** A corner flag; its cloth (the child named 'cloth') swings round the pole with the wind. */
function cornerFlag(x: number, z: number): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  pole.position.set(0, 0.75, 0);
  const geo = new THREE.PlaneGeometry(0.5, 0.35, 4, 1);
  geo.translate(0.25, 0, 0);
  const cloth = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xffd23f, side: THREE.DoubleSide }));
  cloth.name = 'cloth';
  cloth.position.set(0, 1.3, 0);
  cloth.rotation.y = x > 0 ? Math.PI : 0;
  group.add(pole, cloth);
  return group;
}

/** The orange pylons at the corners of the end zone. */
function pylons(): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.1, 0.46, 0.1);
  const mat = new THREE.MeshLambertMaterial({ color: 0xff6a13 });
  for (const sx of [-1, 1]) {
    for (const z of [0, GOAL_LINE_Z]) {
      const p = new THREE.Mesh(geo, mat);
      p.position.set(sx * (SIDELINE_X + 0.05), 0.23, z);
      group.add(p);
    }
  }
  group.visible = false;
  return group;
}

export function buildStadium(scene: THREE.Scene, maxAnisotropy: number): Stadium {
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_HALF_W * 2, PITCH_MAX_Z - PITCH_MIN_Z),
    new THREE.MeshLambertMaterial({ map: pitchTexture(maxAnisotropy) }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.z = (PITCH_MIN_Z + PITCH_MAX_Z) / 2;
  scene.add(pitch);
  const gridiron = new THREE.Mesh(pitch.geometry, new THREE.MeshLambertMaterial({ map: footballTexture(maxAnisotropy) }));
  gridiron.rotation.copy(pitch.rotation);
  gridiron.position.copy(pitch.position);
  gridiron.visible = false;
  scene.add(gridiron);
  const endZone = pylons();
  scene.add(endZone);

  const apron = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshLambertMaterial({ color: 0x21662c }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, -0.02, 25);
  scene.add(apron);

  // Rotating LED boards round the end of the pitch and down both touchlines.
  const led = new LedBoards();
  scene.add(led.board(new THREE.Vector3(-30, 0, -4.6), new THREE.Vector3(30, 0, -4.6), 0));
  scene.add(led.board(new THREE.Vector3(-36, 0, 64), new THREE.Vector3(-36, 0, -2), 3));
  scene.add(led.board(new THREE.Vector3(36, 0, -2), new THREE.Vector3(36, 0, 64), 5));

  // Long enough to run into each other at the corners, closing the bowl.
  // Home (blue) behind the goal and down one side; away (red) opposite.
  const flashPoints: THREE.Vector3[] = [];
  const screens: Screen[] = [];
  const HOME: [string, string] = ['#1f4fbf', '#ffffff'];
  const AWAY: [string, string] = ['#c8262c', '#ffffff'];
  const themes = [
    stand(scene, { length: 150, front: new THREE.Vector3(0, 0, -8), rotY: Math.PI, colors: HOME, screen: true }, flashPoints, screens),
    stand(scene, { length: 150, front: new THREE.Vector3(0, 0, 66), rotY: 0, colors: AWAY, screen: true }, flashPoints, screens),
    stand(scene, { length: 126, front: new THREE.Vector3(-40, 0, 29), rotY: -Math.PI / 2, colors: HOME, screen: false }, flashPoints, screens),
    stand(scene, { length: 126, front: new THREE.Vector3(40, 0, 29), rotY: Math.PI / 2, colors: AWAY, screen: false }, flashPoints, screens),
  ];
  const flashes = new Flashes(flashPoints);
  scene.add(flashes.points);
  let excite = 0;
  let exciteTarget = 0;

  const glow = glowTexture();
  for (const [x, z] of FLOODLIGHTS) floodlight(scene, x, z, glow);
  const corners = [cornerFlag(-TOUCHLINE_X, 0), cornerFlag(TOUCHLINE_X, 0)];
  scene.add(...corners);

  // Goal frame (hidden for field goals).
  const goal = new THREE.Group();
  scene.add(goal);
  const white = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 40 });
  const postGeo = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, BAR_Y + POST_RADIUS, 20);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, white);
    post.position.set(sx * POST_X, (BAR_Y + POST_RADIUS) / 2, 0);
    goal.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, 2 * POST_X + 2 * POST_RADIUS, 20), white);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, BAR_Y, 0);
  goal.add(bar);
  const tubeMat = new THREE.MeshLambertMaterial({ color: 0xdadfe4 });
  const tube = (a: THREE.Vector3, b: THREE.Vector3) => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 8), tubeMat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    goal.add(m);
  };
  for (const sx of [-1, 1]) {
    tube(new THREE.Vector3(sx * POST_X, BAR_Y, 0), new THREE.Vector3(sx * GOAL_HALF_WIDTH, GOAL_HEIGHT, -NET_DEPTH));
    tube(new THREE.Vector3(sx * GOAL_HALF_WIDTH, GOAL_HEIGHT, -NET_DEPTH), new THREE.Vector3(sx * GOAL_HALF_WIDTH, 0, -NET_DEPTH));
  }
  tube(new THREE.Vector3(-GOAL_HALF_WIDTH, GOAL_HEIGHT, -NET_DEPTH), new THREE.Vector3(GOAL_HALF_WIDTH, GOAL_HEIGHT, -NET_DEPTH));

  // Net: alpha-mapped planes; the back one bulges round the ball and wobbles back.
  const netAlpha = netTexture();
  const netMat = (rx: number, ry: number) => {
    const alphaMap = netAlpha.clone();
    alphaMap.repeat.set(rx, ry);
    alphaMap.needsUpdate = true;
    return new THREE.MeshBasicMaterial({
      color: 0xd4d8dc,
      alphaMap,
      transparent: true,
      opacity: 0.7,
      alphaTest: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  };
  const cell = 0.12;
  const w = 2 * GOAL_HALF_WIDTH;
  const backGeo = new THREE.PlaneGeometry(w, GOAL_HEIGHT, 36, 12);
  const back = new THREE.Mesh(backGeo, netMat(w / cell, GOAL_HEIGHT / cell));
  back.position.set(0, GOAL_HEIGHT / 2, -NET_DEPTH);
  goal.add(back);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(w, NET_DEPTH), netMat(w / cell, NET_DEPTH / cell));
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(0, GOAL_HEIGHT, -NET_DEPTH / 2);
  goal.add(roof);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(NET_DEPTH, GOAL_HEIGHT), netMat(NET_DEPTH / cell, GOAL_HEIGHT / cell));
    side.rotation.y = Math.PI / 2;
    side.position.set(sx * GOAL_HALF_WIDTH, GOAL_HEIGHT / 2, -NET_DEPTH / 2);
    goal.add(side);
  }

  const pos = backGeo.attributes.position as THREE.BufferAttribute;
  const rest = Float32Array.from(pos.array as Float32Array);
  // The bulge: where the ball pressed in (in the back net's own frame), how
  // deep it's pressed now, and how deep the net is shown (following the ball
  // in, springing back with a wobble when it lets go).
  const press = { x: 0, y: 0, depth: 0 };
  let bulge = 0;
  let bulgeVel = 0;
  let flat = true;
  const netBack = -NET_DEPTH + BALL_RADIUS;
  // The netting is held at its edges (looser at the bottom, where it's pegged out on the grass).
  const hold = (x: number, y: number) =>
    Math.min(1, Math.max(0, (w / 2 - Math.abs(x)) / 0.7)) *
    Math.min(1, Math.max(0, (GOAL_HEIGHT / 2 - y) / 0.5)) *
    (0.45 + 0.55 * Math.min(1, Math.max(0, (y + GOAL_HEIGHT / 2) / 0.6)));
  const wind = new THREE.Vector3();
  const cloths = corners.map((c) => c.getObjectByName('cloth') as THREE.Mesh);
  const clothRest = Float32Array.from(cloths[0].geometry.attributes.position.array as Float32Array);
  return {
    setWind(w) {
      wind.set(w.x, 0, w.z);
    },
    flutter(time) {
      // Streaming downwind (hanging limp in a calm), rippling quicker the harder it blows.
      const speed = wind.length();
      const droop = Math.max(0, 1 - speed / 5);
      cloths.forEach((cloth, i) => {
        if (speed > 0.1) cloth.rotation.y = Math.atan2(-wind.z, wind.x);
        const pos = cloth.geometry.attributes.position as THREE.BufferAttribute;
        for (let v = 0; v < pos.count; v++) {
          const u = clothRest[3 * v] / 0.5;
          pos.setXYZ(
            v,
            clothRest[3 * v] * (1 - 0.5 * droop),
            clothRest[3 * v + 1] - u * droop * 0.22,
            u * (0.04 + 0.02 * speed) * Math.sin(time * (5 + speed * 1.5) - u * 4 + i),
          );
        }
        pos.needsUpdate = true;
      });
    },
    pressNet(x, y, z) {
      const depth = Math.max(0, netBack - z);
      if (depth > 0) {
        press.x = x;
        press.y = y - GOAL_HEIGHT / 2;
      }
      press.depth = depth;
    },
    cheer(level) {
      exciteTarget = level;
    },
    setSoccerGoal(on) {
      goal.visible = on;
    },
    setTheme(theme) {
      const fb = theme === 'football';
      pitch.visible = !fb;
      gridiron.visible = fb;
      endZone.visible = fb;
      for (const c of corners) c.visible = !fb;
      for (const set of themes) set(theme);
    },
    setScreens(lines) {
      for (const sc of screens) sc.show(lines);
    },
    update(dt) {
      crowdTime.value += dt;
      // Rises fast, calms slowly; the target itself decays back to a murmur.
      excite += (exciteTarget - excite) * (1 - Math.exp(-dt * (exciteTarget > excite ? 6 : 0.8)));
      exciteTarget = Math.max(0, exciteTarget - dt * 0.12);
      crowdExcite.value = excite;
      flashes.update(dt);
      led.update(crowdTime.value);
      if (press.depth >= bulge) {
        // Pressed in: the net is wherever the back of the ball is.
        bulgeVel = dt > 0 ? (press.depth - bulge) / dt : 0;
        bulge = press.depth;
      } else {
        // Let go: it springs back, overshooting a little.
        const w0 = 20;
        for (let left = dt; left > 1e-6; left -= 1 / 240) {
          const h = Math.min(left, 1 / 240);
          bulgeVel += (w0 * w0 * (press.depth - bulge) - 2 * 0.22 * w0 * bulgeVel) * h;
          bulge += bulgeVel * h;
        }
      }
      if (Math.abs(bulge) < 1e-4 && Math.abs(bulgeVel) < 1e-3) {
        if (flat) return;
        bulge = 0;
        bulgeVel = 0;
      }
      flat = bulge === 0;
      // Wrapped round the ball: as deep as it's pressed right behind it, easing off around it to the frame.
      const scale = bulge / Math.max(0.2, hold(press.x, press.y));
      for (let i = 0; i < pos.count; i++) {
        const dx = rest[3 * i] - press.x;
        const dy = rest[3 * i + 1] - press.y;
        pos.setZ(i, -scale * hold(rest[3 * i], rest[3 * i + 1]) * Math.exp(-(dx * dx + dy * dy) / 0.22));
      }
      pos.needsUpdate = true;
    },
  };
}
