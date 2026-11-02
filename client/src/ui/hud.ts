// In-match overlay: scoreboard, role badge, shot clock, banners, hints, sheets.

import { REGULATION_KICKS, nextShooter, type MatchState, type PlayerId } from '@fk/shared';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export type Tone = 'good' | 'bad' | 'info';

/** The controller's face-button shapes, drawn (not emoji): on the taunts and the toss's choices. */
export type Glyph = 'triangle' | 'circle' | 'cross' | 'square';

export class Hud {
  private readonly root = $('#hud');
  private readonly bannerEl = $('#banner');
  private readonly timerEl = $('#timer') as unknown as SVGSVGElement;
  private bannerTimer = 0;
  private toastTimer = 0;

  constructor(
    onQuit: () => void,
    onResetView: () => void,
    soundSetting: { on: () => boolean; set: (on: boolean) => void },
  ) {
    // Leaving a game asks first: a stray tap on ✕ shouldn't throw a match away.
    const confirm = $('#confirm-quit');
    $('#quit').addEventListener('click', () => (confirm.hidden = false));
    confirm.querySelector('[data-confirm="stay"]')!.addEventListener('click', () => (confirm.hidden = true));
    confirm.querySelector('[data-confirm="leave"]')!.addEventListener('click', () => {
      confirm.hidden = true;
      onQuit();
    });
    $('#view-reset').addEventListener('click', onResetView);
    const toggle = $('#sound-toggle');
    const sync = () => {
      toggle.classList.toggle('off', !soundSetting.on());
      toggle.setAttribute('aria-label', soundSetting.on() ? 'Mute' : 'Unmute');
    };
    toggle.addEventListener('click', () => {
      soundSetting.set(!soundSetting.on());
      sync();
    });
    sync();
  }

  /**
   * The wind for a field goal: an arrow (pointing up the screen = blowing
   * toward the posts) and its speed in mph; null hides it.
   */
  setWind(w: { angleDeg: number; mph: number } | null): void {
    const el = $('#wind');
    el.hidden = !w;
    if (!w) return;
    el.querySelector('svg')!.style.transform = `rotate(${w.angleDeg}deg)`;
    el.querySelector('svg')!.style.visibility = w.mph < 1 ? 'hidden' : 'visible';
    $('.speed', el).textContent = w.mph < 1 ? 'Calm' : `${w.mph} mph`;
  }

  /** The taunt buttons: each tap sends its index to `onPick` (tap as fast as you like). Returns a function that takes them away. */
  emotes(options: { glyph: Glyph; label: string }[], onPick: (i: number) => void): () => void {
    const bar = $('#emotes');
    bar.replaceChildren(
      ...options.map((o, i) => {
        const b = document.createElement('button');
        b.innerHTML = `<span class="glyph ${o.glyph}"></span><span class="label">${o.label}</span>`;
        // On the press (not the click), so rapid taps all land.
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          onPick(i);
          b.classList.remove('pop');
          void b.offsetWidth;
          b.classList.add('pop');
        });
        return b;
      }),
    );
    bar.hidden = false;
    return () => {
      bar.hidden = true;
      bar.replaceChildren();
    };
  }

  /** Sudden death: the screen's edges pulse red like a heartbeat, and the round goes red. */
  suddenDeath(on: boolean): void {
    document.body.classList.toggle('sudden-death', on);
  }

  /** Sudden death's title card: letterbox bars, a flash, the title slammed in. Resolves when it's gone. */
  suddenDeathCard(sub: string, ms = 3400): Promise<void> {
    const el = $('#sudden-death');
    $('.sub', el).textContent = sub;
    el.hidden = false;
    el.classList.remove('go', 'out');
    void el.offsetWidth;
    el.classList.add('go');
    return new Promise((resolve) => {
      window.setTimeout(() => el.classList.add('out'), ms - 400);
      window.setTimeout(() => {
        el.hidden = true;
        el.classList.remove('go', 'out');
        resolve();
      }, ms);
    });
  }

  /** What this kick means (it could win or lose the match): 'win' in gold, 'must' in red; null hides it. */
  setStakes(text: string | null, tone: 'win' | 'must' = 'must'): void {
    const el = $('#stakes');
    el.hidden = !text;
    el.textContent = text ?? '';
    el.className = tone;
  }

  /** The broadcast's replay wipe: resolves when the screen is covered (cut the camera then). */
  wipe(): Promise<void> {
    const el = $('#wipe');
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
    window.setTimeout(() => el.classList.remove('go'), 760);
    return new Promise((resolve) => window.setTimeout(resolve, 330));
  }

  /** The memory card notice, for a moment. */
  saving(ms = 2600): void {
    const el = $('#memcard');
    el.hidden = false;
    window.setTimeout(() => (el.hidden = true), ms);
  }

  /** The broadcast "REPLAY" tag. */
  replayTag(on: boolean): void {
    $('#replay-tag').hidden = !on;
  }

  /** Show the reset-camera button only once the player has moved the camera. */
  setViewAdjusted(on: boolean): void {
    $('#view-reset').hidden = !on;
  }

  /** One-line read-out of the last strike (speed, power, curl). */
  readout(text: string | null): void {
    $('#readout').textContent = text ?? '';
  }

  show(on: boolean): void {
    this.root.hidden = !on;
    if (!on) {
      this.prompt(null);
      this.hint(null);
      this.readout(null);
      this.setTimer(null);
      $('#wall-controls').hidden = true;
      $('#practice-bar').hidden = true;
      $('#confirm-quit').hidden = true;
      this.setWind(null);
      this.replayTag(false);
      this.setStakes(null);
      this.suddenDeath(false);
    }
  }

  setNames(names: [string, string]): void {
    names.forEach((n, i) => ($(`#scoreboard [data-player="${i}"] .name`).textContent = n));
  }

  setScoreboardVisible(on: boolean): void {
    $('#scoreboard').hidden = !on;
  }

  setScore(state: MatchState): void {
    const next = nextShooter(state);
    for (const p of [0, 1] as PlayerId[]) {
      const kicks = state.kicks.filter((k) => k.shooter === p);
      const total = Math.max(REGULATION_KICKS, kicks.length + (next === p ? 1 : 0));
      let html = '';
      for (let i = 0; i < total; i++) {
        const k = kicks[i];
        const sd = i >= REGULATION_KICKS ? ' sd' : '';
        if (k) html += k.scored ? `<span class="dot goal${sd}">✓</span>` : `<span class="dot miss${sd}">✕</span>`;
        else html += `<span class="dot${sd}${i === kicks.length && next === p ? ' next' : ''}"></span>`;
      }
      const row = $(`#scoreboard [data-player="${p}"]`);
      $('.dots', row).innerHTML = html;
      $('.goals', row).textContent = String(kicks.filter((k) => k.scored).length);
    }
  }

  setRound(text: string): void {
    $('#round').textContent = text;
  }

  setRole(text: string, keeping: boolean): void {
    const el = $('#role');
    el.textContent = text;
    el.classList.toggle('keep', keeping);
  }

  /** Shot clock ring; null hides it. */
  setTimer(remaining: number | null, total = 10): void {
    this.timerEl.toggleAttribute('hidden', remaining === null);
    if (remaining === null) return;
    const fill = this.timerEl.querySelector('.fill') as SVGCircleElement;
    fill.style.strokeDashoffset = String(113.1 * (1 - Math.max(0, remaining) / total));
    this.timerEl.querySelector('text')!.textContent = String(Math.ceil(Math.max(0, remaining)));
    this.timerEl.classList.toggle('low', remaining <= 3);
  }

  banner(title: string, sub = '', tone: Tone = 'info', ms = 1500): Promise<void> {
    $('.title', this.bannerEl).textContent = title;
    $('.sub', this.bannerEl).textContent = sub;
    this.bannerEl.className = `show ${tone}`;
    clearTimeout(this.bannerTimer);
    return new Promise((resolve) => {
      this.bannerTimer = window.setTimeout(() => {
        this.bannerEl.className = tone; // keep the tone's look while it fades out
        resolve();
      }, ms);
    });
  }

  prompt(text: string | null): void {
    $('#prompt').textContent = text ?? '';
  }

  hint(text: string | null, kind: 'shoot' | 'keep' | 'plain' = 'plain'): void {
    const el = $('#hint');
    el.className = text ? `show ${kind}` : '';
    $('.text', el).textContent = text ?? '';
    $('.finger', el).hidden = kind === 'plain';
  }

  toast(text: string): void {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 1400);
  }

  wallControls(size: number, max: number, onStep: (delta: number) => void, onDone: () => void): () => void {
    const sheet = $('#wall-controls');
    sheet.hidden = false;
    const label = $('#wall-size');
    const render = (n: number) => (label.textContent = n === 0 ? 'No wall' : `${n} player${n > 1 ? 's' : ''}`);
    render(size);
    const step = (e: Event) => {
      const d = Number((e.currentTarget as HTMLElement).dataset.step);
      size = Math.max(0, Math.min(max, size + d));
      render(size);
      onStep(d);
    };
    const buttons = Array.from(sheet.querySelectorAll<HTMLButtonElement>('[data-step]'));
    buttons.forEach((b) => b.addEventListener('click', step));
    const done = $('#wall-done');
    done.addEventListener('click', onDone);
    return () => {
      sheet.hidden = true;
      buttons.forEach((b) => b.removeEventListener('click', step));
      done.removeEventListener('click', onDone);
    };
  }

  practiceBar(): Promise<'again' | 'new' | 'menu'> {
    const bar = $('#practice-bar');
    bar.hidden = false;
    return new Promise((resolve) => {
      const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>('[data-choice]'));
      const pick = (e: Event) => {
        buttons.forEach((b) => b.removeEventListener('click', pick));
        bar.hidden = true;
        resolve((e.currentTarget as HTMLElement).dataset.choice as 'again' | 'new' | 'menu');
      };
      buttons.forEach((b) => b.addEventListener('click', pick));
    });
  }
}
