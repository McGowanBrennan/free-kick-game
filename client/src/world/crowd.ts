// The supporters: a pixel crowd that bobs and jumps (more when they're
// excited), waving flags, fan banners on the stand fronts, and camera flashes
// when something happens. Everything animates from two shared uniforms.

import * as THREE from 'three';

/** Seconds, and how excited the crowd is (0 idle … 1 a goal). */
export const crowdTime = { value: 0 };
export const crowdExcite = { value: 0 };

/** The crowd texture's grid: people per row and rows, which the bob shader relies on. */
const COLS = 64;
const ROWS = 16;

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

export type CrowdTheme = 'soccer' | 'football';

/**
 * A tier of supporters, one person per 8 × 16 px cell. Soccer: mostly dark and
 * neutral clothes with the home colours in clumps, scarves held up, and the
 * odd flag draped over the seats. Football: whole sections in team jerseys,
 * towels and foam fingers in the air, and hand-made signs held up.
 */
export function crowdTexture(home: string, second: string, theme: CrowdTheme = 'soccer'): THREE.CanvasTexture {
  const fb = theme === 'football';
  const W = COLS * 8;
  const H = ROWS * 16;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#15181e';
  g.fillRect(0, 0, W, H);
  const neutral = ['#2a2d33', '#3a3d44', '#4b4f57', '#5e6168', '#23262c', '#6f6a62', '#8b8d92', '#d9d9d6', '#6b2a2a', '#2a3f6b'];
  const skins = ['#d7ab86', '#c4936a', '#a06f4a', '#6e4b31'];
  const hair = ['#1a120c', '#3a2616', '#6b4a2a', '#a07a4a', '#202020'];
  for (let row = 0; row < ROWS; row++) {
    const y = row * 16;
    g.fillStyle = row % 2 ? '#1d2027' : '#191c22';
    g.fillRect(0, y + 13, W, 3);
    const clump = (x: number) => Math.sin(x * 0.045 + row * 0.9) + Math.sin(x * 0.11 - row * 1.7) * 0.6 > 0.25;
    for (let i = 0; i < COLS; i++) {
      if (Math.random() < 0.06) continue; // empty seat
      const x = i * 8;
      const fan = fb ? Math.random() < 0.72 : clump(x) && Math.random() < 0.85;
      g.fillStyle = fan ? (Math.random() < 0.8 ? home : second) : neutral[(Math.random() * neutral.length) | 0];
      g.fillRect(x + 1, y + 6, 6, 7);
      if (fb && fan && Math.random() < 0.6) {
        // Jersey shoulder stripes.
        g.fillStyle = second;
        g.fillRect(x + 1, y + 7, 1, 2);
        g.fillRect(x + 6, y + 7, 1, 2);
      }
      g.fillStyle = skins[(Math.random() * skins.length) | 0];
      g.fillRect(x + 2.5, y + 2, 3, 4);
      g.fillStyle = hair[(Math.random() * hair.length) | 0];
      g.fillRect(x + 2.5, y + 1.5, 3, 1.5);
      if (fb && fan && Math.random() < 0.14) {
        // A towel twirled overhead, or a foam finger.
        if (Math.random() < 0.7) {
          g.fillStyle = Math.random() < 0.5 ? '#f4f1ea' : '#ffd23f';
          g.fillRect(x + 1, y - 1, 5, 3);
        } else {
          g.fillStyle = second === '#ffffff' ? '#ffd23f' : second;
          g.fillRect(x + 5, y - 3, 2, 6);
        }
      } else if (!fb && fan && Math.random() < 0.25) {
        // A scarf held up over the head.
        g.fillStyle = home;
        g.fillRect(x, y, 8, 2);
        g.fillStyle = second;
        g.fillRect(x + 2, y, 2, 2);
        g.fillRect(x + 6, y, 2, 2);
      }
    }
  }
  // Football: hand-made signs held up over the heads.
  for (let k = 0; fb && k < 10; k++) {
    const x = Math.round(Math.random() * (W - 30));
    const y = Math.round(Math.random() * (H - 20));
    g.fillStyle = Math.random() < 0.7 ? '#f4f1ea' : '#ffd23f';
    g.fillRect(x, y, 22 + Math.round(Math.random() * 8), 9);
    g.fillStyle = Math.random() < 0.5 ? home : '#15181e';
    for (let c2 = 0; c2 < 4; c2++) g.fillRect(x + 2 + c2 * 5, y + 3, 3, 3);
  }
  // Soccer: flags draped over the seats in the home section.
  for (let k = 0; !fb && k < 4; k++) {
    const x = Math.round(Math.random() * (W - 56));
    const y = Math.round(Math.random() * (H - 40));
    g.fillStyle = home;
    g.fillRect(x, y, 56, 30);
    g.fillStyle = second;
    if (k % 2) g.fillRect(x + 20, y, 16, 30);
    else g.fillRect(x, y + 11, 56, 8);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x, y + 26, 56, 4);
  }
  // Darker toward the back of the tier, under the roof.
  const shade = g.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0.35)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  const t = texture(c, true);
  t.magFilter = THREE.NearestFilter;
  return t;
}

/**
 * Crowd material: each person (texture cell) bobs on their own rhythm, a few
 * pixels; when the crowd's excited, more of them are up and they jump higher.
 */
export function crowdMaterial(map: THREE.Texture, tint: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ map, color: tint, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = crowdTime;
    shader.uniforms.uExcite = crowdExcite;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uExcite;
vec2 crowdUv(vec2 uv) {
  vec2 cell = floor(uv * vec2(${COLS}.0, ${ROWS}.0));
  float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float moving = step(0.7 - 0.6 * uExcite, h);
  float bob = 0.5 + 0.5 * sin(uTime * (4.0 + 6.0 * h + 4.0 * uExcite) + h * 6.2831);
  return uv - vec2(0.0, moving * bob * (1.0 + 2.5 * uExcite) / ${ROWS * 16}.0);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  diffuseColor *= texture2D( map, crowdUv( vMapUv ) );
#endif`,
      );
  };
  return mat;
}

/** A waving flag on a pole: the cloth ripples, more toward its free end. */
export function flag(colors: [string, string], style: number, size: number): THREE.Group {
  const [c, g] = canvas(128, 80);
  g.fillStyle = colors[0];
  g.fillRect(0, 0, 128, 80);
  g.fillStyle = colors[1];
  if (style % 3 === 0) g.fillRect(0, 27, 128, 26);
  else if (style % 3 === 1) g.fillRect(43, 0, 42, 80);
  else {
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(128, 80);
    g.lineTo(128, 56);
    g.lineTo(38, 0);
    g.fill();
  }
  const cloth = new THREE.PlaneGeometry(size, size * 0.62, 12, 1);
  cloth.translate(size / 2, 0, 0);
  const mat = new THREE.MeshBasicMaterial({ map: texture(c), side: THREE.DoubleSide, color: 0xd8dde4 });
  const phase = Math.random() * 6.28;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = crowdTime;
    shader.uniforms.uExcite = crowdExcite;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uExcite;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float w = position.x / ${size.toFixed(2)};
transformed.z += sin(uTime * (5.0 + 3.0 * uExcite) - position.x * 2.6 + ${phase.toFixed(2)}) * 0.18 * ${size.toFixed(2)} * w;
transformed.y -= 0.08 * ${size.toFixed(2)} * w * w;`,
      );
  };
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, size * 1.6, 5), new THREE.MeshBasicMaterial({ color: 0x9aa0a8 }));
  pole.position.y = size * 0.8;
  const clothMesh = new THREE.Mesh(cloth, mat);
  clothMesh.position.y = size * 1.6 - size * 0.31;
  // Each flag swings on its pole a little, in time with the crowd.
  clothMesh.onBeforeRender = () => {
    clothMesh.rotation.y = Math.sin(crowdTime.value * 1.3 + phase) * (0.35 + 0.4 * crowdExcite.value);
  };
  group.add(pole, clothMesh);
  return group;
}

const BANNER_TEXT: Record<CrowdTheme, string[]> = {
  soccer: ['FLICK KINGS', 'TOP BINS ONLY', 'CURL IT IN', 'WE NEVER WALK ALONE', 'NO MERCY', 'ULTRAS 1987', 'ONE FLICK', 'SAVE IT!'],
  football: ["IT'S GOOD!", 'SPLIT THE UPRIGHTS', '3 POINTS', 'DE-FENSE', 'BLOCK IT!', 'ICE THE KICKER', 'WE WANT 3', 'LEG OF GOLD'],
};

/** A fan banner hung on a stand front: painted text on a cloth in the team's colours. */
export function banner(colors: [string, string], index: number, width: number, theme: CrowdTheme = 'soccer'): THREE.Mesh {
  const [c, g] = canvas(512, 96);
  g.fillStyle = colors[0];
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = colors[1];
  g.fillRect(0, 0, 512, 10);
  g.fillRect(0, 86, 512, 10);
  const texts = BANNER_TEXT[theme];
  const text = texts[index % texts.length];
  g.font = 'italic 900 54px "Arial Black", Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const scale = Math.min(1, 470 / g.measureText(text).width);
  g.save();
  g.translate(256, 50);
  g.scale(scale, 1);
  g.fillStyle = colors[1];
  g.fillText(text, 0, 0);
  g.restore();
  // Painted by hand: a little uneven.
  for (let i = 0; i < 200; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 512, Math.random() * 96, 6, 3);
  }
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * 0.19),
    new THREE.MeshBasicMaterial({ map: texture(c), color: 0xd0d4da, side: THREE.DoubleSide }),
  );
}

/** A towel twirled over a fan's head: a small cloth spinning round, faster when they're excited. */
export function towel(color: string): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(0.55, 0.32);
  geo.translate(0.3, 0, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  const phase = Math.random() * 6.28;
  const rate = 5 + Math.random() * 3;
  m.onBeforeRender = () => {
    const spin = crowdTime.value * rate * (0.5 + crowdExcite.value) + phase;
    m.rotation.set(0.5 * Math.sin(spin * 0.5), spin, 0);
  };
  return m;
}

/**
 * Camera flashes twinkling in the stands: a fixed scatter of points, each
 * lit for a moment at random, many more when the crowd's excited.
 */
export class Flashes {
  readonly points: THREE.Points;
  private readonly alpha: Float32Array;

  constructor(positions: THREE.Vector3[]) {
    const geo = new THREE.BufferGeometry().setFromPoints(positions);
    this.alpha = new Float32Array(positions.length);
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `attribute float alpha; varying float vA;
void main() { vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 260.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA;
void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(1.0, 1.0, 0.95, vA * smoothstep(0.5, 0.0, d)); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  update(dt: number): void {
    const rate = 0.02 + 1.6 * crowdExcite.value * crowdExcite.value;
    for (let i = 0; i < this.alpha.length; i++) {
      this.alpha[i] = Math.max(0, this.alpha[i] - dt * 9);
      if (Math.random() < rate * dt) this.alpha[i] = 1;
    }
    (this.points.geometry.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}
