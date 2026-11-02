// One game session (a match vs AI or a practice run): drives the kick flow of
// SPEC §5.3 and the match rules, locally. M3 moves authority to the server.

import {
  AI_PROFILES,
  DEFAULT_PARAMS,
  FG_BAR_Y,
  FG_HALF_WIDTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  KEEPER_Z,
  KeeperSim,
  RUNUP_TICKS,
  TICK_RATE,
  aiKeeper,
  aiKick,
  aiWall,
  analyzeSwipe,
  FIELD_GOAL_LIMITS,
  MAX_AIM_Y,
  aiFieldGoal,
  FG_OP_TIME,
  applyStrikeError,
  computeLaunch,
  fieldGoalLaunch,
  fieldGoalCam,
  fieldGoalSpot,
  fieldGoalWind,
  freeKickWind,
  createMatch,
  currentRound,
  goals,
  generateSpot,
  isSuddenDeath,
  kickStyle,
  mulberry32,
  nextShooter,
  planKeeper,
  recordKick,
  targetFromInput,
  v3,
  wallLayout,
  winner,
  type AiProfile,
  type CableCam,
  type FieldGoalResult,
  type FieldGoalSetup,
  type FieldGoalTag,
  type KeeperInput,
  type KickInput,
  type KickStyle,
  type LaunchState,
  type MatchState,
  type Outcome,
  type OutcomeTag,
  type PlayerId,
  type SimResult,
  type Spot,
  type SpotCategory,
  type SwipeSample,
  type Vec3,
  type WallConfig,
} from '@fk/shared';
import { sound } from '../audio/sound';
import type { Glyph, Hud } from '../ui/hud';
import type { GameConfig, Menu } from '../ui/menu';
import { KITS } from '../world/figure';
import { fieldGoalHeading, type CamPose, type World } from '../world/world';
import { COIN_FLIGHT, type CoinSide } from '../world/cointoss';
import type { Emote } from '../world/figure';
import type { Reaction } from '../audio/sound';
import { diveTarget, keeperInputFor, kickFromSwipe, plannedHands, screenRightOnGround } from './aim';
import type { Gestures } from './gestures';
import { snapBallAt } from '../world/fieldgoal-unit';
import { FieldGoalPlayback } from './fieldgoal-playback';
import { KickPlayback, type Playable } from './playback';
import type { ViewControl, ViewRole } from './view';

const P = DEFAULT_PARAMS;
/** Midfield, where the coin's tossed: the soccer pitch's centre spot, the gridiron's 50-yard line. */
const MIDFIELD_Z = { freekick: 52.5, fieldgoal: 60 * 0.9144 };
/** How long the player has to call the toss before it's called for them, s. */
const CALL_SECONDS = 5;
const AIM_SECONDS = 10;
/** Less time to think in sudden death. */
const SUDDEN_DEATH_AIM_SECONDS = 7;
const WALL_SECONDS = 8;

export class Quit extends Error {}
/** The server started the kick (or the toss) over (a reconnect): drop what's in hand and pick up the new one. */
export class Restart extends Error {}

export const CATEGORY_LABEL: Record<SpotCategory, string> = {
  penalty: 'Penalty',
  outside_box: 'Edge of the box',
  long_range: 'Long range',
  field_goal: 'Field goal',
};

export const FG_RESULT_TEXT: Record<FieldGoalTag, [string, string, OutcomeTag]> = {
  good: ["It's good!", '', 'clean'],
  doink_in: ["It's good!", 'Doink… and in off the woodwork', 'off_post'],
  wide_left: ['No good', 'Wide left', 'wide'],
  wide_right: ['No good', 'Wide right', 'wide'],
  short: ['No good', 'Short', 'short'],
  doink_out: ['Doink!', 'Off the woodwork and no good', 'woodwork_out'],
  blocked: ['Blocked!', 'Too low: into the hands at the line', 'wall'],
  cam: ['No good', 'Clattered the cable cam!', 'wall'],
};

/** The taunts: the keeper's on the line, and the field goal rush's right-hand gunner's. */
const TAUNTS: Record<'keeper' | 'gunner', { kind: Emote; glyph: Glyph; label: string; says: string }[]> = {
  keeper: [
    { kind: 'wobble', glyph: 'triangle', label: 'Jelly legs', says: 'Jelly legs on the line' },
    { kind: 'barslap', glyph: 'circle', label: 'Bar slap', says: 'Slapping the crossbar' },
    { kind: 'starman', glyph: 'square', label: 'Star man', says: 'Filling the goal' },
  ],
  gunner: [
    { kind: 'hype', glyph: 'triangle', label: 'Hype', says: 'Jumping up the crowd' },
    { kind: 'airplane', glyph: 'circle', label: 'Airplane', says: 'Doing the airplane' },
    { kind: 'wardance', glyph: 'square', label: 'War dance', says: 'Stomping it out' },
  ],
};

/** How a free kick went, for the home crowd (the player's): who it was good for, how near, how wild. */
export function freeKickReaction(r: SimResult, humanShoots: boolean): Reaction {
  const goal = r.outcome === 'goal';
  const c = r.lineCrossing;
  const off = c ? Math.hypot(Math.max(0, Math.abs(c.x) - GOAL_HALF_WIDTH), Math.max(0, c.y - GOAL_HEIGHT)) : Infinity;
  const near =
    ['off_post', 'off_bar', 'keeper_spill', 'woodwork_out', 'tipped_wide', 'tipped_over'].includes(r.tag) || (r.outcome === 'miss' && off < 0.7);
  const wild = r.tag === 'short' || ((r.tag === 'wide' || r.tag === 'over') && off > 3);
  return { homeGood: humanShoots === goal, humanActed: humanShoots || r.outcome === 'save', near, wild, goal };
}

/** How a field goal went, for the home crowd. */
export function fieldGoalReaction(r: FieldGoalResult, humanKicks: boolean): Reaction {
  const c = r.crossing;
  const wideBy = c ? Math.abs(c.x) - FG_HALF_WIDTH : Infinity;
  const shortBy = c ? FG_BAR_Y - c.y : Infinity;
  const near = r.tag === 'doink_in' || r.tag === 'doink_out' || r.tag === 'cam' || (!r.good && (wideBy < 0.8 || (shortBy > 0 && shortBy < 0.6)));
  const wild = r.tag === 'blocked' || (!r.good && (wideBy > 4 || shortBy > 2.5));
  return { homeGood: humanKicks === r.good, humanActed: humanKicks, near, wild, goal: r.good };
}

/** Metres to yards, for field goal distances. */
export const YARDS = 1 / 0.9144;

export const RESULT_TEXT: Record<OutcomeTag, [string, string]> = {
  clean: ['Goal!', ''],
  off_post: ['Goal!', 'In off the post'],
  off_bar: ['Goal!', 'In off the bar'],
  keeper_spill: ['Goal!', "Through the keeper's fingers"],
  deflection: ['Goal!', 'Deflected in off the wall'],
  caught: ['Saved', 'Held by the keeper'],
  parried: ['Saved', 'Parried away'],
  tipped_wide: ['Saved', 'Tipped around the post'],
  tipped_over: ['Saved', 'Tipped over the bar'],
  wall: ['Blocked', 'Charged down by the wall'],
  wide: ['Wide', ''],
  over: ['Over the bar', ''],
  woodwork_out: ['Off the woodwork', 'So close'],
  short: ['No goal', 'Not enough on it'],
  shot_clock: ['Too slow', 'Shot clock ran out'],
};

/** The result shows this long after the kick is decided, for this long, while play runs on. */
const RESULT_DELAY_TICKS = Math.round(0.12 * TICK_RATE);
export const RESULT_MS = 1400;
const LIVE_TAIL_TICKS = Math.round((RESULT_MS / 1000) * TICK_RATE);
/** The replay runs on past the decision long enough to see the keeper land. */
const REPLAY_TAIL_TICKS = Math.round(0.7 * TICK_RATE);

/** How strongly the camera turns to keep the ball in frame, by role. */
const TRACK: Record<ViewRole, number> = { shoot: 0.35, keep: 0.08, replay: 0.5 };
/** ...and at most this hard as it nears the goal (the keeper's high camera already holds the whole flight). */
const TRACK_MAX: Record<ViewRole, number> = { shoot: 0.95, keep: 0.2, replay: 0.95 };
/** The camera aims where the ball will be this far ahead, cancelling the tracking spring's lag. */
const LOOK_AHEAD_TICKS = Math.round(0.25 * TICK_RATE);
/** Tracking fades in over this long after contact instead of switching on. */
const TRACK_RAMP_TICKS = Math.round(0.35 * TICK_RATE);

interface KickOutcome {
  outcome: Outcome;
  tag: OutcomeTag;
  scored: boolean;
}

interface Playing {
  pb: Playable;
  /** performance.now() at tick −pre for live play; 0 for replays */
  start: number;
  /** Live play starts this many ticks before contact (the run-up, or a field goal's snap) */
  pre: number;
  tick: number;
  end: number;
  slow: [number, number] | null;
  track: number;
  /** Sounds have been played for everything up to this tick */
  heard: number;
  /** Don't let the camera follow the ball behind this z (the keeper's camera is behind the net) */
  trackMinZ: number;
  trackMax: number;
  /** The shooter's camera chasing the ball up the pitch (live shooting only) */
  chase: Chase | null;
  /** When the result banner goes up, and what raises it (live only) */
  resultTick: number;
  onResult: (() => void) | null;
  /** Called once when the ball is struck */
  onContact: (() => void) | null;
  /** Called once the moment it goes in (live only): the cheer goes up then, not when the result's shown */
  onScore: (() => void) | null;
  done: () => void;
}

const STYLE_TEXT: Record<KickStyle, string> = { instep: '', curler: 'Curler · ', trivela: 'Trivela · ', chip: 'Chip · ' };

interface Chase {
  from: CamPose;
  to: CamPose;
  pivotFrom: Vec3;
  pivotTo: Vec3;
  /** How far the ball has come toward goal (0 … 1, never goes back) */
  reached: number;
  /** Camera progress, spring-smoothed toward `reached` */
  s: number;
  v: number;
}

/** Stiffness of the chase camera's progress spring, rad/s. */
const CHASE_OMEGA = 4;

/** Field goal read-out: speed, how steeply it went up, and any hook or slice. */
export function describeFieldGoal(k: KickInput, launch: LaunchState): string {
  const v = launch.vel;
  const mph = Math.round(Math.hypot(v.x, v.y, v.z) * 2.237);
  const deg = Math.round((Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180) / Math.PI);
  // Bent toward the aim from where it set off (on the posts' plane).
  const bend = Math.abs(k.x - k.sx) > 0.5 ? (k.x > k.sx ? ' · bends right' : ' · bends left') : '';
  const over = k.p > P.overhitThreshold ? ' · overhit!' : '';
  return `${mph} mph · ${deg}° up${bend}${over}`;
}

export function describeKick(k: KickInput, launch: LaunchState, spot: Spot): string {
  const v = launch.vel;
  const kmh = Math.round(Math.hypot(v.x, v.y, v.z) * 3.6);
  const style = kickStyle(k, launch, P);
  const s = launch.spin.y / P.maxSpin;
  const curl = Math.round(Math.abs(s) * 100);
  const curlText = style === 'chip' || curl === 0 ? '' : ` · curl ${curl}% ${s > 0 ? '↶' : '↷'}`;
  const name = style === 'chip' && spot.category === 'penalty' && Math.abs(k.x) < 1.5 ? 'Panenka · ' : STYLE_TEXT[style];
  const over = k.p > P.overhitThreshold && !k.chip ? ' · overhit!' : '';
  return `${name}${kmh} km/h · power ${Math.round(k.p * 100)}%${curlText}${over}`;
}

export class Session {
  protected readonly abort = new AbortController();
  protected readonly rand = mulberry32((Math.random() * 2 ** 32) >>> 0);
  protected readonly profile: AiProfile;
  protected readonly seed = (Math.random() * 2 ** 31) | 0;
  protected playing: Playing | null = null;
  /** Per-frame pose while nothing is in flight (intro, wall, aim) */
  protected idle: (() => void) | null = null;
  protected hints = { shoot: 0, keep: 0, camera: 0, cam: 0, taunt: 0, wind: 0 };
  /** This kick could decide the match: the crowd hushes while it's lined up */
  protected pressure = false;
  /** Sudden death: a shorter shot clock */
  protected suddenDeath = false;

  constructor(
    protected readonly world: World,
    protected readonly hud: Hud,
    protected readonly gestures: Gestures,
    protected readonly view: ViewControl,
    protected readonly menu: Menu,
    protected readonly cfg: GameConfig,
  ) {
    this.profile = AI_PROFILES[cfg.kind === 'online' ? 'medium' : cfg.difficulty];
  }

  quit(): void {
    this.abort.abort();
  }

  /** Resolves with what to do next. */
  async run(): Promise<'rematch' | 'menu'> {
    this.hud.show(true);
    try {
      return this.cfg.kind === 'match' ? await this.runMatch() : await this.runPractice();
    } catch (e) {
      if (e instanceof Quit) return 'menu';
      throw e;
    } finally {
      this.gestures.mode = 'none';
      this.gestures.onTap = null;
      this.view.setRole(null);
      this.world.rig.setTrack(null);
      this.hud.show(false);
      this.world.setTrace(null);
    }
  }

  // ── Async helpers that stop when the player quits ──────────────────────

  /** A tap skips the replay (not online: both players watch it through, so they stay in step) */
  protected replaySkippable = true;

  /** Called off (online: the server started the kick over) */
  protected kickAbort = new AbortController();

  protected guard<T>(executor: (resolve: (v: T) => void) => (() => void) | void): Promise<T> {
    const signal = this.abort.signal;
    const kick = this.kickAbort.signal;
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) return reject(new Quit());
      if (kick.aborted) return reject(new Restart());
      let cleanup: (() => void) | void = undefined;
      const onAbort = () => {
        kick.removeEventListener('abort', onRestart);
        cleanup?.();
        reject(new Quit());
      };
      const onRestart = () => {
        signal.removeEventListener('abort', onAbort);
        cleanup?.();
        reject(new Restart());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      kick.addEventListener('abort', onRestart, { once: true });
      cleanup = executor((v) => {
        signal.removeEventListener('abort', onAbort);
        kick.removeEventListener('abort', onRestart);
        cleanup?.();
        resolve(v);
      });
    });
  }

  protected sleep(ms: number): Promise<void> {
    return this.guard<void>((done) => {
      const id = window.setTimeout(done, ms);
      return () => clearTimeout(id);
    });
  }

  protected async banner(title: string, sub: string, tone: 'good' | 'bad' | 'info', ms: number): Promise<void> {
    await Promise.race([this.hud.banner(title, sub, tone, ms), this.guard<void>(() => undefined)]);
  }

  // ── Modes ──────────────────────────────────────────────────────────────

  protected async runMatch(): Promise<'rematch' | 'menu'> {
    const fieldGoals = this.cfg.mode === 'fieldgoal';
    const level = this.cfg.kind === 'online' ? 'medium' : this.cfg.difficulty;
    const names: [string, string] = ['You', `AI ${level[0].toUpperCase()}${level.slice(1)}`];
    this.hud.setNames(names);
    this.hud.setScoreboardVisible(true);
    let state = createMatch(await this.coinToss(fieldGoals, names[1]));
    this.hud.setScore(state);

    // Both players kick from the same spot each round, in the same wind.
    let spot: Spot | null = null;
    let wind = v3();
    let cam: CableCam | null = null;
    let shooter: PlayerId | null;
    while ((shooter = nextShooter(state)) !== null) {
      const round = currentRound(state);
      if (state.kicks.length % 2 === 0 || !spot) {
        const rng = mulberry32(this.seed + round * 7919);
        spot = fieldGoals ? fieldGoalSpot(rng, round) : generateSpot(rng);
        wind = fieldGoals ? fieldGoalWind(rng, round) : freeKickWind(rng, round);
        cam = fieldGoals ? fieldGoalCam(rng, round, spot, P) : null;
      }
      const sd = isSuddenDeath(round);
      if (sd && !this.suddenDeath) await this.suddenDeathIntro(spot, fieldGoals);
      const label = sd ? `Sudden death · round ${round}` : `Round ${round} of 5`;
      this.hud.setRound(label);
      this.world.stadium.setScreens([label.toUpperCase(), `${goals(state, 0)} – ${goals(state, 1)}`, `YOU v ${names[1].toUpperCase()}`]);
      const stakes = this.stakes(state, shooter, fieldGoals);
      this.hud.setStakes(stakes?.text ?? null, stakes?.tone);
      this.pressure = !!stakes || sd;
      const res = fieldGoals ? await this.playFieldGoal(spot, wind, cam, shooter === 0) : await this.playKick(spot, wind, shooter === 0);
      this.hud.setStakes(null);
      this.pressure = false;
      state = recordKick(state, { shooter, ...res });
      this.hud.setScore(state);
      const scoredText = fieldGoals ? "IT'S GOOD!" : 'GOAL!';
      this.world.stadium.setScreens([res.scored ? scoredText : label.toUpperCase(), `${goals(state, 0)} – ${goals(state, 1)}`, `YOU v ${names[1].toUpperCase()}`]);
    }
    const won = winner(state) === 0;
    this.world.stadium.setScreens(['FULL TIME', `${goals(state, 0)} – ${goals(state, 1)}`, won ? 'YOU WIN!' : `${names[1].toUpperCase()} WINS`]);
    if (won) this.world.stadium.cheer(1);
    await this.banner(won ? 'You win!' : 'You lose', '', won ? 'good' : 'bad', 1800);
    this.hud.show(false);
    this.hud.saving();
    return this.menu.showEnd(state, won, names);
  }

  protected async runPractice(): Promise<'menu'> {
    if (this.cfg.kind !== 'practice') return 'menu';
    const cfg = this.cfg;
    this.hud.setScoreboardVisible(false);
    this.hud.setRound('Practice');
    if (cfg.mode === 'fieldgoal') return this.runFieldGoalPractice();
    this.world.stadium.setScreens(['PRACTICE', 'FREE KICK', 'TRAINING SESSION']);
    // Each new spot comes with a random round's wind.
    const pick = (): [Spot, Vec3] => [
      generateSpot(this.rand, cfg.category === 'any' ? undefined : cfg.category),
      freeKickWind(this.rand, 1 + Math.floor(this.rand() * 6)),
    ];
    let [spot, wind] = pick();
    let shoot = cfg.role !== 'keep';
    for (;;) {
      await this.playKick(spot, wind, shoot);
      const choice = await Promise.race([this.hud.practiceBar(), this.guard<never>(() => undefined)]);
      if (choice === 'menu') return 'menu';
      if (choice === 'new') [spot, wind] = pick();
      if (cfg.role === 'alternate') shoot = !shoot;
    }
  }

  /** Field goal practice: you kick; each new spot is from a random round's range and wind. */
  protected async runFieldGoalPractice(): Promise<'menu'> {
    this.world.stadium.setScreens(['PRACTICE', 'FIELD GOALS', 'TRAINING SESSION']);
    const pick = (): [Spot, Vec3, CableCam | null] => {
      const round = 1 + Math.floor(this.rand() * 6);
      const spot = fieldGoalSpot(this.rand, round);
      const wind = fieldGoalWind(this.rand, round);
      return [spot, wind, fieldGoalCam(this.rand, round, spot, P)];
    };
    let [spot, wind, cam] = pick();
    for (;;) {
      await this.playFieldGoal(spot, wind, cam, true);
      const choice = await Promise.race([this.hud.practiceBar(), this.guard<never>(() => undefined)]);
      if (choice === 'menu') return 'menu';
      if (choice === 'new') [spot, wind, cam] = pick();
    }
  }

  /**
   * What the next kick means, if it could decide the match: from the player's
   * side, whether it can win it or lose it (null: neither).
   */
  protected stakes(state: MatchState, shooter: PlayerId, fieldGoals: boolean): { text: string; tone: 'win' | 'must' } | null {
    const ifScored = winner(recordKick(state, { shooter, scored: true, outcome: 'goal', tag: 'clean' }));
    const ifMissed = winner(recordKick(state, { shooter, scored: false, outcome: 'miss', tag: 'wide' }));
    if (shooter === 0) {
      if (ifScored === 0) return { text: fieldGoals ? 'Make it to win' : 'Score to win', tone: 'win' };
      if (ifMissed === 1) return { text: fieldGoals ? 'Must make' : 'Must score', tone: 'must' };
    } else {
      if (ifMissed === 0) return { text: fieldGoals ? 'A miss wins it' : 'Save to win', tone: 'win' };
      if (ifScored === 1) return { text: fieldGoals ? 'Need a miss' : 'Must save', tone: 'must' };
    }
    return null;
  }

  /**
   * Level after five: the game stops for it. The ground holds its breath,
   * the bars come in and the title slams down as it erupts; from here the
   * screen's edges pulse, the shot clock is shorter, and the crowd hushes
   * for every kick.
   */
  protected async suddenDeathIntro(spot: Spot, fieldGoals: boolean): Promise<void> {
    // (The view: low behind the goal, looking out at the field, rising to the spot.)
    const { world, hud } = this;
    this.suddenDeath = true;
    this.view.setRole(null);
    world.rig.setTrack(null);
    hud.setRound('Sudden death');
    world.stadium.setScreens(['SUDDEN DEATH', 'NEXT MISS', 'COULD END IT']);
    sound.setPhase('between');
    sound.suddenDeath(0.85);
    world.rig.set(world.suddenDeathCam());
    void world.rig.flyTo(world.aerialCam(spot), 3.4);
    window.setTimeout(() => world.stadium.cheer(1), 850);
    hud.suddenDeath(true);
    await Promise.race([
      hud.suddenDeathCard(fieldGoals ? 'Make it, and make them match it' : 'Score, and make them match it'),
      this.guard<void>(() => undefined),
    ]);
  }

  // ── The coin toss ──────────────────────────────────────────────────────

  /**
   * Midfield before the match: the captains shake hands, the player calls it,
   * the referee flips it and points to the winner, and the winner chooses:
   * kick first, or keep (defend) first. Returns who kicks first.
   */
  /** The coin toss scene at midfield: returns its clock (s since it began). */
  protected startTossScene(fieldGoals: boolean): () => number {
    const { world, hud } = this;
    const mode = fieldGoals ? 'fieldgoal' : 'freekick';
    world.setMode(mode);
    world.coinToss.setup(fieldGoals ? 'football' : 'soccer', fieldGoals ? KITS.fbYou : KITS.you, fieldGoals ? KITS.fbAi : KITS.ai, MIDFIELD_Z[mode]);
    world.showCoinToss(true);
    sound.setTheme(fieldGoals ? 'football' : 'soccer');
    sound.setPhase('between');
    sound.setCrowd(0.45, 1.5);
    hud.setRound('Coin toss');
    this.view.setRole(null);
    world.rig.setTrack(null);
    const t0 = performance.now();
    const clock = () => (performance.now() - t0) / 1000;
    this.idle = () => {
      world.coinToss.pose(clock());
      world.rig.set(world.coinToss.cam(clock(), world.camera.aspect));
    };
    return clock;
  }

  protected endTossScene(): void {
    this.idle = null;
    this.world.showCoinToss(false);
  }

  /** Two buttons along the bottom; resolves with the index tapped, or `fallback` after `ms`. */
  protected pick(options: { glyph: Glyph; label: string }[], ms: number, fallback: number, onTimeout?: () => void): Promise<number> {
    return this.guard<number>((done) => {
      const close = this.hud.emotes(options, done);
      const id = window.setTimeout(() => {
        onTimeout?.();
        done(fallback);
      }, ms);
      return () => {
        close();
        clearTimeout(id);
      };
    });
  }

  protected async coinToss(fieldGoals: boolean, aiName: string): Promise<PlayerId> {
    const { world, hud } = this;
    const clock = this.startTossScene(fieldGoals);
    try {
      await this.sleep(1700);
      // The player calls it (or it's called for them). Messages go up top: the middle of the screen is the coin's.
      hud.setRound('Coin toss · call it!');
      const call = await this.guard<CoinSide>((done) => {
        const close = hud.emotes(
          [
            { glyph: 'circle', label: 'Heads' },
            { glyph: 'cross', label: 'Tails' },
          ],
          (i) => done(i === 0 ? 'heads' : 'tails'),
        );
        const id = window.setTimeout(() => {
          hud.toast('Called heads for you');
          done('heads');
        }, CALL_SECONDS * 1000);
        return () => {
          close();
          clearTimeout(id);
        };
      });
      hud.setRound(`Coin toss · you called ${call}`);
      const side: CoinSide = this.rand() < 0.5 ? 'heads' : 'tails';
      const won = side === call;
      world.coinToss.flip(side, won ? 'you' : 'ai', clock());
      sound.setCrowd(0.65, 0.4);
      await this.sleep(COIN_FLIGHT * 1000 + 350);
      sound.taunt(won);
      world.stadium.cheer(won ? 0.6 : 0.2);
      sound.setCrowd(won ? 0.6 : 0.35, 1.5);
      await this.banner(side === 'heads' ? 'Heads!' : 'Tails!', won ? 'You won the toss' : `${aiName} won the toss`, won ? 'good' : 'info', 1500);
      // The winner chooses.
      const kickWord = fieldGoals ? 'Kick' : 'Shoot';
      const keepWord = fieldGoals ? 'Defend' : 'Keep';
      let kickFirst: boolean;
      if (won) {
        hud.setRound('You won the toss · choose');
        kickFirst = await this.guard<boolean>((done) => {
          const close = hud.emotes(
            [
              { glyph: 'cross', label: `${kickWord} first` },
              { glyph: 'square', label: `${keepWord} first` },
            ],
            (i) => done(i === 0),
          );
          const id = window.setTimeout(() => {
            hud.toast(`${kickWord}ing first`);
            done(true);
          }, CALL_SECONDS * 1000);
          return () => {
            close();
            clearTimeout(id);
          };
        });
      } else {
        // The AI usually takes the first kick (getting a goal on the board first), not always.
        hud.setRound(`${aiName} is choosing…`);
        await this.sleep(900);
        kickFirst = this.rand() < 0.7;
      }
      const youFirst = won === kickFirst;
      hud.setRound('Coin toss');
      const choice = `${won ? 'You' : aiName} chose to ${(kickFirst ? kickWord : keepWord).toLowerCase()} first`;
      await this.banner(youFirst ? `You ${kickWord.toLowerCase()} first` : `${aiName} ${kickWord.toLowerCase()}s first`, choice, 'info', 1800);
      return youFirst ? 0 : 1;
    } finally {
      this.endTossScene();
    }
  }

  // ── One field goal ─────────────────────────────────────────────────────

  /**
   * A field goal (SPEC §15): the spot, the hash, the wind and the cable cam
   * revealed; the unit sets, and the kicker's swipe calls for the snap. The
   * kick is away a fixed operation time later, so the only question is the
   * swipe: high enough over the hands at the line, into the wind, and clear
   * of the cam wherever it'll have swung to by then.
   */
  protected async playFieldGoal(spot: Spot, wind: Vec3, cam: CableCam | null, humanKicks: boolean): Promise<KickOutcome> {
    const { world, hud } = this;
    world.setMode('fieldgoal');
    world.setFieldGoalTeams(humanKicks ? KITS.fbYou : KITS.fbAi, humanKicks ? KITS.fbAi : KITS.fbYou);
    world.setSpot(spot);
    world.setWind(wind);
    world.setCableCam(cam);
    world.opTime = FG_OP_TIME;
    sound.setTheme('football');
    sound.setPhase('between');
    hud.setRole(humanKicks ? 'You kick' : 'AI kicks', false);
    hud.readout(null);
    const mph = this.showWind(wind, fieldGoalHeading(spot));
    // The round's clock: the cam swings on it from the start.
    const t0 = performance.now();
    const clock = () => (performance.now() - t0) / 1000;
    this.idle = () => {
      world.pose(snapBallAt(spot, -1), null, 0, -10, -1);
      world.poseCableCam(clock());
    };

    this.view.setRole(null);
    world.rig.setTrack(null);
    world.rig.set(world.aerialCam(spot));
    sound.setCrowd(0.35, 2);
    const windText = mph < 1 ? 'calm' : `wind ${mph} mph`;
    const hash = spot.x < -1 ? 'left hash' : spot.x > 1 ? 'right hash' : 'middle';
    await Promise.all([
      this.banner('Field goal', `${Math.round(spot.distance * YARDS)} yards · ${hash} · ${windText}`, 'info', 1600),
      world.rig.flyTo(world.shooterCam(spot), 1.7),
    ]);
    this.view.setRole('shoot', v3(spot.x, 0.6, spot.z));
    if (cam && humanKicks && this.hints.cam++ === 0) hud.toast('Mind the cable cam: it swings across the field');
    sound.setPhase(humanKicks ? 'home' : 'away');
    if (this.pressure) sound.hush(true);

    let kick: KickInput | null;
    let contact: number;
    if (humanKicks) {
      const heckle = this.aiTaunt('gunner');
      kick = await this.humanAim(spot, FIELD_GOAL_LIMITS.maxAimY);
      heckle();
      contact = clock() + FG_OP_TIME;
    } else {
      // The AI takes its time (time to give it some from the edge), waits for its moment, then nods for the snap.
      const closeTaunts = this.tauntBar('gunner');
      const ai = aiFieldGoal({ spot, wind, cam }, this.profile, this.rand, P, clock() + 3.2 + FG_OP_TIME);
      kick = ai.kick;
      contact = ai.clock;
      hud.prompt('Kicker lining up…');
      await this.sleep(Math.max(0, (contact - FG_OP_TIME - clock()) * 1000));
      closeTaunts();
      // Not with the gunner mid-taunt: wait for him to get back down, and the cam for its next gap.
      if (world.emoteBusy) {
        await this.until(() => !world.emoteBusy, 2000);
        contact = aiFieldGoal({ spot, wind, cam }, this.profile, this.rand, P, clock() + 0.3 + FG_OP_TIME).clock;
        await this.sleep(Math.max(0, (contact - FG_OP_TIME - clock()) * 1000));
      }
      hud.prompt(null);
    }
    if (!kick) {
      sound.hush(false);
      world.setCableCam(null);
      hud.setWind(null);
      sound.react({ homeGood: false, humanActed: true, near: false, wild: true });
      sound.setPhase('between');
      await this.banner('Delay of game', 'The play clock ran out', 'bad', 1500);
      return { outcome: 'miss', tag: 'shot_clock', scored: false };
    }
    sound.bounce(3);
    const setup: FieldGoalSetup = { spot, wind, opTime: FG_OP_TIME, cam, clock: contact };
    const launch = applyStrikeError(fieldGoalLaunch(spot, kick, P), kick, this.rand, P);
    if (humanKicks) {
      world.showAim(targetFromInput(kick, FIELD_GOAL_LIMITS));
      hud.readout(describeFieldGoal(kick, launch));
    }
    world.kickStyle = 'instep';
    const pb = new FieldGoalPlayback(setup, launch);
    world.setRefCall({ at: pb.result.decidedTick / TICK_RATE, good: pb.result.good });
    this.idle = null;
    let shown: Promise<void> = Promise.resolve();
    await this.playLive(pb, false, () => {
      const r = pb.result;
      const [title, sub] = FG_RESULT_TEXT[r.tag];
      const react = fieldGoalReaction(r, humanKicks);
      sound.react(react);
      sound.setCrowd(react.homeGood ? 0.7 : 0.3, 3);
      world.stadium.cheer(react.homeGood ? 1 : react.near ? 0.5 : 0.15);
      shown = this.banner(title, sub, humanKicks === r.good ? 'good' : 'bad', RESULT_MS);
    }, { from: { start: performance.now(), pre: Math.round(FG_OP_TIME * TICK_RATE) }, onScore: () => {
      sound.goal(humanKicks);
      world.stadium.cheer(humanKicks ? 1 : 0.4);
    } });
    await shown;
    if (this.cfg.kind === 'practice' && this.cfg.trace) world.setTrace(pb.result.frames!.ball);
    await this.playReplay(pb);
    world.rig.setTrack(null);
    hud.setWind(null);
    const rest = pb.lastTick;
    const restAt = performance.now();
    this.idle = () => {
      world.pose(pb.ballAt(rest), null, 0, rest / TICK_RATE);
      world.poseCableCam(pb.camClock(rest) + (performance.now() - restAt) / 1000);
    };
    const [, , tag] = FG_RESULT_TEXT[pb.result.tag];
    return { outcome: pb.result.good ? 'goal' : 'miss', tag, scored: pb.result.good };
  }

  /** The wind on the HUD, as the view (looking along `fwd`) shows it; returns its speed in mph. */
  protected showWind(wind: Vec3, fwd: { x: number; z: number }): number {
    // Along the view (+ = from behind) and across it (+ = to the right).
    const along = wind.x * fwd.x + wind.z * fwd.z;
    const across = wind.x * -fwd.z + wind.z * fwd.x;
    const mph = Math.round(Math.hypot(wind.x, wind.z) * 2.237);
    this.hud.setWind({ angleDeg: (Math.atan2(across, along) * 180) / Math.PI, mph });
    return mph;
  }

  // ── Taunts ─────────────────────────────────────────────────────────────

  /** The player's taunt buttons (as the keeper, or the gunner on a field goal), while the opposition lines up. */
  protected tauntBar(who: 'keeper' | 'gunner'): () => void {
    const list = TAUNTS[who];
    if (this.hints.taunt++ === 0) this.hud.toast('Get in their head: pick a taunt');
    // Spam away: every tap cuts straight into that taunt.
    return this.hud.emotes(list, (i) => {
      this.world.emote(who, list[i].kind);
      sound.taunt(true);
      this.onTaunt(list[i].kind);
    });
  }

  /** The player taunted (online: the friend sees it). */
  protected onTaunt(_kind: Emote): void {}

  /** The AI's keeper or gunner sometimes has a go while the player lines up: a burst of two to four taunts. Returns a cancel. */
  protected aiTaunt(who: 'keeper' | 'gunner'): () => void {
    if (this.rand() > 0.5) return () => undefined;
    const ids: number[] = [];
    let at = 900 + this.rand() * 1500;
    const n = 2 + Math.floor(this.rand() * 3);
    for (let k = 0; k < n; k++) {
      const t = TAUNTS[who][Math.floor(this.rand() * 3)];
      ids.push(
        window.setTimeout(() => {
          this.world.emote(who, t.kind);
          sound.taunt(false);
          if (k === 0) this.hud.toast(`${who === 'keeper' ? 'Keeper' : 'Gunner'}: ${t.says}`);
        }, at),
      );
      at += 450 + this.rand() * 500;
    }
    return () => ids.forEach((id) => clearTimeout(id));
  }

  /** Resolve once `cond` holds (checked every 50 ms), or after `maxMs` regardless (a spammed taunt can't hold the kick up for ever). */
  protected until(cond: () => boolean, maxMs = Infinity): Promise<void> {
    if (cond()) return Promise.resolve();
    const end = performance.now() + maxMs;
    return this.guard<void>((done) => {
      const id = window.setInterval(() => (cond() || performance.now() > end) && done(), 50);
      return () => clearInterval(id);
    });
  }

  // ── One kick ───────────────────────────────────────────────────────────

  protected async playKick(spot: Spot, wind: Vec3, humanShoots: boolean): Promise<KickOutcome> {
    const { world, hud } = this;
    world.setMode('freekick');
    world.setWind(wind);
    const humanKeeps = !humanShoots;
    const role: ViewRole = humanShoots ? 'shoot' : 'keep';
    const pivot = humanShoots ? v3(spot.x, 0.6, spot.z) : v3(spot.keeperX, 1, KEEPER_Z);
    world.setKits(humanShoots ? KITS.you : KITS.ai, humanKeeps ? KITS.youKeeper : KITS.aiKeeper, humanKeeps ? KITS.you : KITS.ai);
    world.setSpot(spot);
    hud.setRole(humanShoots ? 'You shoot' : 'You keep', humanKeeps);
    hud.readout(null);
    sound.setTheme('soccer');
    sound.setPhase('between');
    // The wind as each view shows it: the shooter looks at the goal, the keeper out at the ball.
    const toGoal = fieldGoalHeading(spot);
    const mph = this.showWind(wind, humanShoots ? toGoal : { x: -toGoal.x, z: -toGoal.z });
    const windText = mph < 1 ? 'calm' : `wind ${mph} mph`;

    const stance = new KeeperSim(planKeeper(null, spot.keeperX, P), spot.keeperX, P).partsAt(0);
    const ballAtSpot = v3(spot.x, 0.11, spot.z);
    this.idle = () => world.pose(ballAtSpot, stance, 0, -1.2);

    // Spot reveal.
    this.view.setRole(null);
    world.rig.setTrack(null);
    world.rig.set(world.aerialCam(spot));
    sound.setCrowd(0.35, 2);
    const roleCam = humanShoots ? world.shooterCam(spot) : world.keeperCam(spot);
    await Promise.all([
      this.banner(CATEGORY_LABEL[spot.category], `${Math.round(spot.distance)} m · ${windText}`, 'info', 1500),
      world.rig.flyTo(roleCam, 1.7),
    ]);
    this.view.setRole(role, pivot);
    if (this.hints.camera++ === 0) hud.toast('Two fingers to move the camera');
    else if (humanShoots && mph >= 6 && this.hints.wind++ === 0) hud.toast('Mind the wind: it carries the ball, so aim off');

    // Wall.
    let wall: WallConfig | null = null;
    if (spot.maxWall > 0) {
      if (humanKeeps) wall = await this.humanWall(spot);
      else {
        wall = aiWall(spot, this.rand);
        if (wall) world.setWall(wallLayout(spot, wall).players);
        hud.prompt('Keeper setting the wall…');
        await this.sleep(800);
        hud.prompt(null);
      }
    }

    // Aim.
    sound.setPhase(humanShoots ? 'home' : 'away');
    if (this.pressure) sound.hush(true);
    let kick: KickInput | null;
    if (humanShoots) {
      const heckle = this.aiTaunt('keeper');
      kick = await this.humanAim(spot);
      heckle();
    } else {
      // The shooter takes a moment over it: time for the keeper to get in his head.
      const closeTaunts = this.tauntBar('keeper');
      hud.prompt('Shooter lining up…');
      await this.sleep(2600 + this.rand() * 1200);
      closeTaunts();
      await this.until(() => !world.emoteBusy, 2000);
      hud.prompt(null);
      kick = aiKick(spot, wall, this.profile, this.rand, P, wind);
    }
    if (!kick) {
      sound.hush(false);
      hud.setWind(null);
      sound.react({ homeGood: false, humanActed: true, near: false, wild: true });
      sound.setPhase('between');
      await this.banner(...RESULT_TEXT.shot_clock, 'bad', 1500);
      return { outcome: 'miss', tag: 'shot_clock', scored: false };
    }
    // Run-up, flight, keeper reaction.
    const setup = { spot, wall, wind };
    // The strike as meant, then the execution error every strike carries (the aim marker shows the former).
    const launch = applyStrikeError(computeLaunch(spot, kick, P), kick, this.rand, P);
    if (humanShoots) {
      world.showAim(targetFromInput(kick));
      hud.readout(describeKick(kick, launch, spot));
    }
    world.kickStyle = kickStyle(kick, launch, P);
    const pb = new KickPlayback(setup, launch, humanKeeps ? null : aiKeeper(setup, launch, this.profile, this.rand, P));
    this.idle = null;
    // The result banner comes up over the play as soon as the kick is decided,
    // while the keeper lands and the ball runs on.
    let shown: Promise<void> = Promise.resolve();
    await this.playLive(pb, humanKeeps, () => {
      const r = pb.result;
      const [title, sub] = RESULT_TEXT[r.tag];
      const react = freeKickReaction(r, humanShoots);
      sound.react(react);
      this.world.stadium.cheer(react.homeGood ? 1 : react.near ? 0.45 : 0.15);
      sound.setCrowd(react.homeGood ? 0.7 : 0.3, 3);
      shown = this.banner(title, sub, humanShoots === (r.outcome === 'goal') ? 'good' : 'bad', RESULT_MS);
    }, { onScore: () => {
      sound.goal(humanShoots);
      this.world.stadium.cheer(humanShoots ? 1 : 0.4);
    } });
    await shown;

    const r = pb.result;
    if (this.cfg.kind === 'practice' && this.cfg.trace) world.setTrace(r.frames!.ball);
    const scored = r.outcome === 'goal';
    await this.playReplay(pb);
    world.rig.setTrack(null);
    hud.setWind(null);
    const rest = pb.lastTick;
    this.idle = () => world.pose(pb.ballAt(rest), pb.keeperAt(rest), pb.wallYAt(rest), rest / TICK_RATE);
    return { outcome: r.outcome, tag: r.tag, scored };
  }

  protected humanWall(spot: Spot): Promise<WallConfig | null> {
    const cfg: WallConfig = { size: spot.maxWall, offset: 0 };
    const apply = () => this.world.setWall(wallLayout(spot, cfg).players);
    apply();
    // Positive offsets slide the wall toward the shooter's right of the ball→near-post line.
    const side = spot.x >= 0 ? 1 : -1;
    const lx = side * GOAL_HALF_WIDTH - spot.x;
    const lz = -spot.z;
    const ll = Math.hypot(lx, lz);
    const tangent = { x: -lz / ll, z: lx / ll };
    this.hud.setTimer(WALL_SECONDS, WALL_SECONDS);
    const deadline = performance.now() + WALL_SECONDS * 1000;
    return this.guard<WallConfig | null>((resolve) => {
      const finish = () => resolve(cfg.size > 0 ? cfg : null);
      const close = this.hud.wallControls(cfg.size, spot.maxWall, (d) => {
        cfg.size = Math.max(0, Math.min(spot.maxWall, cfg.size + d));
        apply();
      }, finish);
      this.gestures.mode = 'wall';
      this.gestures.onWallDrag = (dx) => {
        const r = screenRightOnGround(this.world.camera);
        cfg.offset = Math.max(-3, Math.min(3, cfg.offset + dx * 6 * (r.x * tangent.x + r.z * tangent.z)));
        apply();
      };
      const tick = window.setInterval(() => {
        const left = (deadline - performance.now()) / 1000;
        this.hud.setTimer(left, WALL_SECONDS);
        if (left <= 0) finish();
      }, 100);
      return () => {
        clearInterval(tick);
        close();
        this.hud.setTimer(null);
        this.gestures.mode = 'none';
        this.gestures.onWallDrag = null;
      };
    });
  }

  protected humanAim(spot: Spot, maxAimY = MAX_AIM_Y): Promise<KickInput | null> {
    const seconds = this.suddenDeath ? SUDDEN_DEATH_AIM_SECONDS : AIM_SECONDS;
    const deadline = performance.now() + seconds * 1000;
    if (this.hints.shoot++ < 2) this.hud.hint(
        maxAimY > MAX_AIM_Y ? 'Swipe over the bar between the posts · aim into the wind' : 'Swipe to where you want it · bend it to curl · snap back down to chip',
        'shoot',
      );
    return this.guard<KickInput | null>((resolve) => {
      this.gestures.mode = 'shoot';
      this.gestures.onShoot = (samples, h) => {
        const swipe = analyzeSwipe(samples, h);
        if (!swipe) {
          this.gestures.trail?.reject();
          this.hud.toast('Swipe upward, in one quick motion');
          return;
        }
        const aim = kickFromSwipe(swipe, samples[swipe.aimIndex], this.world.camera, spot, maxAimY);
        if ('error' in aim) {
          this.gestures.trail?.reject();
          this.hud.toast(aim.error);
        } else {
          this.gestures.trail?.setPower(swipe.power);
          resolve(aim.kick);
        }
      };
      const tick = window.setInterval(() => {
        const left = (deadline - performance.now()) / 1000;
        this.hud.setTimer(left, seconds);
        if (left <= 0) resolve(null);
      }, 100);
      return () => {
        clearInterval(tick);
        this.hud.setTimer(null);
        this.hud.hint(null);
        this.gestures.mode = 'none';
        this.gestures.onShoot = null;
      };
    });
  }

  /**
   * Play the kick live. The clock runs from the start of the run-up, or for a
   * field goal from the snap (`from`: when it was, and how many ticks before
   * contact that is).
   */
  /**
   * Play the kick live. The clock runs from the start of the run-up, or for a
   * field goal from the snap (`from`: when it was, and how many ticks before
   * contact that is). Online: `waiting` holds the result back until the real
   * flight comes in (swapPlayback), and the keeper's flick is handed to
   * `onKeeperInput` as well.
   */
  protected playLive(
    pb: Playable,
    humanKeeps: boolean,
    onResult: () => void,
    opts: { from?: { start: number; pre: number }; onScore?: () => void; onKeeperInput?: (input: KeeperInput) => void; waiting?: boolean } = {},
  ): Promise<void> {
    const { from, onScore } = opts;
    if (humanKeeps && this.hints.keep++ < 2) this.hud.hint('Flick to dive · tap to stay big', 'keep');
    if (!from) sound.whistle();
    sound.setPhase('live');
    sound.setCrowd(0.6, 1.2);
    return this.guard<void>((done) => {
      const start = from?.start ?? performance.now();
      const pre = from?.pre ?? RUNUP_TICKS;
      const spot = pb.setup.spot;
      const startChase = () => {
        const to = this.world.chaseEnd(spot);
        const ahead = to.look.clone().sub(to.pos).setY(0).normalize();
        this.playing!.chase = {
          from: this.world.shooterCam(spot),
          to,
          pivotFrom: v3(spot.x, 0.6, spot.z),
          pivotTo: v3(to.pos.x + ahead.x * 4, 0.6, to.pos.z + ahead.z * 4),
          reached: 0,
          s: 0,
          v: 0,
        };
      };
      this.playing = {
        pb,
        start,
        pre,
        tick: -pre,
        end: opts.waiting ? Infinity : pb.endTick + RESULT_DELAY_TICKS + LIVE_TAIL_TICKS,
        resultTick: opts.waiting ? Infinity : pb.endTick + RESULT_DELAY_TICKS,
        onResult,
        slow: null,
        track: TRACK[humanKeeps ? 'keep' : 'shoot'],
        heard: -pre,
        trackMinZ: humanKeeps ? 4 : -Infinity,
        trackMax: TRACK_MAX[humanKeeps ? 'keep' : 'shoot'],
        chase: null,
        onContact: humanKeeps ? null : startChase,
        onScore: onScore ?? null,
        done,
      };
      if (humanKeeps && pb instanceof KickPlayback) {
        let flicked = false;
        this.gestures.mode = 'keep';
        const keeperX = pb.setup.spot.keeperX;
        // (Online, the playback is swapped for the real one when the flight comes in.)
        const current = () => (this.playing?.pb ?? pb) as KickPlayback;
        const inputOf = (samples: SwipeSample[], flickTick: number) =>
          keeperInputFor(
            diveTarget(samples, current().keeperAt(this.playing?.tick ?? 0), this.world.camera),
            keeperX,
            samples[samples.length - 1].t - samples[0].t,
            flickTick,
          );
        // While the finger is down, the ring shows exactly where the hands will go.
        this.gestures.onKeepDrag = (samples) => {
          if (!flicked) this.world.showDive(plannedHands(inputOf(samples, 0), keeperX));
        };
        this.gestures.onKeep = (samples, _h, endTime) => {
          if (flicked || !this.playing) return;
          flicked = true;
          this.hud.hint(null);
          const input = inputOf(samples, Math.round(-RUNUP_TICKS + ((endTime - start) * TICK_RATE) / 1000));
          this.world.showDive(plannedHands(input, keeperX));
          this.applyKeeper(input);
          opts.onKeeperInput?.(input);
        };
      }
      return () => {
        this.playing = null;
        this.hud.hint(null);
        this.gestures.mode = 'none';
        this.gestures.onKeep = null;
        this.gestures.onKeepDrag = null;
      };
    });
  }

  /** A keeper's flick for the kick in play (the player's, or online, the friend's): re-sim and reschedule the result. */
  protected applyKeeper(input: KeeperInput): void {
    const p = this.playing;
    if (!p || !(p.pb instanceof KickPlayback)) return;
    p.pb.setKeeper(input);
    if (p.end === Infinity) return;
    p.end = p.pb.endTick + RESULT_DELAY_TICKS + LIVE_TAIL_TICKS;
    p.resultTick = p.pb.endTick + RESULT_DELAY_TICKS;
  }

  /** Online: the real flight's in (the keeper's side learns it at contact): play on with it. */
  protected swapPlayback(pb: Playable): void {
    const p = this.playing;
    if (!p) return;
    p.pb = pb;
    p.end = pb.endTick + RESULT_DELAY_TICKS + LIVE_TAIL_TICKS;
    p.resultTick = pb.endTick + RESULT_DELAY_TICKS;
  }

  protected async playReplay(pb: Playable): Promise<void> {
    const { world } = this;
    sound.setPhase('between');
    const spot = pb.setup.spot;
    // A cut, like a broadcast replay (gliding round to the reverse angle whips
    // the view), behind the replay wipe.
    await this.hud.wipe();
    world.rig.setTrack(null);
    this.view.setRole('replay', v3(spot.x * 0.3, 1, spot.z * 0.3));
    world.rig.set(world.replayCam(spot));
    if (this.replaySkippable) this.hud.hint('Tap to skip');
    this.hud.replayTag(true);
    await this.guard<void>((done) => {
      this.playing = {
        pb,
        start: 0,
        pre: 0,
        // Field goals replay from just before the kick, to see the rush close.
        tick: pb instanceof FieldGoalPlayback ? -Math.round(0.5 * TICK_RATE) : -60,
        end: pb.endTick + REPLAY_TAIL_TICKS,
        resultTick: Infinity,
        onResult: null,
        slow: pb.closeCall(),
        track: TRACK.replay,
        heard: -Infinity,
        trackMinZ: -Infinity,
        trackMax: TRACK_MAX.replay,
        chase: null,
        onContact: null,
        onScore: null,
        done,
      };
      if (this.replaySkippable) this.gestures.onTap = done;
      return () => {
        this.playing = null;
        this.gestures.onTap = null;
        this.hud.hint(null);
        this.hud.replayTag(false);
      };
    });
  }

  // ── Per frame ──────────────────────────────────────────────────────────

  /** Every contact since the last frame: the strike, woodwork, gloves, wall, turf, boards and net. */
  protected playSounds(p: Playing): void {
    const { pb } = p;
    const from = p.heard;
    const to = p.tick;
    p.heard = to;
    if (to <= from) return;
    const live = p.start > 0;
    if (from < 0 && to >= 0) {
      const v = pb.launch.vel;
      sound.kick(Math.hypot(v.x, v.y, v.z));
      if (live) {
        sound.hush(false);
        sound.setCrowd(0.8, 0.5);
      }
    }
    for (const e of pb.result.events) {
      if (e.tick <= from || e.tick > to) continue;
      if (e.kind === 'post' || e.kind === 'bar') sound.post(e.speed);
      else if (e.kind === 'keeper') sound.save(e.speed);
      else if (e.kind === 'wall') sound.bounce(e.speed, true);
      else if (e.kind === 'ground') sound.bounce(e.speed);
    }
    for (const e of pb.codaEvents) if (e.tick > from && e.tick <= to) sound.bounce(e.speed, e.hard);
    if (pb.netHitTick !== null && pb.netHitTick > from && pb.netHitTick <= to) {
      const v = pb.launch.vel;
      sound.net(Math.hypot(v.x, v.y, v.z));
    }
  }

  /** The camera runs up the pitch as the ball travels, smoothly however it's moving (or bouncing back). */
  protected updateChase(c: Chase, ball: Vec3, spot: Spot, dt: number): void {
    c.reached = Math.max(c.reached, Math.min(1, Math.max(0, (spot.z - ball.z) / spot.z)));
    const w = CHASE_OMEGA;
    for (let left = dt; left > 1e-6; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      c.v += (w * w * (c.reached - c.s) - 2 * w * c.v) * h;
      c.s += c.v * h;
    }
    const k = Math.min(1, Math.max(0, c.s));
    const rig = this.world.rig;
    rig.move({
      pos: c.from.pos.clone().lerp(c.to.pos, k),
      look: c.from.look.clone().lerp(c.to.look, k),
      fov: c.from.fov + (c.to.fov - c.from.fov) * k,
    });
    rig.pivot?.set(
      c.pivotFrom.x + (c.pivotTo.x - c.pivotFrom.x) * k,
      c.pivotFrom.y,
      c.pivotFrom.z + (c.pivotTo.z - c.pivotFrom.z) * k,
    );
  }

  update(dt: number, now: number): void {
    const p = this.playing;
    if (!p) {
      this.idle?.();
      return;
    }
    if (p.start > 0) {
      // Live: the clock is real time, so the keeper's reaction is measured against it.
      p.tick = -p.pre + ((now - p.start) * TICK_RATE) / 1000;
    } else {
      const slow = p.slow && p.tick > p.slow[0] && p.tick < p.slow[1] ? 0.35 : 1;
      p.tick += dt * TICK_RATE * slow;
    }
    const { pb } = p;
    this.playSounds(p);
    if (p.onContact && p.tick >= 0) {
      p.onContact();
      p.onContact = null;
    }
    if (p.onScore && p.pb.scoreTick !== null && p.tick >= p.pb.scoreTick) {
      p.onScore();
      p.onScore = null;
    }
    if (p.onResult && p.tick >= p.resultTick) {
      p.onResult();
      p.onResult = null;
    }
    const ball = pb.ballAt(p.tick);
    this.world.pose(ball, pb.keeperAt(p.tick), pb.wallYAt(p.tick), p.tick / TICK_RATE);
    if (pb instanceof FieldGoalPlayback) this.world.poseCableCam(pb.camClock(p.tick));
    if (p.chase) this.updateChase(p.chase, ball, pb.setup.spot, dt);
    // Track where the ball is about to be, harder as it nears the goal (where a
    // portrait frame is narrowest), fading in after contact.
    if (p.tick > 0) {
      const ahead = { ...pb.ballAt(Math.min(p.tick + LOOK_AHEAD_TICKS, pb.lastTick)) };
      ahead.z = Math.max(ahead.z, p.trackMinZ);
      const closing = Math.min(1, Math.max(0, (13 - ahead.z) / 10));
      const r = Math.min(1, p.tick / TRACK_RAMP_TICKS);
      const ramp = r * r * (3 - 2 * r);
      this.world.rig.setTrack(ahead, (p.track + (p.trackMax - p.track) * closing) * ramp);
    }
    if (p.tick >= p.end) p.done();
  }
}
