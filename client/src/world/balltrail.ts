// A streak behind the ball in flight (field goals): a ribbon through where it
// has just been, facing the camera, brightest at the ball and fading back
// along the path and with age, so a kick stays easy to follow as it climbs
// away into the night sky.

import * as THREE from 'three';

/** How many points the ribbon holds, and how long each one lasts, s. */
const POINTS = 40;
const LIFE = 0.6;

export class BallTrail {
  readonly mesh: THREE.Mesh;
  private readonly pts: { p: THREE.Vector3; t: number }[] = [];
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  /** Half the ribbon's width at the ball, m (scaled up with the ball when it's far away). */
  width = 0.07;

  constructor(color = new THREE.Color(0xfff1c8)) {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(POINTS * 2 * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(POINTS * 2 * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('color', this.col);
    const index: number[] = [];
    for (let i = 0; i < POINTS - 1; i++) {
      const a = 2 * i;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(
      geo,
      // Additive: it glows (and catches the bloom) without hiding anything behind it.
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.userData.tint = color;
  }

  /** The ball's position now (world time `t`); only moves of a centimetre or more add a point. */
  push(p: THREE.Vector3, t: number): void {
    const last = this.pts[this.pts.length - 1];
    if (last && last.p.distanceToSquared(p) < 1e-4) return;
    this.pts.push({ p: p.clone(), t });
    if (this.pts.length > POINTS) this.pts.shift();
  }

  clear(): void {
    this.pts.length = 0;
    this.mesh.visible = false;
  }

  update(camera: THREE.Camera, now: number): void {
    while (this.pts.length && now - this.pts[0].t > LIFE) this.pts.shift();
    const n = this.pts.length;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    const tint = this.mesh.userData.tint as THREE.Color;
    const eye = camera.position;
    const along = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (let i = 0; i < POINTS; i++) {
      // Unused points collapse onto the oldest one.
      const k = Math.max(0, i - (POINTS - n));
      const { p, t } = this.pts[k];
      const a = this.pts[Math.min(n - 1, k + 1)].p;
      const b = this.pts[Math.max(0, k - 1)].p;
      along.subVectors(a, b);
      side.subVectors(p, eye).cross(along);
      if (side.lengthSq() < 1e-12) side.set(0, 1, 0);
      // Tapering to a point at the tail, fading with age.
      const head = n > 1 ? k / (n - 1) : 1;
      const fade = Math.max(0, 1 - (now - t) / LIFE) * head;
      side.normalize().multiplyScalar(this.width * (0.25 + 0.75 * head));
      this.pos.setXYZ(2 * i, p.x + side.x, p.y + side.y, p.z + side.z);
      this.pos.setXYZ(2 * i + 1, p.x - side.x, p.y - side.y, p.z - side.z);
      const c = fade * fade * 0.9;
      this.col.setXYZ(2 * i, tint.r * c, tint.g * c, tint.b * c);
      this.col.setXYZ(2 * i + 1, tint.r * c, tint.g * c, tint.b * c);
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }
}
