// The finger's path while swiping, drawn over the pitch and faded out after
// release. Shooting, it shows the power as you go: the colour runs from a cool
// blue (a soft side-foot) through green and yellow to red (overhit), with the
// percentage at the fingertip. Keeping, it's ice blue. A swipe that doesn't
// count fades out grey.

import { DEFAULT_PARAMS } from '@fk/shared';

const FADE_S = 0.8;
const GREY = '170,176,186';
const KEEPER = '143,224,255';

/** Power (0 … 1) → an rgb triple for the trail. */
function powerColour(p: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [79, 209, 255]],
    [0.45, [62, 224, 122]],
    [0.75, [255, 210, 63]],
    [DEFAULT_PARAMS.overhitThreshold, [255, 140, 40]],
    [1, [255, 60, 52]],
  ];
  let i = 1;
  while (i < stops.length - 1 && p > stops[i][0]) i++;
  const [p0, c0] = stops[i - 1];
  const [p1, c1] = stops[i];
  const t = Math.min(1, Math.max(0, (p - p0) / (p1 - p0)));
  return c0.map((c, k) => Math.round(c + (c1[k] - c) * t)).join(',');
}

export class Trail {
  private readonly g: CanvasRenderingContext2D;
  private points: { x: number; y: number }[] = [];
  private fade = 0;
  private held = false;
  private raf = 0;
  private last = 0;
  private rgb = GREY;
  private label: string | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Start a new path. `kind` sets the colouring: shoot (by power), keep, or idle (doesn't count). */
  begin(x: number, y: number, kind: 'shoot' | 'keep' | 'idle'): void {
    this.points = [{ x, y }];
    this.fade = 1;
    this.held = true;
    this.rgb = kind === 'keep' ? KEEPER : kind === 'shoot' ? powerColour(0) : GREY;
    this.label = null;
    this.kick();
  }

  add(x: number, y: number): void {
    if (this.points.length) this.points.push({ x, y });
    this.kick();
  }

  /** The shot's power so far (or final): recolours the whole path and labels the fingertip. */
  setPower(p: number): void {
    this.rgb = powerColour(p);
    this.label = p > DEFAULT_PARAMS.overhitThreshold ? `${Math.round(p * 100)}% OVERHIT` : `${Math.round(p * 100)}%`;
    this.kick();
  }

  /** Mark the swipe as not counting: it fades out grey. */
  reject(): void {
    this.rgb = GREY;
    this.label = null;
    this.kick();
  }

  /** Release: keep the path on screen briefly, then fade it out. */
  end(): void {
    this.held = false;
    this.last = performance.now();
    this.kick();
  }

  clear(): void {
    this.points = [];
    this.fade = 0;
    this.held = false;
    this.kick();
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.kick();
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.draw(t));
  }

  private draw(now: number): void {
    this.raf = 0;
    const g = this.g;
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!this.held && this.fade > 0) {
      this.fade = Math.max(0, this.fade - Math.max(0, now - this.last) / 1000 / FADE_S);
      this.last = now;
    }
    const pts = this.points;
    if (this.fade <= 0 || pts.length < 2) return;
    const a = this.fade;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // A soft glow under a bright core, tapering from the start to the fingertip.
    for (const [width, alpha] of [
      [18, 0.18],
      [8, 0.9],
    ] as const) {
      for (let i = 1; i < pts.length; i++) {
        const s = i / (pts.length - 1);
        g.strokeStyle = `rgba(${this.rgb},${alpha * (0.3 + 0.7 * s) * a})`;
        g.lineWidth = width * (0.35 + 0.65 * s);
        g.beginPath();
        g.moveTo(pts[i - 1].x, pts[i - 1].y);
        g.lineTo(pts[i].x, pts[i].y);
        g.stroke();
      }
    }
    if (this.label) {
      const tip = pts[pts.length - 1];
      const x = Math.min(window.innerWidth - 60, Math.max(60, tip.x));
      const y = Math.max(24, tip.y - 26);
      g.font = 'italic 800 15px "Avenir Next Condensed", "Arial Narrow", Arial, sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 4;
      g.strokeStyle = `rgba(0,0,0,${0.6 * a})`;
      g.strokeText(this.label, x, y);
      g.fillStyle = `rgba(${this.rgb},${a})`;
      g.fillText(this.label, x, y);
    }
    this.kick();
  }
}
