// The match ball: a proper 32-panel ball, 12 black pentagons and 20 white
// hexagons (a truncated icosahedron, puffed out onto the sphere), each panel
// pulled in a touch from its neighbours so the stitched seams show dark
// between them.

import * as THREE from 'three';

const PHI = (1 + Math.sqrt(5)) / 2;

/** Each panel shrinks toward its centre by this much, leaving a seam. */
const SEAM = 0.045;
/** How finely each panel's triangles are cut (so it curves with the sphere). */
const SUBDIV = 3;

function icosahedron(): { verts: THREE.Vector3[]; faces: [number, number, number][] } {
  const verts: THREE.Vector3[] = [];
  for (const a of [-1, 1]) {
    for (const b of [-PHI, PHI]) {
      verts.push(new THREE.Vector3(0, a, b), new THREE.Vector3(a, b, 0), new THREE.Vector3(b, 0, a));
    }
  }
  const near = (i: number, k: number) => Math.abs(verts[i].distanceTo(verts[k]) - 2) < 1e-6;
  const faces: [number, number, number][] = [];
  for (let i = 0; i < 12; i++)
    for (let k = i + 1; k < 12; k++)
      for (let m = k + 1; m < 12; m++) if (near(i, k) && near(k, m) && near(i, m)) faces.push([i, k, m]);
  return { verts, faces };
}

/** The 32 panels as polygons on the unit sphere's polyhedron, with whether each is a pentagon. */
function panels(): { pts: THREE.Vector3[]; penta: boolean }[] {
  const { verts, faces } = icosahedron();
  const third = (a: THREE.Vector3, b: THREE.Vector3) => a.clone().lerp(b, 1 / 3);
  const out: { pts: THREE.Vector3[]; penta: boolean }[] = [];
  // Pentagons: round each corner of the icosahedron, a third of the way along its five edges.
  verts.forEach((v, i) => {
    const ring = verts.filter((w, k) => k !== i && Math.abs(v.distanceTo(w) - 2) < 1e-6).map((w) => third(v, w));
    const n = v.clone().normalize();
    const u = ring[0].clone().sub(v).normalize();
    const w = new THREE.Vector3().crossVectors(n, u);
    ring.sort((p, q) => Math.atan2(p.clone().sub(v).dot(w), p.clone().sub(v).dot(u)) - Math.atan2(q.clone().sub(v).dot(w), q.clone().sub(v).dot(u)));
    out.push({ pts: ring, penta: true });
  });
  // Hexagons: what's left of each triangular face.
  for (const [a, b, c] of faces) {
    const [A, B, C] = [verts[a], verts[b], verts[c]];
    const pts = [third(A, B), third(B, A), third(B, C), third(C, B), third(C, A), third(A, C)];
    out.push({ pts, penta: false });
  }
  return out;
}

export function soccerBall(radius: number): THREE.Group {
  const pos: number[] = [];
  const col: number[] = [];
  const white = new THREE.Color(0xf4f4f0);
  const black = new THREE.Color(0x141618);
  const push = (p: THREE.Vector3, c: THREE.Color) => {
    const s = p.clone().normalize().multiplyScalar(radius);
    pos.push(s.x, s.y, s.z);
    col.push(c.r, c.g, c.b);
  };
  for (const { pts, penta } of panels()) {
    const centre = pts.reduce((m, p) => m.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const shrunk = pts.map((p) => p.clone().lerp(centre, SEAM));
    const c = penta ? black : white;
    for (let e = 0; e < shrunk.length; e++) {
      const a = shrunk[e];
      const b = shrunk[(e + 1) % shrunk.length];
      // Subdivide the fan triangle (centre, a, b) so it bends with the sphere.
      const at = (i: number, k: number) => centre.clone().addScaledVector(a.clone().sub(centre), i / SUBDIV).addScaledVector(b.clone().sub(a), k / SUBDIV);
      for (let i = 0; i < SUBDIV; i++) {
        for (let k = 0; k <= i; k++) {
          push(at(i, k), c);
          push(at(i + 1, k), c);
          push(at(i + 1, k + 1), c);
          if (k < i) {
            push(at(i, k), c);
            push(at(i + 1, k + 1), c);
            push(at(i, k + 1), c);
          }
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  // Smooth shading over the whole ball: normals straight out from the centre.
  const n = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) {
    const v = new THREE.Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  const ball = new THREE.Group();
  ball.add(new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80, specular: 0x666666, side: THREE.DoubleSide })));
  // The seams: a slightly smaller grey ball showing in the gaps between panels.
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 0.985, 20, 14), new THREE.MeshPhongMaterial({ color: 0x55585e, shininess: 10 })));
  return ball;
}
