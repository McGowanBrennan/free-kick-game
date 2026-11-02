// The broadcast's cable cam: a chunky camera pod slung on four wires from
// the stadium roofs, flying low across the field for the shot, red tally
// light on. Drawn where the sim has it (shared cableCamAt), at the size of
// what the ball collides with (CAM_HALF, CAM_RADIUS).

import * as THREE from 'three';
import { CAM_HALF, CAM_RADIUS, cableCamAt, type CableCam } from '@fk/shared';

/** Where the four wires are anchored, high on the stands. */
const ANCHORS = [
  new THREE.Vector3(-40, 30, -6),
  new THREE.Vector3(40, 30, -6),
  new THREE.Vector3(-40, 30, 72),
  new THREE.Vector3(40, 30, 72),
];

function stripes(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#26292f';
  g.fillRect(0, 0, 64, 32);
  // Yellow and black hazard band round the middle, and the camera's number.
  for (let i = -2; i < 10; i++) {
    g.fillStyle = i % 2 ? '#111' : '#f2c200';
    g.beginPath();
    g.moveTo(i * 8, 12);
    g.lineTo(i * 8 + 8, 12);
    g.lineTo(i * 8 + 12, 20);
    g.lineTo(i * 8 + 4, 20);
    g.fill();
  }
  g.fillStyle = '#e8ecf2';
  g.font = 'bold 9px Arial';
  g.fillText('CAM 7', 2, 9);
  g.fillText('CAM 7', 34, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export class CableCamModel {
  readonly group = new THREE.Group();
  private readonly pod = new THREE.Group();
  private readonly wires: THREE.LineSegments;
  private readonly tally: THREE.Mesh;
  private readonly lens: THREE.Group;
  private cam: CableCam | null = null;

  constructor() {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(CAM_RADIUS, CAM_HALF * 2, 4, 10).rotateZ(Math.PI / 2),
      new THREE.MeshPhongMaterial({ map: stripes(), shininess: 60, specular: 0x444444 }),
    );
    this.pod.add(body);
    // The camera head underneath on its gimbal, looking back up the field at the kicker.
    this.lens = new THREE.Group();
    const dark = new THREE.MeshPhongMaterial({ color: 0x15171b, shininess: 80 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.5), dark);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.3, 10).rotateX(Math.PI / 2), dark);
    barrel.position.z = 0.36;
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12), new THREE.MeshBasicMaterial({ color: 0x5f8cff }));
    glass.position.z = 0.515;
    this.lens.add(head, barrel, glass);
    this.lens.position.y = -CAM_RADIUS - 0.12;
    this.pod.add(this.lens);
    this.tally = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    this.tally.position.set(0, CAM_RADIUS * 0.85, 0.25);
    this.pod.add(this.tally);
    // Little fins either end, so it reads as a flying thing.
    for (const sx of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.36), dark);
      fin.position.set(sx * (CAM_HALF + CAM_RADIUS * 0.7), 0.25, -0.1);
      this.pod.add(fin);
    }
    this.group.add(this.pod);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ANCHORS.length * 6), 3));
    this.wires = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x0c0d10 }));
    this.wires.frustumCulled = false;
    this.group.add(this.wires);
    this.group.visible = false;
  }

  set(cam: CableCam | null): void {
    this.cam = cam;
    this.group.visible = !!cam;
  }

  /** Where it is `t` seconds into the round; `clock` is wall time, for the blinking light. */
  pose(t: number, clock: number): void {
    const cam = this.cam;
    if (!cam) return;
    const p = cableCamAt(cam, t);
    const ahead = cableCamAt(cam, t + 0.05);
    this.pod.position.set(p.x, p.y, p.z);
    // Leans into the swing a little.
    this.pod.rotation.z = THREE.MathUtils.clamp((ahead.x - p.x) * -0.6, -0.25, 0.25);
    this.lens.rotation.y = Math.sin(clock * 0.7) * 0.25;
    this.tally.visible = Math.floor(clock * 2) % 2 === 0;
    const pos = this.wires.geometry.getAttribute('position') as THREE.BufferAttribute;
    ANCHORS.forEach((a, i) => {
      pos.setXYZ(2 * i, p.x + Math.sign(a.x) * CAM_HALF, p.y + CAM_RADIUS * 0.8, p.z + Math.sign(a.z - p.z) * 0.2);
      pos.setXYZ(2 * i + 1, a.x, a.y, a.z);
    });
    pos.needsUpdate = true;
  }
}
