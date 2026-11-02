// Game audio, all from recorded samples (client/public/sfx, credits in
// sfx/CREDITS.txt): each ground's own live crowd that swells and reacts, its
// own cheer for a goal or a good kick, the strike, gloves, woodwork, bounces,
// the net, the referee's whistle and UI ticks. The crowd is the player's home
// crowd: it supports them, goes quiet when it goes against them, and enjoys
// the opposition's misses. iOS only allows audio after a touch, so everything
// starts on the first one.
//
// The mix: every recording is levelled when it loads (they come in at very
// different volumes), so the gains below are relative to a common loudness.
// The crowd bed runs through its own bus (level and brightness follow the
// excitement, a gentle compressor keeps its swells in check, and a duck pulls
// it down under a big reaction so the two don't pile up); reactions and
// effects go straight to the master, which a compressor guards against clipping.

const STORE_KEY = 'fk.sound';

export type CrowdTheme = 'soccer' | 'football';
/** What's happening, for the crowd: between kicks, the player (home) lining up, the opposition (away) lining up, or the ball in play. */
export type CrowdPhase = 'between' | 'home' | 'away' | 'live';

/** How a kick turned out, from the home crowd's side. */
export interface Reaction {
  /** Good for the player (they scored or saved, or the AI missed) */
  homeGood: boolean;
  /** The player was the one kicking (or the keeper who saved it) */
  humanActed: boolean;
  /** So nearly the other way: the woodwork, a fingertip, just wide */
  near: boolean;
  /** Nowhere near: a shank, miles over, well short */
  wild: boolean;
  /** It went in (a goal, or a field goal made), whoever kicked it */
  goal?: boolean;
}

/** Every sample and its file. */
const FILES = {
  'soccer-default-1': 'soccer-default-1.mp3',
  'soccer-default-2': 'soccer-default-2.mp3',
  'soccer-goal-cheer': 'soccer-goal-cheer.mp3',
  'nfl-default-1': 'nfl-default-1.mp3',
  'nfl-default-2': 'nfl-default-2.mp3',
  'nfl-kick-good': 'nfl-kick-good.mp3',
  whistle: 'whistle.wav',
  kick: 'kick.wav',
  save: 'save.wav',
  post: 'post.wav',
  bounce: 'bounce.wav',
  thwack: 'thwack.wav',
  net: 'net.wav',
  tick: 'tick.wav',
} as const;
type SampleName = keyof typeof FILES;

/**
 * Each ground's crowd: the recordings its bed is made from, its cheer, and a
 * trim on the bed (levelled to the same RMS, the NFL murmur still sounds
 * bigger than the bright soccer singing once the crowd's low-pass has had its
 * share, so it's brought down to match).
 */
const GROUNDS: Record<CrowdTheme, { bed: SampleName[]; cheer: SampleName; trim: number }> = {
  soccer: { bed: ['soccer-default-1', 'soccer-default-2'], cheer: 'soccer-goal-cheer', trim: 1 },
  football: { bed: ['nfl-default-1', 'nfl-default-2'], cheer: 'nfl-kick-good', trim: 0.68 },
};

/**
 * Where each cheer really starts and how to end it: both recordings open with
 * an edit (a dropout, and a thump in the football one) before the crowd goes
 * up, so they're played from just after it, with the roar arriving a beat
 * after the moment; the soccer one is cut off at full cry, so it's faded out
 * into the bed (which is lifted to meet it).
 */
const CHEERS: Partial<Record<SampleName, { offset: number; fadeOut: number }>> = {
  // Right at the surge (soccer: 1.35 s in; NFL: 0.85 s), so the roar goes up on the moment.
  'soccer-goal-cheer': { offset: 1.3, fadeOut: 1.4 },
  'nfl-kick-good': { offset: 0.82, fadeOut: 0.5 },
};

/** Loudness everything is levelled to (RMS): the bed overall, a cheer at its loudest second. */
const BED_RMS = 0.12;
const CHEER_RMS = 0.4;
/** The bed's crossfade from one recording into the next, s. */
const BED_XFADE = 3;

/**
 * One ground's live crowd, as it was recorded: each of its recordings played
 * straight through (its longest clean stretch, clear of the ends and of any
 * dropout), then a long equal-power crossfade into the next, and round again.
 * Each recording is levelled as a whole (so nothing jumps inside one); the
 * first starts from a random point so it doesn't open the same way every time.
 */
class CrowdBed {
  readonly out: GainNode;
  private nextAt = 0;
  private turn = 0;
  private first = true;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    /** Each recording, the stretch of it that's played (s), and its level */
    private readonly takes: { buf: AudioBuffer; from: number; to: number; norm: number }[],
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.nextAt = ctx.currentTime + 0.05;
  }

  /** Keep the next few seconds scheduled. */
  pump(): void {
    const ctx = this.ctx;
    if (!this.takes.length) return;
    while (this.nextAt < ctx.currentTime + 6) {
      const take = this.takes[this.turn++ % this.takes.length];
      let offset = take.from;
      if (this.first) offset += Math.random() * Math.max(0, take.to - take.from - 4 * BED_XFADE);
      this.first = false;
      const len = take.to - offset;
      const at = Math.max(this.nextAt - BED_XFADE, ctx.currentTime);
      const src = ctx.createBufferSource();
      src.buffer = take.buf;
      const g = ctx.createGain();
      g.gain.value = 0;
      const n = 32;
      const up = new Float32Array(n);
      const down = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        up[i] = take.norm * Math.sin(((i / (n - 1)) * Math.PI) / 2);
        down[i] = take.norm * Math.cos(((i / (n - 1)) * Math.PI) / 2);
      }
      g.gain.setValueCurveAtTime(up, at, BED_XFADE);
      g.gain.setValueCurveAtTime(down, at + len - BED_XFADE, BED_XFADE);
      src.connect(g).connect(this.out);
      src.start(at, offset, len);
      this.nextAt = at + len;
    }
  }
}

/** RMS of a buffer's first channel over [from, from + len) s (sampled sparsely: it's for levelling). */
function rms(buf: AudioBuffer, from = 0, len = buf.duration): number {
  const d = buf.getChannelData(0);
  const a = Math.max(0, Math.floor(from * buf.sampleRate));
  const b = Math.min(d.length, Math.floor((from + len) * buf.sampleRate));
  let s = 0;
  let n = 0;
  for (let i = a; i < b; i += 7) {
    s += d[i] * d[i];
    n++;
  }
  return n ? Math.sqrt(s / n) : 0;
}

/** The loudest second of a buffer, RMS. */
function peakRms(buf: AudioBuffer): number {
  let best = 0;
  for (let t = 0; t + 1 <= buf.duration; t += 0.1) best = Math.max(best, rms(buf, t, 1));
  return best || rms(buf);
}

/**
 * A recording's clean stretches: clear of its ends (an MP3's encoder padding)
 * and of any dropout (a 50 ms window far below its typical level, with a
 * little room either side), and long enough to crossfade in and out of.
 */
function cleanStretches(buf: AudioBuffer): [number, number][] {
  const w = 0.05;
  const levels: number[] = [];
  for (let t = 0; t + w <= buf.duration; t += w) levels.push(rms(buf, t, w));
  const median = [...levels].sort((a, b) => a - b)[levels.length >> 1] ?? 0;
  const out: [number, number][] = [];
  let start = 0.2;
  levels.forEach((v, i) => {
    if (v >= median * 0.15) return;
    out.push([start, i * w - 0.3]);
    start = (i + 1) * w + 0.3;
  });
  out.push([start, buf.duration - 0.2]);
  return out.filter(([a, b]) => b - a >= 4 * BED_XFADE);
}

/** A stereo recording folded to mono (half the memory for the long crowd beds). */
function toMono(ctx: AudioContext, buf: AudioBuffer): AudioBuffer {
  if (buf.numberOfChannels === 1) return buf;
  const mono = ctx.createBuffer(1, buf.length, buf.sampleRate);
  const out = mono.getChannelData(0);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  for (let i = 0; i < buf.length; i++) {
    let s = 0;
    for (const ch of chans) s += ch[i];
    out[i] = s / chans.length;
  }
  return mono;
}

interface PlayOpts {
  lowpass?: number;
  /** Start this far into the sample, and play this much of it, s */
  offset?: number;
  duration?: number;
  /** Fade out over the last this-many seconds */
  fadeOut?: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** The crowd bus: level and brightness follow the excitement */
  private crowdGain: GainNode | null = null;
  private crowdTone: BiquadFilterNode | null = null;
  /** Each ground's bed, faded in and out by theme */
  private beds: Partial<Record<CrowdTheme, CrowdBed>> = {};
  /** Pulls the whole crowd bed down: the ground going quiet, a hush, or making room for a cheer */
  private duck: GainNode | null = null;
  private theme: CrowdTheme = 'soccer';
  private phase: CrowdPhase = 'between';
  /** When the crowd last answered a taunt (so spamming one doesn't stack a dozen cheers) */
  private tauntAt = -Infinity;
  private readonly buffers = new Map<SampleName, AudioBuffer>();
  /** Per-sample levelling (the cheers come in at very different volumes) */
  private readonly norm = new Map<SampleName, number>();
  private enabled: boolean;
  /** Crowd level the bed eases toward (0 … 1) */
  private crowdLevel = 0.35;

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORE_KEY);
    } catch {
      // Storage unavailable: default on.
    }
    this.enabled = saved !== 'off';
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    for (const type of ['pointerdown', 'touchend', 'keydown'] as const) window.addEventListener(type, unlock, { passive: true });
    // Pause when the app is backgrounded (iOS keeps contexts alive otherwise).
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      // (Back again, it resumes whether or not sound is on: the mute is the master gain, so switching sound on later just works.)
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  get on(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
    } catch {
      // Storage unavailable: the setting just won't persist.
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
      if (on) void this.ctx.resume();
    }
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    // Mix with the player's music and respect the silent switch (Safari 16.4+).
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'ambient';
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    // And a soft clipper after it: anything that gets past the compressor's
    // attack is rounded off rather than clipped (straight through below 0.8).
    const pre = ctx.createGain();
    pre.gain.value = 0.5;
    const clip = ctx.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) {
      const x = ((i / (curve.length - 1)) * 2 - 1) * 2;
      const m = Math.abs(x);
      curve[i] = Math.sign(x) * (m < 0.8 ? m : 0.8 + 0.2 * Math.tanh((m - 0.8) / 0.2));
    }
    clip.curve = curve;
    clip.oversample = '2x';
    this.master.connect(comp).connect(pre).connect(clip).connect(ctx.destination);
    this.buildCrowdBus(ctx);
    void this.load(ctx);
    window.setInterval(() => {
      for (const bed of Object.values(this.beds)) bed.pump();
    }, 1000);
    return ctx;
  }

  /** The crowd bus: tone (opens up as it gets going) → level → a gentle compressor → the duck → master. */
  private buildCrowdBus(ctx: AudioContext): void {
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -26;
    comp.knee.value = 10;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.05;
    comp.release.value = 0.6;
    const duck = ctx.createGain();
    tone.connect(gain).connect(comp).connect(duck).connect(this.master!);
    this.crowdTone = tone;
    this.crowdGain = gain;
    this.duck = duck;
    this.setCrowd(this.crowdLevel, 2);
  }

  private async load(ctx: AudioContext): Promise<void> {
    const get = async (name: SampleName) => {
      try {
        const data = await (await fetch(`/sfx/${FILES[name]}`)).arrayBuffer();
        let buf = await ctx.decodeAudioData(data);
        if (name.includes('default')) buf = toMono(ctx, buf);
        this.buffers.set(name, buf);
        if (CHEERS[name]) this.norm.set(name, CHEER_RMS / Math.max(1e-4, peakRms(buf)));
      } catch {
        // A missing sample just stays silent.
      }
    };
    // The small things first (the effects and both grounds' cheers, so a
    // cheer is never missing however slow the connection), then the current
    // ground's crowd, then the other's.
    const first = this.theme;
    const other: CrowdTheme = first === 'soccer' ? 'football' : 'soccer';
    const beds = new Set<SampleName>([...GROUNDS.soccer.bed, ...GROUNDS.football.bed]);
    await Promise.all((Object.keys(FILES) as SampleName[]).filter((n) => !beds.has(n)).map(get));
    await Promise.all(GROUNDS[first].bed.map(get));
    this.startBed(ctx, first);
    await Promise.all(GROUNDS[other].bed.map(get));
    this.startBed(ctx, other);
  }

  private startBed(ctx: AudioContext, theme: CrowdTheme): void {
    if (this.beds[theme] || !this.crowdTone) return;
    const takes = GROUNDS[theme].bed.flatMap((n) => {
      const buf = this.buffers.get(n);
      if (!buf) return [];
      // The longest clean stretch, levelled as a whole.
      const best = cleanStretches(buf).sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
      if (!best) return [];
      const [from, to] = best;
      return [{ buf, from, to, norm: Math.min(14, BED_RMS / Math.max(1e-4, rms(buf, from, to - from))) }];
    });
    if (!takes.length) return;
    const bed = new CrowdBed(ctx, this.crowdTone, takes);
    bed.pump();
    this.beds[theme] = bed;
    this.mixBeds(1.5);
  }

  /** Which bed is up (crossfaded on a change of ground); the home crowd is a little quieter while the visitors line up. */
  private mixBeds(seconds = 1.2): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const level = this.phase === 'away' ? 0.8 : 1;
    for (const theme of Object.keys(this.beds) as CrowdTheme[]) {
      this.beds[theme]!.out.gain.setTargetAtTime(theme === this.theme ? level * GROUNDS[theme].trim : 0, t, seconds / 3);
    }
  }

  /** A soccer ground or a football stadium: its own crowd, and its own cheer. */
  setTheme(theme: CrowdTheme): void {
    this.theme = theme;
    this.mixBeds();
  }

  /** Tell the crowd what's happening (it's a touch quieter under the opposition's kick). */
  setPhase(phase: CrowdPhase): void {
    if (phase === this.phase) return;
    this.phase = phase;
    this.mixBeds(1.5);
  }

  /** Pull the whole crowd bed down to `to` for `hold` seconds, then let it back up over `release`. */
  private duckFor(to: number, hold: number, release = 2.5, attack = 0.25): void {
    const ctx = this.ctx;
    if (!ctx || !this.duck) return;
    const g = this.duck.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + attack);
    g.setValueAtTime(to, t + hold);
    g.linearRampToValueAtTime(1, t + hold + release);
  }

  /**
   * The ground's own cheer, `at` s from now (its roar arrives a beat later),
   * at `gain`; the bed dips under it so they don't pile up, and comes back
   * as it fades. `small` takes just the peak of it, briefly (a taunt).
   */
  private cheer(gain: number, at = 0, opts: { rate?: number; lowpass?: number; small?: boolean; duck?: boolean } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    let name = GROUNDS[this.theme].cheer;
    if (!this.buffers.has(name)) name = GROUNDS[this.theme === 'soccer' ? 'football' : 'soccer'].cheer;
    const cut = CHEERS[name] ?? { offset: 0, fadeOut: 0.5 };
    if (opts.duck !== false && !opts.small) this.duckFor(0.5, at + 2.4, 2.2, 0.4);
    this.play(name, gain, opts.rate ?? 1, ctx.currentTime + at, {
      lowpass: opts.lowpass,
      offset: cut.offset + (opts.small ? 0.6 : 0),
      duration: opts.small ? 1.7 : undefined,
      fadeOut: opts.small ? 0.9 : cut.fadeOut,
    });
  }

  /** Sudden death's announced: the ground holds its breath, then erupts (`at` s from now). */
  suddenDeath(at: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.duckFor(0.06, at, 0.15);
    this.cheer(1.1, at, { duck: false });
  }

  /** A kick that could decide it: the crowd hushes to a nervous murmur while it's lined up (and lets go at the strike). */
  hush(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.duck) return;
    const g = this.duck.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(on ? 0.3 : 1, t, on ? 0.6 : 0.15);
  }

  /** Ease the crowd toward a level (0 quiet … 1 roaring) over `seconds`: louder and brighter. */
  setCrowd(level: number, seconds = 0.6): void {
    this.crowdLevel = level;
    const ctx = this.ctx;
    if (!ctx || !this.crowdGain || !this.crowdTone) return;
    const t = ctx.currentTime;
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setTargetAtTime(0.12 + level * 0.32, t, seconds / 3);
    this.crowdTone.frequency.setTargetAtTime(2400 + level * 9000, t, seconds / 3);
  }

  /**
   * The crowd's reaction to a kick, one clear sound for each moment (all from
   * the ground's own recordings), once the result is in: a goal or a made
   * field goal has already been cheered as it went in (goal()); a save of the
   * player's gets the cheer; a miss of the AI's is cheered (relief); a miss of the player's, or
   * a save against them, and the ground goes quiet: the crowd drops away
   * (quicker for a near thing, longer for a shank) and murmurs back.
   */
  react(r: Reaction): void {
    if (!this.ctx) return;
    // A goal was cheered the moment it went in (goal()); a goal against still takes the bed down after.
    if (r.goal) {
      if (!r.homeGood) this.duckFor(0.45, 1.2, 2.4, 0.6);
      return;
    }
    if (r.homeGood) {
      this.cheer(r.humanActed ? 1 : r.near ? 0.85 : 0.72);
    } else {
      // The player missed (or was saved): the ground deflates.
      this.duckFor(0.18, r.wild ? 2.4 : 1.8, 2.6, r.near ? 0.12 : 0.3);
    }
  }

  /** It's in (over the line, through the uprights): the cheer, the instant it happens. Full for the player's, a bit less for the AI's. */
  goal(home: boolean): void {
    this.cheer(home ? 1 : 0.62);
  }

  /** The crowd at a taunt: the player's gets a quick cheer; the AI's, a moment's quiet; at most one every so often however fast they come. */
  taunt(home: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.tauntAt < 1.5) return;
    this.tauntAt = ctx.currentTime;
    if (home) this.cheer(0.32, 0, { small: true });
    else this.duckFor(0.6, 0.6, 1, 0.2);
  }

  /** The strike: harder shots are louder and a touch deeper. */
  kick(speed: number): void {
    const k = Math.min(1, speed / 32);
    this.play('kick', 0.45 + 0.55 * k, 1.12 - 0.2 * k);
  }

  save(speed: number): void {
    this.play('save', Math.min(1, 0.45 + speed / 40), 0.95 + Math.random() * 0.1);
  }

  post(speed: number): void {
    this.play('post', Math.min(1, 0.4 + speed / 30), 0.92 + Math.random() * 0.16);
  }

  net(speed: number): void {
    this.play('net', Math.min(0.9, 0.35 + speed / 50), 0.8);
  }

  /** Ball off the turf (soft) or the boards, the wall or a stand (hard). */
  bounce(speed: number, hard = false): void {
    if (speed < 1.2) return;
    this.play(hard ? 'thwack' : 'bounce', Math.min(0.8, speed / 25), 0.9 + Math.random() * 0.2);
  }

  whistle(): void {
    this.play('whistle', 0.55);
  }

  /** A small UI tick for buttons. */
  tick(): void {
    this.ensure();
    this.play('tick', 0.35);
  }

  private play(name: SampleName, gain: number, rate = 1, at = 0, opts: PlayOpts = {}): void {
    const ctx = this.ensure();
    const buf = this.buffers.get(name);
    if (!ctx || !buf || !this.master) return;
    const t = Math.max(at, ctx.currentTime);
    const offset = opts.offset ?? 0;
    const length = Math.max(0.05, Math.min(opts.duration ?? Infinity, buf.duration - offset));
    const real = length / rate;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(rate, t);
    // Levelled, with a few milliseconds' fade at each end (no clicks cutting into a recording).
    const level = gain * (this.norm.get(name) ?? 1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.012);
    const fade = Math.min(real * 0.8, opts.fadeOut ?? 0.02);
    g.gain.setValueAtTime(level, t + real - fade);
    g.gain.linearRampToValueAtTime(0.0001, t + real);
    let node: AudioNode = src;
    if (opts.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.lowpass;
      node = node.connect(lp);
    }
    node.connect(g).connect(this.master);
    src.start(t, offset, length);
  }
}

export const sound = new Sound();
