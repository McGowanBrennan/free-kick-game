// Field goal posts: a yellow gooseneck, crossbar and uprights (to the same
// measurements as the sim), with ribbons on top that stream in the wind, and
// the American football.

import * as THREE from 'three';
import { FG_BAR_Y, FG_HALF_WIDTH, FG_NECK_Z, FG_POST_RADIUS, FG_UPRIGHT_TOP, NECK_ARM_Y, type Vec3 } from '@fk/shared';

const YELLOW = 0xf2c200;

export class FieldGoalPosts {
  readonly group = new THREE.Group();
  private readonly ribbons: THREE.Mesh[] = [];
  private wind = new THREE.Vector3();

  constructor() {
    const paint = new THREE.MeshPhongMaterial({ color: YELLOW, shininess: 50 });
    const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 14), paint);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      this.group.add(m);
    };
    const x = FG_HALF_WIDTH + FG_POST_RADIUS;
    rod(new THREE.Vector3(0, 0, FG_NECK_Z), new THREE.Vector3(0, NECK_ARM_Y, FG_NECK_Z), 0.1);
    rod(new THREE.Vector3(0, NECK_ARM_Y, FG_NECK_Z), new THREE.Vector3(0, NECK_ARM_Y, 0), 0.1);
    rod(new THREE.Vector3(0, NECK_ARM_Y, 0), new THREE.Vector3(0, FG_BAR_Y, 0), 0.08);
    rod(new THREE.Vector3(-x, FG_BAR_Y, 0), new THREE.Vector3(x, FG_BAR_Y, 0), FG_POST_RADIUS);
    for (const sx of [-1, 1]) rod(new THREE.Vector3(sx * x, FG_BAR_Y, 0), new THREE.Vector3(sx * x, FG_UPRIGHT_TOP, 0), FG_POST_RADIUS);
    // Padding round the base of the gooseneck.
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 16), new THREE.MeshLambertMaterial({ color: 0x1f4fbf }));
    pad.position.set(0, 0.9, FG_NECK_Z);
    this.group.add(pad);
    // Wind ribbons: hang from the top of each upright, stream out downwind.
    const ribbonGeo = new THREE.PlaneGeometry(0.16, 1.4, 1, 8);
    ribbonGeo.translate(0, -0.7, 0);
    const ribbonMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      const r = new THREE.Mesh(ribbonGeo, ribbonMat);
      r.position.set(sx * x, FG_UPRIGHT_TOP, 0);
      this.group.add(r);
      this.ribbons.push(r);
    }
    this.group.visible = false;
  }

  setWind(w: Vec3): void {
    this.wind.set(w.x, 0, w.z);
  }

  /** Ribbons stream downwind, lifting further the stronger it blows, and flutter. */
  update(time: number): void {
    const speed = this.wind.length();
    const lift = Math.min(1.35, 0.15 + speed * 0.17);
    const heading = Math.atan2(this.wind.x, this.wind.z);
    this.ribbons.forEach((r, i) => {
      r.rotation.set(0, 0, 0);
      r.rotateY(heading);
      r.rotateX(-lift + Math.sin(time * (6 + speed) + i) * 0.08);
    });
  }
}

/** An American football: a brown leather spheroid with white laces and stripes; long axis along local y. */
export function football(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6b3a1e';
  g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,220,180,0.06)';
    g.fillRect(Math.random() * 256, Math.random() * 128, 2, 2);
  }
  // Stripes near each end (top and bottom of the texture are the tips).
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 14, 256, 6);
  g.fillRect(0, 108, 256, 6);
  // Laces down one side (u = 0.25 faces +z).
  g.fillRect(60, 40, 8, 48);
  for (let y = 44; y < 88; y += 7) g.fillRect(52, y, 24, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // A touch of glow so it doesn't sink into the dark of the stands and the night sky.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshPhongMaterial({ map: tex, shininess: 25, emissive: 0x6a3c1c }));
  // 28 cm long, 17 cm across.
  mesh.scale.set(0.085, 0.14, 0.085);
  return mesh;
}
