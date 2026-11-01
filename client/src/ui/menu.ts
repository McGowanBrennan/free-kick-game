// Menu screens: main, match setup, practice setup, how to play, settings and match end.

import type { Difficulty, MatchState, PlayerId, SpotCategory } from '@fk/shared';

/** Free kicks (shoot and keep) or field goals (kick only, the wind is the opponent). */
export type GameMode = 'freekick' | 'fieldgoal';

export interface MatchConfig {
  kind: 'match';
  mode: GameMode;
  difficulty: Difficulty;
}

export interface PracticeConfig {
  kind: 'practice';
  mode: GameMode;
  role: 'shoot' | 'keep' | 'alternate';
  category: SpotCategory | 'any';
  difficulty: Difficulty;
  trace: boolean;
}

export type GameConfig = MatchConfig | PracticeConfig;

const SCREENS = ['menu', 'match', 'practice', 'end', 'howto', 'settings'] as const;
const SEEN_HOWTO_KEY = 'fk.howto';
const INSTALL_TIP_KEY = 'fk.installTip';

/** What the settings screen controls. */
export interface MenuHooks {
  soundOn: () => boolean;
  setSound: (on: boolean) => void;
  resetViews: () => void;
  /** The retro picture (low-res, dithered, bloom) or a clean one */
  setRetro: (on: boolean) => void;
  /** Every button press (for the UI tick) */
  press: () => void;
}
type Screen = (typeof SCREENS)[number];

const DEFAULTS: Record<string, string> = { mode: 'freekick', difficulty: 'medium', role: 'shoot', category: 'any', trace: 'on', retro: 'on' };
const STORE_KEY = 'fk.menu';

function loadChoices(): Record<string, string> {
  try {
    const saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') };
    // A category saved before 'inside the box' became the penalty spot.
    if (saved.category === 'inside_box') saved.category = 'penalty';
    return saved;
  } catch {
    return { ...DEFAULTS };
  }
}

export class Menu {
  private readonly choices = loadChoices();
  private endResolve: ((v: 'rematch' | 'menu') => void) | null = null;

  constructor(
    private readonly onStart: (cfg: GameConfig) => void,
    private readonly hooks: MenuHooks,
  ) {
    this.choices.sound = hooks.soundOn() ? 'on' : 'off';
    hooks.setRetro(this.choices.retro !== 'off');
    this.syncMode();
    document.querySelectorAll<HTMLButtonElement>('.screen button, .sheet button').forEach((b) => b.addEventListener('click', () => hooks.press()));
    document.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      const key = seg.dataset.key!;
      const buttons = Array.from(seg.querySelectorAll<HTMLButtonElement>('button'));
      const sync = () => buttons.forEach((b) => b.classList.toggle('on', b.dataset.value === this.choices[key]));
      buttons.forEach((b) =>
        b.addEventListener('click', () => {
          this.choices[key] = b.dataset.value!;
          if (key === 'sound') hooks.setSound(b.dataset.value === 'on');
          if (key === 'retro') hooks.setRetro(b.dataset.value === 'on');
          if (key === 'mode') this.syncMode();
          document.querySelectorAll<HTMLElement>(`.seg[data-key="${key}"]`).forEach((s) =>
            s.querySelectorAll<HTMLButtonElement>('button').forEach((x) => x.classList.toggle('on', x.dataset.value === this.choices[key])),
          );
          try {
            localStorage.setItem(STORE_KEY, JSON.stringify(this.choices));
          } catch {
            // Storage unavailable (private mode): choices just won't persist.
          }
        }),
      );
      sync();
    });

    document.querySelectorAll<HTMLElement>('[data-go]').forEach((b) =>
      b.addEventListener('click', () => this.go(b.dataset.go!)),
    );
  }

  private show(screen: Screen | null): void {
    for (const s of SCREENS) document.getElementById(`screen-${s}`)!.hidden = s !== screen;
  }

  private go(target: string): void {
    const c = this.choices;
    switch (target) {
      case 'match':
      case 'practice':
      case 'howto':
      case 'settings':
        this.show(target);
        break;
      case 'howto-done':
        try {
          localStorage.setItem(SEEN_HOWTO_KEY, '1');
        } catch {
          // Storage unavailable: it'll just show again next time.
        }
        this.show('menu');
        break;
      case 'reset-views':
        this.hooks.resetViews();
        break;
      case 'menu':
        if (this.endResolve) {
          this.endResolve('menu');
          this.endResolve = null;
        }
        this.show('menu');
        break;
      case 'rematch':
        this.show(null);
        this.endResolve?.('rematch');
        this.endResolve = null;
        break;
      case 'start-match':
        this.show(null);
        this.onStart({ kind: 'match', mode: c.mode as GameMode, difficulty: c.difficulty as Difficulty });
        break;
      case 'start-practice':
        this.show(null);
        this.onStart({
          kind: 'practice',
          mode: c.mode as GameMode,
          role: c.role as PracticeConfig['role'],
          category: c.category as PracticeConfig['category'],
          difficulty: c.difficulty as Difficulty,
          trace: c.trace === 'on',
        });
        break;
    }
  }

  /** Field goals have no keeping and no spot categories: practice hides those settings. */
  private syncMode(): void {
    document.getElementById('screen-practice')!.dataset.mode = this.choices.mode;
  }

  /** On iPhone in a Safari tab, a one-time tip on installing to the home screen. */
  private installTip(): void {
    const tip = document.getElementById('install-tip')!;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(INSTALL_TIP_KEY) === '1';
    } catch {
      // Storage unavailable: show it.
    }
    tip.hidden = !ios || standalone || dismissed;
    tip.querySelector('button')!.onclick = () => {
      tip.hidden = true;
      try {
        localStorage.setItem(INSTALL_TIP_KEY, '1');
      } catch {
        // Storage unavailable: it'll show again next time.
      }
    };
  }

  /** The main menu; on the very first visit, how to play comes first. */
  open(): void {
    let seen = true;
    try {
      seen = localStorage.getItem(SEEN_HOWTO_KEY) === '1';
    } catch {
      // Storage unavailable: don't nag.
    }
    this.show(seen ? 'menu' : 'howto');
    this.installTip();
  }

  showEnd(state: MatchState, won: boolean, names: [string, string]): Promise<'rematch' | 'menu'> {
    const screen = document.getElementById('screen-end')!;
    const result = screen.querySelector('.end-result')!;
    result.textContent = won ? 'You win!' : 'You lose';
    result.className = `end-result ${won ? 'good' : 'bad'}`;
    const goals = (p: PlayerId) => state.kicks.filter((k) => k.shooter === p && k.scored).length;
    screen.querySelector('.end-score')!.textContent = `${goals(0)} – ${goals(1)}`;
    screen.querySelector('.end-kicks')!.innerHTML = ([0, 1] as PlayerId[])
      .map(
        (p) =>
          `<div class="row"><span class="label">${names[p]}</span>${state.kicks
            .filter((k) => k.shooter === p)
            .map((k) => (k.scored ? '<span class="dot goal">✓</span>' : '<span class="dot miss">✕</span>'))
            .join('')}</div>`,
      )
      .join('');
    this.show('end');
    return new Promise((resolve) => (this.endResolve = resolve));
  }
}
