// Floodlight shadows the way the PS2 sports games drew them: no shadow maps,
// just a soft dark smudge thrown away from each of the four towers, crossing
// under the feet. Cheap, and exactly the look.

import * as THREE from 'three';
import { FLOODLIGHTS } from './pitch';

let material: THREE.MeshBasicMaterial | null = null;
let geometry: THREE.PlaneGeometry | null = null;

function smudge(): THREE.MeshBasicMaterial {
  if (material) return material;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  material = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  });
  return material;
}

const LIGHTS = FLOODLIGHTS.map(([x, z]) => new THREE.Vector2(x, z));

export class BlobShadows {
  readonly group = new THREE.Group();
  private readonly blobs: THREE.Mesh[] = [];

  /** `length` and `width` of each smudge at ground level, metres; `strength` is its opacity. */
  constructor(
    private readonly length: number,
    private readonly width: number,
    strength: number,
  ) {
    geometry ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < LIGHTS.length; i++) {
      const mat = smudge().clone();
      mat.opacity = strength;
      const m = new THREE.Mesh(geometry, mat);
      m.renderOrder = 1;
      this.blobs.push(m);
      this.group.add(m);
    }
  }

  /** Under a point on the ground, `height` metres above it (the smudges spread and fade as it rises). */
  place(x: number, z: number, height: number, strength = 1): void {
    const lift = Math.max(0, height);
    const fade = Math.max(0, 1 - lift / 4) * strength;
    const spread = 1 + lift * 0.25;
    for (let i = 0; i < this.blobs.length; i++) {
      const m = this.blobs[i];
      const dx = x - LIGHTS[i].x;
      const dz = z - LIGHTS[i].y;
      const d = Math.hypot(dx, dz) || 1;
      const ux = dx / d;
      const uz = dz / d;
      // Thrown away from the tower, starting under the feet (and sliding off as it rises).
      const off = this.length * 0.35 + lift * 0.6;
      m.position.set(x + ux * off, 0.02, z + uz * off);
      m.rotation.y = Math.atan2(ux, uz);
      m.scale.set(this.width * spread, 1, this.length * spread);
      m.visible = fade > 0.01;
      (m.material as THREE.MeshBasicMaterial).opacity = (m.userData.base ??= (m.material as THREE.MeshBasicMaterial).opacity) * fade;
    }
  }
}
