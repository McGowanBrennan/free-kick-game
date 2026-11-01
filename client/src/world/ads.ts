// Stadium branding: LED perimeter boards that rotate through sponsors (every
// sponsor is invented: no real brands), the stadium's name along the tier
// fronts, and the big screens on the roofs showing the score.

import * as THREE from 'three';

interface Sponsor {
  name: string;
  tag: string;
  bg: [string, string];
  fg: string;
  accent: string;
  logo: 'disc' | 'bolt' | 'wing' | 'diamond' | 'ball' | 'star' | 'stripes' | 'swoosh';
}

const SPONSORS: Sponsor[] = [
  { name: 'KICKOFF COLA', tag: 'TASTE THE WIN', bg: ['#e0182d', '#a30d1e'], fg: '#ffffff', accent: '#ffffff', logo: 'disc' },
  { name: 'VOLTA', tag: 'ENERGY DRINK', bg: ['#151515', '#000000'], fg: '#c6ff00', accent: '#c6ff00', logo: 'bolt' },
  { name: 'AERO AIR', tag: 'FLY FURTHER', bg: ['#0d4bb0', '#072b6b'], fg: '#ffffff', accent: '#7fd0ff', logo: 'wing' },
  { name: 'PIXELPHONE', tag: 'CALL IT', bg: ['#ffffff', '#d9dee6'], fg: '#1a3fa8', accent: '#00b3ff', logo: 'diamond' },
  { name: 'GOLAZO', tag: 'SPORT SINCE 1974', bg: ['#ffd400', '#e0a800'], fg: '#111111', accent: '#111111', logo: 'ball' },
  { name: 'NOVA BANK', tag: 'BANK ON IT', bg: ['#00665a', '#003d36'], fg: '#ffffff', accent: '#ffd23f', logo: 'star' },
  { name: 'TURBO TYRES', tag: 'GRIP THE ROAD', bg: ['#ff6a00', '#c44a00'], fg: '#111111', accent: '#ffffff', logo: 'stripes' },
  { name: 'STRIKER', tag: 'GAMES', bg: ['#4d1f86', '#2b0f52'], fg: '#ffd23f', accent: '#ffffff', logo: 'swoosh' },
];

/** One board panel shows this many metres of board. */
const PANEL_M = 6;
const PANEL_W = 512;
const PANEL_H = 84;
/** Seconds each set of panels shows, and how long the slide to the next takes. */
const HOLD_S = 7;
const SLIDE_S = 0.45;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function drawLogo(g: CanvasRenderingContext2D, kind: Sponsor['logo'], cx: number, cy: number, r: number, color: string): void {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = r * 0.22;
  g.beginPath();
  switch (kind) {
    case 'disc':
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.ellipse(0, 0, r * 0.95, r * 0.35, -0.5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'bolt':
      g.moveTo(r * 0.2, -r);
      g.lineTo(-r * 0.6, r * 0.15);
      g.lineTo(-r * 0.05, r * 0.15);
      g.lineTo(-r * 0.25, r);
      g.lineTo(r * 0.65, -r * 0.2);
      g.lineTo(r * 0.05, -r * 0.2);
      g.closePath();
      g.fill();
      break;
    case 'wing':
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(-r, r * (0.5 - i * 0.45));
        g.quadraticCurveTo(0, -r * (0.6 + i * 0.3), r, -r * (0.4 + i * 0.3));
        g.stroke();
      }
      break;
    case 'diamond':
      g.moveTo(0, -r);
      g.lineTo(r * 0.75, 0);
      g.lineTo(0, r);
      g.lineTo(-r * 0.75, 0);
      g.closePath();
      g.fill();
      break;
    case 'ball':
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        g.lineTo(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
      }
      g.closePath();
      g.fill();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? r * 0.42 : r;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      break;
    case 'stripes':
      g.transform(1, 0, -0.35, 1, 0, 0);
      for (let i = -1; i <= 1; i++) g.fillRect(i * r * 0.6 - r * 0.15, -r, r * 0.3, r * 2);
      break;
    case 'swoosh':
      g.moveTo(-r, r * 0.3);
      g.quadraticCurveTo(-r * 0.2, r * 1.1, r, -r * 0.7);
      g.quadraticCurveTo(-r * 0.1, r * 0.5, -r, r * 0.3);
      g.fill();
      break;
  }
  g.restore();
}

/** One sponsor panel: gradient ground, logo, name and strapline. */
function drawPanel(g: CanvasRenderingContext2D, x: number, s: Sponsor): void {
  const grad = g.createLinearGradient(0, 0, 0, PANEL_H);
  grad.addColorStop(0, s.bg[0]);
  grad.addColorStop(1, s.bg[1]);
  g.fillStyle = grad;
  g.fillRect(x, 0, PANEL_W, PANEL_H);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(x, 0, PANEL_W, 6);
  drawLogo(g, s.logo, x + 62, PANEL_H / 2, 26, s.accent);
  g.fillStyle = s.fg;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = 'italic 900 40px "Arial Black", Arial, Helvetica, sans-serif';
  const scale = Math.min(1, 300 / g.measureText(s.name).width);
  g.save();
  g.translate(x + 108, 36);
  g.scale(scale, 1);
  g.fillText(s.name, 0, 0);
  g.restore();
  g.font = 'bold 15px Arial, Helvetica, sans-serif';
  g.globalAlpha = 0.85;
  g.fillText(s.tag, x + 110, 66);
  g.globalAlpha = 1;
}

/**
 * The perimeter boards. All sponsors sit on one strip texture; every few
 * seconds each board slides on by one panel, like the LED boards of the era.
 */
export class LedBoards {
  private readonly textures: THREE.CanvasTexture[] = [];
  private shown = 0;

  /** A run of boards from `from` to `to`, facing the pitch (to the left of from → to). */
  board(from: THREE.Vector3, to: THREE.Vector3, start: number): THREE.Group {
    const len = from.distanceTo(to);
    const [c, g] = canvas(PANEL_W * SPONSORS.length, PANEL_H);
    SPONSORS.forEach((_, k) => drawPanel(g, k * PANEL_W, SPONSORS[(k + start) % SPONSORS.length]));
    // LED pixel grid.
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < PANEL_H; y += 3) g.fillRect(0, y, c.width, 1);
    const tex = texture(c);
    tex.repeat.set(len / (PANEL_M * SPONSORS.length), 1);
    this.textures.push(tex);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), new THREE.MeshBasicMaterial({ map: tex, color: 0xeeeeee }));
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 0.95, 0.15), new THREE.MeshLambertMaterial({ color: 0x15171b }));
    face.position.z = 0.08;
    const group = new THREE.Group();
    group.add(back, face);
    group.position.copy(from).add(to).multiplyScalar(0.5).setY(0.47);
    const dir = to.clone().sub(from).normalize();
    group.rotation.y = Math.atan2(-dir.z, dir.x);
    return group;
  }

  update(time: number): void {
    const cycle = HOLD_S + SLIDE_S;
    const k = Math.floor(time / cycle);
    const into = time - k * cycle - HOLD_S;
    const slide = into > 0 ? into / SLIDE_S : 0;
    const eased = slide * slide * (3 - 2 * slide);
    this.shown = (k + eased) / SPONSORS.length;
    for (const t of this.textures) t.offset.x = this.shown;
  }
}

/** The stadium's name along a tier front, with crests between. */
export function fascia(length: number): THREE.MeshBasicMaterial {
  const [c, g] = canvas(1024, 64);
  g.fillStyle = '#0d1b3d';
  g.fillRect(0, 0, 1024, 64);
  g.fillStyle = '#ffd23f';
  g.fillRect(0, 0, 1024, 4);
  g.fillRect(0, 60, 1024, 4);
  g.font = 'italic 900 38px "Arial Black", Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText('FREE KICK ARENA', 360, 34);
  // Crest: a shield with a star.
  const crest = (x: number) => {
    g.fillStyle = '#ffd23f';
    g.beginPath();
    g.moveTo(x - 18, 10);
    g.lineTo(x + 18, 10);
    g.lineTo(x + 18, 34);
    g.quadraticCurveTo(x, 58, x - 18, 34);
    g.closePath();
    g.fill();
    g.fillStyle = '#0d1b3d';
    drawLogo(g, 'star', x, 30, 10, '#0d1b3d');
  };
  crest(80);
  crest(640);
  drawLogo(g, 'disc', 800, 32, 18, '#ffffff');
  g.fillStyle = '#ffffff';
  g.font = 'italic 900 22px "Arial Black", Arial, sans-serif';
  g.fillText('KICKOFF COLA', 910, 34);
  const tex = texture(c);
  tex.repeat.set(length / 48, 1);
  return new THREE.MeshBasicMaterial({ map: tex, color: 0xdddddd });
}

/** A big screen on a roof: the score, the round, and a slogan between kicks. */
export class Screen {
  readonly mesh: THREE.Mesh;
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;

  constructor(width: number) {
    const [c, g] = canvas(512, 256);
    this.g = g;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.8, width * 0.5 + 0.8, 0.5), new THREE.MeshLambertMaterial({ color: 0x1b1e24 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.5), new THREE.MeshBasicMaterial({ map: this.tex }));
    face.position.z = 0.26;
    this.mesh = new THREE.Mesh();
    this.mesh.add(frame, face);
    this.show(['FREE KICK DUEL', '', 'WELCOME']);
  }

  /** Three lines: a header, the main line (big), and a footer. */
  show([top, main, bottom]: [string, string, string] | string[]): void {
    const g = this.g;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#0a1a44');
    grad.addColorStop(1, '#03081a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd23f';
    g.font = 'italic 900 34px "Arial Black", Arial, sans-serif';
    g.fillText(top, 256, 46);
    g.fillStyle = '#ffffff';
    g.font = 'italic 900 78px "Arial Black", Arial, sans-serif';
    g.fillText(main, 256, 136);
    g.fillStyle = '#9fb8ff';
    g.font = 'bold 26px Arial, sans-serif';
    g.fillText(bottom, 256, 214);
    // Screen-door pixels.
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < 256; y += 4) g.fillRect(0, y, 512, 1);
    for (let x = 0; x < 512; x += 4) g.fillRect(x, 0, 1, 256);
    this.tex.needsUpdate = true;
  }
}
