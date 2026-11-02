// One room: two friends and their match, run by the server (SPEC §6). The
// server is the authority: it tosses the coin, generates each round's spot,
// wind and cable cam, holds every phase to its deadline, computes each launch
// (with the strike error every kick carries), hides a free kick's flight from
// the keeper until contact, checks the keeper's flick wasn't claimed early,
// and simulates every kick. The clients send inputs and play back what it
// tells them; the sim is deterministic, so their replays match it exactly.

import {
  DEFAULT_PARAMS,
  FG_OP_TIME,
  FIELD_GOAL_LIMITS,
  MAX_AIM_X,
  MAX_AIM_Y,
  ONLINE,
  RUNUP_TICKS,
  TICK_RATE,
  applyStrikeError,
  ballArrivalTick,
  computeLaunch,
  createMatch,
  currentRound,
  fieldGoalCam,
  fieldGoalLaunch,
  fieldGoalSpot,
  fieldGoalWind,
  freeKickWind,
  generateSpot,
  isSuddenDeath,
  mulberry32,
  nextShooter,
  other,
  recordKick,
  simulateFieldGoal,
  simulateKick,
  winner,
  type CableCam,
  type CoinCall,
  type KeeperInput,
  type KickInput,
  type KickResultMsg,
  type LaunchState,
  type MatchState,
  type OnlineMode,
  type Outcome,
  type OutcomeTag,
  type Seat,
  type ServerMsg,
  type Spot,
  type Vec3,
  type WallConfig,
} from '@fk/shared';

const P = DEFAULT_PARAMS;

export interface Seatholder {
  name: string;
  token: string;
  /** Null while disconnected */
  send: ((m: ServerMsg) => void) | null;
  /** Round trip to this player, ms (their own estimate, from pings) */
  rtt: number;
}

type Phase =
  | { name: 'lobby' }
  | { name: 'toss_call'; caller: Seat }
  | { name: 'toss_choose'; winner: Seat }
  | { name: 'starting' }
  | { name: 'wall' }
  | { name: 'aim' }
  | { name: 'flight' }
  | { name: 'result'; ready: Set<Seat> }
  | { name: 'end'; rematch: Set<Seat>; last: Extract<ServerMsg, { t: 'end' }> };

/** The kick being played. */
interface Kick {
  n: number;
  round: number;
  shooter: Seat;
  spot: Spot;
  wind: Vec3;
  cam: CableCam | null;
  clock0: number;
  aimMs: number;
  wall: WallConfig | null;
  launch: LaunchState | null;
  contact: number;
  keeper: KeeperInput | null;
}

const clamp = (v: unknown, lo: number, hi: number, fallback = 0) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};

export interface RoomOptions {
  now?: () => number;
  /** A uniform random source (the coin and the seed); tests pass a fixed one */
  random?: () => number;
}

export class Room {
  readonly seats: [Seatholder | null, Seatholder | null] = [null, null];
  private phase: Phase = { name: 'lobby' };
  private match: MatchState | null = null;
  private kick: Kick | null = null;
  /** Each round's spot, wind and cam (both kicks of a round share them) */
  private roundSpot: { round: number; spot: Spot; wind: Vec3; cam: CableCam | null } | null = null;
  private seed = 0;
  private strikeRand: () => number = Math.random;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private dropTimers: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null] = [null, null];
  /** Shot clocks run out in a row, per seat (two is a forfeit) */
  private timeouts: [number, number] = [0, 0];
  private lastEmote: [number, number] = [0, 0];
  private readonly now: () => number;
  private readonly random: () => number;
  /** When anything last happened here (rooms nobody uses are closed) */
  lastActive: number;

  constructor(
    readonly code: string,
    readonly mode: OnlineMode,
    opts: RoomOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.lastActive = this.now();
  }

  get full(): boolean {
    return !!this.seats[0] && !!this.seats[1];
  }

  get closed(): boolean {
    return !this.seats[0]?.send && !this.seats[1]?.send;
  }

  // ── Seats ────────────────────────────────────────────────────────────

  /** Take a seat (the creator gets 0, the friend 1). Returns the seat, or null if it's full. */
  sit(holder: Seatholder): Seat | null {
    const seat: Seat | null = !this.seats[0] ? 0 : !this.seats[1] ? 1 : null;
    if (seat === null) return null;
    this.seats[seat] = holder;
    this.touch();
    this.sendRoom();
    if (this.full) {
      this.sendTo(other(seat), { t: 'opponent', connected: true, name: holder.name });
      this.sendTo(seat, { t: 'opponent', connected: true, name: this.seats[other(seat)]!.name });
      this.later(600, () => this.startToss());
    }
    return seat;
  }

  /** The seat holding this token, if any. */
  seatOf(token: string): Seat | null {
    return this.seats[0]?.token === token ? 0 : this.seats[1]?.token === token ? 1 : null;
  }

  /** A player's connection dropped: their friend is told, and they have a while to come back. */
  drop(seat: Seat): void {
    const s = this.seats[seat];
    if (!s) return;
    s.send = null;
    if (this.phase.name === 'lobby') {
      this.seats[seat] = null;
      return;
    }
    if (this.phase.name === 'end') return;
    this.sendTo(other(seat), { t: 'opponent', connected: false });
    // Hold everything until they're back.
    this.clearTimers();
    this.dropTimers[seat] = setTimeout(() => this.forfeit(seat), ONLINE.reconnectMs);
  }

  /** They're back (same token): catch them up and pick up where the match was (the kick in play starts over). */
  rejoin(seat: Seat, send: (m: ServerMsg) => void): void {
    const s = this.seats[seat]!;
    s.send = send;
    this.touch();
    if (this.dropTimers[seat]) clearTimeout(this.dropTimers[seat]!);
    this.dropTimers[seat] = null;
    this.sendRoom();
    const them = this.seats[other(seat)];
    if (them) {
      this.sendTo(seat, { t: 'opponent', connected: !!them.send, name: them.name });
      this.sendTo(other(seat), { t: 'opponent', connected: true, name: s.name });
    }
    if (!this.full || !this.seats[0]!.send || !this.seats[1]!.send) return;
    this.resume();
  }

  /** A player left for good. */
  leave(seat: Seat): void {
    if (this.phase.name === 'lobby' || this.phase.name === 'end') {
      this.seats[seat]!.send = null;
      if (this.phase.name === 'end') this.sendTo(other(seat), { t: 'opponent', connected: false });
      return;
    }
    this.forfeit(seat);
  }

  // ── Messages from players ────────────────────────────────────────────

  call(seat: Seat, side: CoinCall): void {
    if (this.phase.name !== 'toss_call' || this.phase.caller !== seat) return;
    this.flip(side === 'tails' ? 'tails' : 'heads');
  }

  choose(seat: Seat, kickFirst: boolean): void {
    if (this.phase.name !== 'toss_choose' || this.phase.winner !== seat) return;
    this.chosen(seat, !!kickFirst);
  }

  wall(seat: Seat, wall: WallConfig | null): void {
    const k = this.kick;
    if (this.phase.name !== 'wall' || !k || seat === k.shooter) return;
    const size = Math.round(clamp(wall?.size, 0, k.spot.maxWall));
    this.setWall(wall && size > 0 ? { size, offset: clamp(wall.offset, -3, 3) } : null);
  }

  shoot(seat: Seat, input: KickInput): void {
    const k = this.kick;
    if (this.phase.name !== 'aim' || !k || seat !== k.shooter) return;
    this.timeouts[seat] = 0;
    const fg = this.mode === 'fieldgoal';
    const maxY = fg ? FIELD_GOAL_LIMITS.maxAimY : MAX_AIM_Y;
    const kick: KickInput = {
      x: clamp(input?.x, -MAX_AIM_X * 2, MAX_AIM_X * 2),
      y: clamp(input?.y, 0, maxY),
      p: clamp(input?.p, 0, 1),
      sx: clamp(input?.sx, -MAX_AIM_X * 3, MAX_AIM_X * 3),
      durMs: clamp(input?.durMs, 0, 3000, 150),
      ...(input?.chip && !fg ? { chip: true } : {}),
    };
    const meant = fg ? fieldGoalLaunch(k.spot, kick, P) : computeLaunch(k.spot, kick, P);
    const launch = applyStrikeError(meant, kick, this.strikeRand, P);
    k.launch = launch;
    this.clearTimers();
    this.phase = { name: 'flight' };
    const now = this.now();
    if (fg) {
      // A field goal: nothing to hide (the other side can't do anything about it).
      k.contact = now + FG_OP_TIME * 1000 + ONLINE.snapLeadMs;
      this.broadcast({ t: 'committed', n: k.n, contact: k.contact, launch });
      const res = simulateFieldGoal({ spot: k.spot, wind: k.wind, opTime: FG_OP_TIME, cam: k.cam, clock: (k.contact - k.clock0) / 1000 }, launch, P);
      const [outcome, tag] = res.good ? (['goal', res.tag === 'doink_in' ? 'off_post' : 'clean'] as const) : fieldGoalMiss(res.tag);
      this.later(k.contact - now + (res.decidedTick / TICK_RATE) * 1000 + 300, () => this.finish(outcome, tag, res.good));
      return;
    }
    // A free kick: the shooter learns the flight now, the keeper only as it's struck.
    k.contact = now + ONLINE.runupMs;
    const keeper = other(k.shooter);
    this.sendTo(k.shooter, { t: 'committed', n: k.n, contact: k.contact, launch });
    this.sendTo(keeper, { t: 'committed', n: k.n, contact: k.contact });
    const rtt = this.seats[keeper]?.rtt ?? 100;
    this.later(Math.max(0, k.contact - now - rtt / 2 - 40), () => this.sendTo(keeper, { t: 'launch', n: k.n, launch }));
    // Settled once the keeper can no longer make a difference: the ball past him, plus slack.
    const arrival = Math.min(ballArrivalTick(launch, P, k.wind), 2.5 * TICK_RATE);
    this.later(k.contact - now + (arrival / TICK_RATE) * 1000 + 1000, () => this.settleFreeKick());
  }

  /** The keeper's flick. Trusted to be no earlier than it could have been sent (less a little jitter). */
  keep(seat: Seat, input: KeeperInput): void {
    const k = this.kick;
    if (this.phase.name !== 'flight' || !k || seat === k.shooter || k.keeper || this.mode !== 'freekick') return;
    const sent = this.now() - (this.seats[seat]?.rtt ?? 100) / 2;
    const earliest = Math.ceil(((sent - k.contact - ONLINE.flickToleranceMs) / 1000) * TICK_RATE);
    const flickTick = Math.round(clamp(input?.flickTick, -RUNUP_TICKS, 4 * TICK_RATE));
    k.keeper = {
      vx: clamp(input?.vx, -3, 3),
      vy: clamp(input?.vy, -3, 3),
      durMs: clamp(input?.durMs, 0, 2000, 150),
      flickTick: Math.max(flickTick, earliest),
    };
    this.sendTo(k.shooter, { t: 'keeper', n: k.n, input: k.keeper });
  }

  emote(seat: Seat, kind: string): void {
    const now = this.now();
    if (now - this.lastEmote[seat] < 150 || typeof kind !== 'string' || kind.length > 20) return;
    this.lastEmote[seat] = now;
    this.sendTo(other(seat), { t: 'emote', kind });
  }

  ready(seat: Seat): void {
    if (this.phase.name !== 'result') return;
    this.phase.ready.add(seat);
    if (this.phase.ready.size === 2) this.next();
  }

  rematch(seat: Seat): void {
    if (this.phase.name !== 'end' || this.phase.last.forfeit) return;
    this.phase.rematch.add(seat);
    this.sendTo(other(seat), { t: 'rematch', seat });
    if (this.phase.rematch.size === 2) this.startToss();
  }

  setRtt(seat: Seat, rtt: unknown): void {
    const s = this.seats[seat];
    if (s) s.rtt = clamp(rtt, 0, 2000, s.rtt);
  }

  // ── The match ────────────────────────────────────────────────────────

  private startToss(): void {
    this.clearTimers();
    this.match = null;
    this.kick = null;
    this.roundSpot = null;
    this.timeouts = [0, 0];
    this.seed = Math.floor(this.random() * 2 ** 31);
    this.strikeRand = mulberry32((this.seed ^ 0x5bd1e995) >>> 0);
    // The friend who joined calls it.
    const caller: Seat = 1;
    this.phase = { name: 'toss_call', caller };
    const deadline = this.now() + 1700 + ONLINE.callMs;
    this.broadcast({ t: 'toss_call', caller, deadline });
    this.later(deadline - this.now() + ONLINE.graceMs, () => this.flip('heads'));
  }

  private flip(call: CoinCall): void {
    if (this.phase.name !== 'toss_call') return;
    const caller = this.phase.caller;
    this.clearTimers();
    const side: CoinCall = this.random() < 0.5 ? 'heads' : 'tails';
    const won: Seat = side === call ? caller : other(caller);
    this.phase = { name: 'toss_choose', winner: won };
    // The coin's flight and the banner, then the choice.
    const deadline = this.now() + 3000 + ONLINE.chooseMs;
    this.broadcast({ t: 'toss', call, side, winner: won, deadline });
    this.later(deadline - this.now() + ONLINE.graceMs, () => this.chosen(won, true));
  }

  private chosen(chooser: Seat, kickFirst: boolean): void {
    if (this.phase.name !== 'toss_choose') return;
    this.clearTimers();
    const firstShooter: Seat = kickFirst ? chooser : other(chooser);
    this.match = createMatch(firstShooter);
    this.phase = { name: 'starting' };
    this.broadcast({ t: 'toss_choice', chooser, kickFirst, firstShooter });
    this.later(2400, () => this.startKick());
  }

  private startKick(): void {
    const match = this.match!;
    const shooter = nextShooter(match);
    if (shooter === null) return this.end(winner(match)!, false);
    const round = currentRound(match);
    const fg = this.mode === 'fieldgoal';
    if (!this.roundSpot || this.roundSpot.round !== round) {
      const rng = mulberry32(this.seed + round * 7919);
      const spot = fg ? fieldGoalSpot(rng, round) : generateSpot(rng);
      const wind = fg ? fieldGoalWind(rng, round) : freeKickWind(rng, round);
      const cam = fg ? fieldGoalCam(rng, round, spot, P) : null;
      this.roundSpot = { round, spot, wind, cam };
    }
    const { spot, wind, cam } = this.roundSpot;
    const now = this.now();
    const aimMs = isSuddenDeath(round) ? ONLINE.suddenDeathAimMs : ONLINE.aimMs;
    // The first kick of sudden death waits for its title card.
    const reveal = ONLINE.revealMs + (isSuddenDeath(round) && !isSuddenDeath(round - 1) && match.kicks.length % 2 === 0 ? ONLINE.suddenDeathCardMs : 0);
    this.kick = { n: match.kicks.length, round, shooter, spot, wind, cam, clock0: now, aimMs, wall: null, launch: null, contact: 0, keeper: null };
    this.broadcast({ t: 'kick_start', n: this.kick.n, round, shooter, spot, wind, cam, clock0: now, aimMs, kicks: [...match.kicks] });
    if (!fg && spot.maxWall > 0) {
      this.phase = { name: 'wall' };
      // No wall set in time: the default (as big as allowed, on the near post).
      this.later(reveal + ONLINE.wallMs + ONLINE.graceMs, () => this.setWall({ size: spot.maxWall, offset: 0 }));
    } else {
      this.phase = { name: 'aim' };
      this.later(reveal + aimMs + ONLINE.graceMs, () => this.shotClock());
    }
  }

  private setWall(wall: WallConfig | null): void {
    const k = this.kick!;
    this.clearTimers();
    k.wall = wall;
    this.phase = { name: 'aim' };
    this.broadcast({ t: 'wall', n: k.n, wall, deadline: this.now() + k.aimMs });
    this.later(k.aimMs + ONLINE.graceMs, () => this.shotClock());
  }

  private shotClock(): void {
    if (this.phase.name !== 'aim') return;
    const shooter = this.kick!.shooter;
    // Two in a row and it's a forfeit.
    if (++this.timeouts[shooter] >= 2) return this.forfeit(shooter);
    this.finish('miss', 'shot_clock', false);
  }

  private settleFreeKick(): void {
    const k = this.kick!;
    const res = simulateKick({ spot: k.spot, wall: k.wall, wind: k.wind }, k.launch!, k.keeper, P);
    this.finish(res.outcome, res.tag, res.outcome === 'goal');
  }

  private finish(outcome: Outcome, tag: OutcomeTag, scored: boolean): void {
    const k = this.kick!;
    this.clearTimers();
    this.match = recordKick(this.match!, { shooter: k.shooter, scored, outcome, tag });
    const msg: KickResultMsg = { n: k.n, launch: k.launch, keeper: k.keeper, wall: k.wall, outcome, tag, scored, kicks: [...this.match.kicks] };
    this.broadcast({ t: 'result', ...msg });
    this.phase = { name: 'result', ready: new Set() };
    this.later(ONLINE.replayMs, () => this.next());
  }

  private next(): void {
    if (this.phase.name !== 'result') return;
    this.clearTimers();
    const w = winner(this.match!);
    if (w !== null) this.end(w, false);
    else this.startKick();
  }

  private end(w: Seat, forfeit: boolean): void {
    this.clearTimers();
    for (const t of this.dropTimers) if (t) clearTimeout(t);
    this.dropTimers = [null, null];
    const last: Extract<ServerMsg, { t: 'end' }> = { t: 'end', winner: w, kicks: [...(this.match?.kicks ?? [])], forfeit };
    this.phase = { name: 'end', rematch: new Set(), last };
    this.broadcast(last);
  }

  private forfeit(loser: Seat): void {
    if (this.phase.name === 'end') return;
    this.end(other(loser), true);
  }

  /** Both back after a drop: carry on from where it was. */
  private resume(): void {
    switch (this.phase.name) {
      case 'toss_call':
      case 'toss_choose':
        return this.startToss();
      case 'starting':
      case 'wall':
      case 'aim':
      case 'flight':
        // The kick in play starts again (same spot, same wind).
        return this.startKick();
      case 'result':
        return this.next();
      case 'end':
        this.broadcast(this.phase.last);
        return;
      case 'lobby':
        return;
    }
  }

  // ── Plumbing ─────────────────────────────────────────────────────────

  private sendRoom(): void {
    const names: [string, string | null] = [this.seats[0]?.name ?? '', this.seats[1]?.name ?? null];
    for (const seat of [0, 1] as Seat[]) this.sendTo(seat, { t: 'room', code: this.code, mode: this.mode, seat, names });
  }

  private sendTo(seat: Seat, m: ServerMsg): void {
    this.seats[seat]?.send?.(m);
  }

  private broadcast(m: ServerMsg): void {
    this.touch();
    this.sendTo(0, m);
    this.sendTo(1, m);
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, Math.max(0, ms)));
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private touch(): void {
    this.lastActive = this.now();
  }

  /** Close it down (the server's tidying up). */
  dispose(): void {
    this.clearTimers();
    for (const t of this.dropTimers) if (t) clearTimeout(t);
  }
}

/** A missed field goal, as the score sheet records it (the same as a match against the AI). */
function fieldGoalMiss(tag: string): readonly [Outcome, OutcomeTag] {
  switch (tag) {
    case 'short':
      return ['miss', 'short'];
    case 'doink_out':
      return ['miss', 'woodwork_out'];
    case 'blocked':
    case 'cam':
      return ['miss', 'wall'];
    default:
      return ['miss', 'wide'];
  }
}
