// Debug renderer for the sim: flat pitch, goal frame, capsule bodies, overlays.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  BALL_RADIUS,
  BAR_Y,
  BOX_DEPTH,
  BOX_HALF_WIDTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  KEEPER_Z,
  NET_DEPTH,
  PENALTY_SPOT_Z,
  POST_RADIUS,
  POST_X,
  SIX_DEPTH,
  SIX_HALF_WIDTH,
  WALL_DISTANCE,
  WALL_PLAYER_HEIGHT,
  WALL_PLAYER_RADIUS,
  type KeeperPart,
  type Outcome,
  type Spot,
  type Vec3,
} from '@fk/shared';

export type CameraPreset = 'shooter' | 'keeper' | 'side' | 'top';

const UP = new THREE.Vector3(0, 1, 0);
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
const unitSphere = new THREE.SphereGeometry(1, 16, 12);

class CapsuleMesh {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly capA: THREE.Mesh;
  private readonly capB: THREE.Mesh;

  constructor(material: THREE.Material) {
    this.body = new THREE.Mesh(unitCylinder, material);
    this.capA = new THREE.Mesh(unitSphere, material);
    this.capB = new THREE.Mesh(unitSphere, material);
    for (const m of [this.body, this.capA, this.capB]) m.castShadow = true;
    this.group.add(this.body, this.capA, this.capB);
  }

  set(a: Vec3, b: Vec3, r: number): void {
    const va = new THREE.Vector3(a.x, a.y, a.z);
    const vb = new THREE.Vector3(b.x, b.y, b.z);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    this.body.visible = len > 1e-4;
    if (this.body.visible) {
      this.body.position.copy(va).add(vb).multiplyScalar(0.5);
      this.body.quaternion.setFromUnitVectors(UP, dir.divideScalar(len));
      this.body.scale.set(r, len, r);
    }
    this.capA.position.copy(va);
    this.capB.position.copy(vb);
    this.capA.scale.setScalar(r);
    this.capB.scale.setScalar(r);
  }
}

const OUTCOME_COLORS: Record<Outcome, number> = {
  goal: 0x3ccf6e,
  save: 0xff5b4f,
  blocked: 0x4f9dff,
  miss: 0x8a8f8c,
};

export class HarnessScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly scene = new THREE.Scene();
  private readonly ball: THREE.Mesh;
  private readonly keeper: CapsuleMesh[] = [];
  private readonly keeperMat = new THREE.MeshStandardMaterial({ color: 0xff9a2e, roughness: 0.6 });
  private readonly wallMat = new THREE.MeshStandardMaterial({ color: 0x3b6fd8, roughness: 0.7 });
  private wall: CapsuleMesh[] = [];
  private wallBase: { x: number; z: number }[] = [];
  private readonly trace: THREE.Line;
  private readonly target: THREE.Mesh;
  private readonly crossing: THREE.Mesh;
  private readonly envelope: THREE.Points;
  private readonly wallArc: THREE.Line;
  private readonly heatmap = new THREE.Group();
  private readonly spotMarker: THREE.Mesh;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x10161a);
    this.scene.fog = new THREE.Fog(0x10161a, 60, 120);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x2a3a22, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(12, 25, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 80 });
    this.scene.add(sun);

    this.buildPitch();
    this.buildGoal();

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
    );
    this.ball.castShadow = true;
    this.scene.add(this.ball);

    for (let i = 0; i < 8; i++) {
      const c = new CapsuleMesh(this.keeperMat);
      this.keeper.push(c);
      this.scene.add(c.group);
    }

    this.trace = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffe066 }));
    this.trace.frustumCulled = false;
    this.scene.add(this.trace);

    const ring = new THREE.RingGeometry(0.12, 0.17, 32);
    this.target = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x5ee0ff, side: THREE.DoubleSide }));
    this.crossing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe066, side: THREE.DoubleSide }));
    this.scene.add(this.target, this.crossing);

    this.envelope = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0xff9a2e, size: 0.07, transparent: true, opacity: 0.8 }),
    );
    this.envelope.visible = false;
    this.scene.add(this.envelope);

    this.wallArc = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x3b6fd8, dashSize: 0.3, gapSize: 0.2 }),
    );
    this.scene.add(this.wallArc);
    this.scene.add(this.heatmap);

    this.spotMarker = new THREE.Mesh(
      new THREE.CircleGeometry(0.25, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
    );
    this.spotMarker.rotation.x = -Math.PI / 2;
    this.scene.add(this.spotMarker);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildPitch(): void {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 70, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 1 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.z = 30;
    grass.receiveShadow = true;
    this.scene.add(grass);

    // Mowing stripes, 5 m wide.
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x347f3f, roughness: 1 });
    for (let z = 0; z < 60; z += 10) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(80, 5), stripeMat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(0, 0.002, z + 2.5);
      s.receiveShadow = true;
      this.scene.add(s);
    }

    const pts: number[] = [];
    const seg = (x1: number, z1: number, x2: number, z2: number) => pts.push(x1, 0.01, z1, x2, 0.01, z2);
    seg(-40, 0, 40, 0);
    seg(-BOX_HALF_WIDTH, 0, -BOX_HALF_WIDTH, BOX_DEPTH);
    seg(-BOX_HALF_WIDTH, BOX_DEPTH, BOX_HALF_WIDTH, BOX_DEPTH);
    seg(BOX_HALF_WIDTH, BOX_DEPTH, BOX_HALF_WIDTH, 0);
    seg(-SIX_HALF_WIDTH, 0, -SIX_HALF_WIDTH, SIX_DEPTH);
    seg(-SIX_HALF_WIDTH, SIX_DEPTH, SIX_HALF_WIDTH, SIX_DEPTH);
    seg(SIX_HALF_WIDTH, SIX_DEPTH, SIX_HALF_WIDTH, 0);
    // The "D": arc of 9.15 m around the penalty spot, outside the box.
    const dz = BOX_DEPTH - PENALTY_SPOT_Z;
    const a0 = Math.acos(dz / WALL_DISTANCE);
    for (let i = 0; i < 24; i++) {
      const t1 = -a0 + (2 * a0 * i) / 24;
      const t2 = -a0 + (2 * a0 * (i + 1)) / 24;
      seg(
        WALL_DISTANCE * Math.sin(t1),
        PENALTY_SPOT_Z + WALL_DISTANCE * Math.cos(t1),
        WALL_DISTANCE * Math.sin(t2),
        PENALTY_SPOT_Z + WALL_DISTANCE * Math.cos(t2),
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xeef5ee })));

    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), new THREE.MeshBasicMaterial({ color: 0xeef5ee }));
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, 0.011, PENALTY_SPOT_Z);
    this.scene.add(spot);
  }

  private buildGoal(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.3 });
    const post = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, BAR_Y + POST_RADIUS, 16);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(post, mat);
      m.position.set(sx * POST_X, (BAR_Y + POST_RADIUS) / 2, 0);
      m.castShadow = true;
      this.scene.add(m);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, 2 * POST_X, 16), mat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, BAR_Y, 0);
    bar.castShadow = true;
    this.scene.add(bar);

    // Net as a wire grid.
    const pts: number[] = [];
    const w = GOAL_HALF_WIDTH;
    const h = GOAL_HEIGHT;
    const d = -NET_DEPTH;
    for (let x = -w; x <= w + 1e-6; x += 0.4) pts.push(x, 0, d, x, h, d, x, h, d, x, h, 0);
    for (let y = 0; y <= h + 1e-6; y += 0.4) pts.push(-w, y, d, w, y, d, -w, y, 0, -w, y, d, w, y, 0, w, y, d);
    for (let z = 0; z >= d - 1e-6; z -= 0.4) pts.push(-w, h, z, w, h, z, -w, 0, z, -w, h, z, w, 0, z, w, h, z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.scene.add(
      new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xd8dde0, transparent: true, opacity: 0.35 })),
    );
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setSpot(spot: Spot): void {
    this.spotMarker.position.set(spot.x, 0.012, spot.z);
    // Arc the wall can slide along.
    const pts: THREE.Vector3[] = [];
    const base = Math.atan2(-spot.x, -spot.z);
    for (let i = 0; i <= 40; i++) {
      const a = base - 0.6 + (1.2 * i) / 40;
      pts.push(new THREE.Vector3(spot.x + WALL_DISTANCE * Math.sin(a), 0.02, spot.z + WALL_DISTANCE * Math.cos(a)));
    }
    this.wallArc.geometry.setFromPoints(pts);
    this.wallArc.computeLineDistances();
    this.wallArc.visible = spot.maxWall > 0;
  }

  setWall(players: { x: number; z: number }[]): void {
    while (this.wall.length < players.length) {
      const c = new CapsuleMesh(this.wallMat);
      this.wall.push(c);
      this.scene.add(c.group);
    }
    this.wall.forEach((c, i) => (c.group.visible = i < players.length));
    this.wallBase = players;
    this.setWallJump(0);
  }

  setWallJump(y: number): void {
    const r = WALL_PLAYER_RADIUS;
    this.wallBase.forEach((p, i) =>
      this.wall[i].set({ x: p.x, y: r + y, z: p.z }, { x: p.x, y: WALL_PLAYER_HEIGHT - r + y, z: p.z }, r),
    );
  }

  setBall(p: Vec3): void {
    this.ball.position.set(p.x, p.y, p.z);
  }

  setKeeper(parts: KeeperPart[]): void {
    parts.forEach((part, i) => this.keeper[i].set(part.a, part.b, part.r));
  }

  setTrace(ball: Float64Array | null, color = 0xffe066): void {
    const geo = new THREE.BufferGeometry();
    if (ball) geo.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(ball), 3));
    this.trace.geometry.dispose();
    this.trace.geometry = geo;
    (this.trace.material as THREE.LineBasicMaterial).color.setHex(color);
  }

  setTraceVisible(v: boolean): void {
    this.trace.visible = v;
  }

  setTarget(p: { x: number; y: number } | null): void {
    this.target.visible = !!p;
    if (p) this.target.position.set(p.x, p.y, 0.02);
  }

  setCrossing(p: { x: number; y: number } | null): void {
    this.crossing.visible = !!p;
    if (p) this.crossing.position.set(p.x, p.y, 0.03);
  }

  setEnvelope(points: Vec3[] | null): void {
    this.envelope.visible = !!points;
    if (!points) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, KEEPER_Z + 0.1]), 3));
    this.envelope.geometry.dispose();
    this.envelope.geometry = geo;
  }

  /** Coloured cells on the goal plane, one per aimed target. */
  setHeatmap(cells: { x: number; y: number; w: number; h: number; outcome: Outcome }[] | null): void {
    for (const c of this.heatmap.children) ((c as THREE.Mesh).geometry as THREE.BufferGeometry).dispose();
    this.heatmap.clear();
    if (!cells) return;
    for (const c of cells) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(c.w * 0.94, c.h * 0.94),
        new THREE.MeshBasicMaterial({ color: OUTCOME_COLORS[c.outcome], transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      );
      m.position.set(c.x, c.y, -0.01);
      this.heatmap.add(m);
    }
  }

  cameraPreset(preset: CameraPreset, spot: Spot): void {
    const goal = new THREE.Vector3(0, 1.2, 0);
    const ball = new THREE.Vector3(spot.x, 0, spot.z);
    if (preset === 'shooter') {
      const back = ball.clone().sub(new THREE.Vector3(0, 0, 0)).setY(0).normalize().multiplyScalar(3.2);
      this.camera.position.copy(ball).add(back).setY(1.6);
      this.controls.target.copy(goal);
      this.camera.fov = 40;
    } else if (preset === 'keeper') {
      this.camera.position.set(spot.keeperX, 1.8, -2.2);
      this.controls.target.set(spot.x, 1, spot.z);
      this.camera.fov = 60;
    } else if (preset === 'side') {
      this.camera.position.set(28, 9, spot.z / 2);
      this.controls.target.set(0, 1, spot.z / 2);
      this.camera.fov = 50;
    } else {
      this.camera.position.set(0.01, 45, spot.z / 2 + 0.01);
      this.controls.target.set(0, 0, spot.z / 2);
      this.camera.fov = 50;
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
