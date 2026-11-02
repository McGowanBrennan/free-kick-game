// The PS2 look, on purpose, in two stages like the real thing.
//
// The console: the scene is drawn into a small framebuffer (at most 640 ×
// 480, and about one line per two screen points) with no anti-aliasing, gets
// a wide smeary bloom and floodlight lens flares, and is squeezed into 16-bit
// colour with an ordered dither, the way the hardware drew it.
//
// The TV: that frame is shown the way a CRT showed it: each line a glowing
// beam (fatter where it's bright, with dark gaps between), soft along the
// line like a composite signal with a little colour fringing, through an
// aperture-grille mask, darker toward the corners.

import * as THREE from 'three';

/** The console's framebuffer, at most. */
const MAX_COLS = 640;
const MAX_ROWS = 480;
/** Screen points per framebuffer line (vertically) and per pixel (along the line). */
const POINTS_PER_ROW = 2;
const POINTS_PER_COL = 1.25;

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 texel;
uniform float threshold;
varying vec2 vUv;
vec3 bright(vec2 uv) {
  vec3 c = texture2D(tScene, uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  return c * smoothstep(threshold, threshold + 0.35, l);
}
void main() {
  // Four taps: the downsample is itself a little blur.
  vec3 c = bright(vUv + texel * vec2(-0.5, -0.5)) + bright(vUv + texel * vec2(0.5, -0.5))
         + bright(vUv + texel * vec2(-0.5, 0.5)) + bright(vUv + texel * vec2(0.5, 0.5));
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
  c += (texture2D(tSrc, vUv + dir * 1.385).rgb + texture2D(tSrc, vUv - dir * 1.385).rgb) * 0.316;
  c += (texture2D(tSrc, vUv + dir * 3.231).rgb + texture2D(tSrc, vUv - dir * 3.231).rgb) * 0.070;
  gl_FragColor = vec4(c, 1.0);
}`;

/** The console's output: bloom, flares, a colour push, and 15-bit colour with an ordered dither. */
const FRAME_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tDepth;
uniform vec2 lowRes;
uniform float aspect;
uniform float bloom;
uniform vec4 flares[4];
varying vec2 vUv;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// A floodlight's flare: a hot core with a long horizontal streak, and ghosts
// strung back through the middle of the screen. Hidden when something is in
// front of the lamp.
vec3 flare(vec4 f, vec2 uv) {
  if (f.w <= 0.0) return vec3(0.0);
  vec2 lp = f.xy;
  if (texture2D(tDepth, lp).r < f.z) return vec3(0.0);
  vec2 d = (uv - lp) * vec2(aspect, 1.0);
  vec3 c = vec3(1.0, 0.93, 0.78) * (0.05 / (dot(d, d) * 90.0 + 0.05));
  c += vec3(0.75, 0.85, 1.0) * exp(-abs(d.y) * 260.0) * exp(-abs(d.x) * 5.0) * 0.55;
  vec2 axis = vec2(0.5) - lp;
  for (int i = 0; i < 3; i++) {
    float k = i == 0 ? 0.55 : i == 1 ? 1.25 : 1.8;
    float r = i == 0 ? 0.035 : i == 1 ? 0.06 : 0.025;
    vec3 tint = i == 0 ? vec3(0.4, 1.0, 0.6) : i == 1 ? vec3(0.45, 0.55, 1.0) : vec3(1.0, 0.55, 0.3);
    vec2 g = (uv - (lp + axis * k)) * vec2(aspect, 1.0);
    float ring = smoothstep(r, r * 0.8, length(g));
    c += tint * ring * 0.09;
  }
  return c * f.w;
}

void main() {
  vec2 px = floor(vUv * lowRes);
  vec3 c = texture2D(tScene, vUv).rgb;
  c += texture2D(tBloom, vUv).rgb * bloom;
  for (int i = 0; i < 4; i++) c += flare(flares[i], vUv);
  c = toSRGB(c);
  // A little extra punch, like a TV with the colour turned up.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.18);
  c = (c - 0.5) * 1.06 + 0.5;
  // 15-bit colour with an ordered dither.
  c = floor(clamp(c, 0.0, 1.0) * 31.0 + bayer4(px)) / 31.0;
  gl_FragColor = vec4(c, 1.0);
}`;

/** The TV: scanline beams, a soft composite line with colour fringing, the mask, the corners. */
const CRT_FRAG = /* glsl */ `
uniform sampler2D tFrame;
uniform vec2 lowRes;
varying vec2 vUv;

vec3 line(float x, float row) {
  // Along the line the signal is soft (the texture's own filtering), with red and blue a touch apart.
  float y = (row + 0.5) / lowRes.y;
  float o = 0.4 / lowRes.x;
  vec3 c;
  c.r = texture2D(tFrame, vec2(x + o, y)).r;
  c.g = texture2D(tFrame, vec2(x, y)).g;
  c.b = texture2D(tFrame, vec2(x - o, y)).b;
  return c;
}
// A beam's brightness d lines from its centre: bright lines are fatter.
vec3 beam(float d, vec3 c) {
  vec3 w = mix(vec3(0.3), vec3(0.5), c);
  vec3 k = d / w;
  return exp(-k * k);
}

void main() {
  vec2 p = vUv * lowRes;
  float row = floor(p.y);
  float fy = p.y - row - 0.5;
  float other = row + (fy < 0.0 ? -1.0 : 1.0);
  vec3 a = line(vUv.x, row);
  vec3 b = line(vUv.x, other);
  vec3 c = a * beam(abs(fy), a) + b * beam(1.0 - abs(fy), b);
  c *= 1.55;
  // Aperture grille: red, green and blue stripes of phosphor.
  float m = mod(floor(gl_FragCoord.x), 3.0);
  c *= vec3(m < 0.5 ? 1.0 : 0.86, m > 0.5 && m < 1.5 ? 1.0 : 0.86, m > 1.5 ? 1.0 : 0.86) * 1.1;
  // The tube: darker toward the edges and into the corners.
  vec2 v = vUv - 0.5;
  c *= 1.0 - dot(v, v) * 0.55;
  float edge = smoothstep(0.0, 0.012, vUv.x) * smoothstep(0.0, 0.012, 1.0 - vUv.x) * smoothstep(0.0, 0.008, vUv.y) * smoothstep(0.0, 0.008, 1.0 - vUv.y);
  gl_FragColor = vec4(c * edge, 1.0);
}`;

function pass(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  return mesh;
}

/** Half-float frames where the GPU can draw into them (darks band badly in 8-bit linear). */
let frameType: THREE.TextureDataType = THREE.UnsignedByteType;

function target(w: number, h: number, opts: { depth?: boolean; type?: THREE.TextureDataType } = {}): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: opts.type ?? frameType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: !!opts.depth,
  });
  if (opts.depth) {
    rt.depthTexture = new THREE.DepthTexture(w, h);
    rt.texture.minFilter = THREE.NearestFilter;
    rt.texture.magFilter = THREE.NearestFilter;
  }
  return rt;
}

export class RetroRenderer {
  enabled = true;
  private sceneRT = target(2, 2, { depth: true });
  private frameRT = target(2, 2, { type: THREE.UnsignedByteType });
  private bloomA = target(2, 2);
  private bloomB = target(2, 2);
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly bright: THREE.Mesh;
  private readonly blur: THREE.Mesh;
  private readonly frame: THREE.Mesh;
  private readonly crt: THREE.Mesh;
  private readonly flareUniform = [0, 1, 2, 3].map(() => new THREE.Vector4());
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    /** Floodlight lamps, for the flares. */
    private readonly lamps: THREE.Vector3[],
  ) {
    const ext = renderer.extensions;
    if (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')) frameType = THREE.HalfFloatType;
    this.bright = pass(BRIGHT_FRAG, { tScene: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.62 } });
    this.blur = pass(BLUR_FRAG, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    this.frame = pass(FRAME_FRAG, {
      tScene: { value: null },
      tBloom: { value: null },
      tDepth: { value: null },
      lowRes: { value: new THREE.Vector2() },
      aspect: { value: 1 },
      bloom: { value: 1.0 },
      flares: { value: this.flareUniform },
    });
    this.crt = pass(CRT_FRAG, { tFrame: { value: null }, lowRes: { value: new THREE.Vector2() } });
  }

  /** The framebuffer for a canvas of w × h CSS pixels. */
  setSize(w: number, h: number): void {
    const cols = Math.max(2, Math.min(MAX_COLS, Math.round(w / POINTS_PER_COL)));
    const rows = Math.max(2, Math.min(MAX_ROWS, Math.round(h / POINTS_PER_ROW)));
    for (const rt of [this.sceneRT, this.frameRT, this.bloomA, this.bloomB]) rt.dispose();
    this.sceneRT = target(cols, rows, { depth: true });
    this.frameRT = target(cols, rows, { type: THREE.UnsignedByteType });
    this.bloomA = target(Math.ceil(cols / 2), Math.ceil(rows / 2));
    this.bloomB = target(Math.ceil(cols / 2), Math.ceil(rows / 2));
    const fu = (this.frame.material as THREE.ShaderMaterial).uniforms;
    fu.lowRes.value.set(cols, rows);
    fu.aspect.value = w / h;
    (this.crt.material as THREE.ShaderMaterial).uniforms.lowRes.value.set(cols, rows);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);

    const bu = (this.bright.material as THREE.ShaderMaterial).uniforms;
    bu.tScene.value = this.sceneRT.texture;
    bu.texel.value.set(1 / this.sceneRT.width, 1 / this.sceneRT.height);
    r.setRenderTarget(this.bloomA);
    r.render(this.bright, this.cam);
    const lu = (this.blur.material as THREE.ShaderMaterial).uniforms;
    for (let i = 0; i < 2; i++) {
      lu.tSrc.value = this.bloomA.texture;
      lu.dir.value.set((1 + i) / this.bloomA.width, 0);
      r.setRenderTarget(this.bloomB);
      r.render(this.blur, this.cam);
      lu.tSrc.value = this.bloomB.texture;
      lu.dir.value.set(0, (1 + i) / this.bloomA.height);
      r.setRenderTarget(this.bloomA);
      r.render(this.blur, this.cam);
    }

    this.lamps.forEach((lamp, i) => {
      const f = this.flareUniform[i];
      const p = this.tmp.copy(lamp).project(camera);
      const inView = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      // Stronger the nearer the lamp is to looking straight into it.
      const toward = camera.getWorldDirection(new THREE.Vector3()).dot(lamp.clone().sub(camera.position).normalize());
      f.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, p.z * 0.5 + 0.5 - 1e-4, inView ? THREE.MathUtils.smoothstep(toward, 0.6, 0.95) : 0);
    });
    const fu = (this.frame.material as THREE.ShaderMaterial).uniforms;
    fu.tScene.value = this.sceneRT.texture;
    fu.tBloom.value = this.bloomA.texture;
    fu.tDepth.value = this.sceneRT.depthTexture;
    r.setRenderTarget(this.frameRT);
    r.render(this.frame, this.cam);

    (this.crt.material as THREE.ShaderMaterial).uniforms.tFrame.value = this.frameRT.texture;
    r.setRenderTarget(null);
    r.render(this.crt, this.cam);
  }
}
