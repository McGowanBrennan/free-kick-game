// A friend match over the network (SPEC §6). The same scenes as a match
// against the AI (the coin toss, the reveal, the wall, the aim, the live kick,
// the replay), but everything the AI used to decide comes from the server and
// the friend on the other end: the toss and who calls it, the spot and the
// wind, the wall, the launch (strike error included), the keeper's flick, and
// the result. A free kick's flight only reaches the keeper's phone as it's
// struck, so until then the keeper's side plays the run-up over a ball at
// rest and swaps in the real flight when it lands. If the server starts a
// kick over (someone reconnected), whatever's in hand is dropped.

import {
  BALL_RADIUS,
  DEFAULT_PARAMS,
  FG_OP_TIME,
  FIELD_GOAL_LIMITS,
  KEEPER_Z,
  KeeperSim,
  RUNUP_TICKS,
  TICK_RATE,
  isSuddenDeath,
  kickStyle,
  other,
  planKeeper,
  targetFromInput,
  v3,
  wallLayout,
  type KeeperInput,
  type KickInput,
  type KickRecord,
  type KickStart,
  type LaunchState,
  type MatchState,
  type PlayerId,
  type Seat,
  type ServerMsg,
  type WallConfig,
} from '@fk/shared';
import { sound } from '../audio/sound';
import type { OnlineConfig } from '../ui/menu';
import { KITS, type Emote } from '../world/figure';
import { COIN_FLIGHT, type CoinSide } from '../world/cointoss';
import { snapBallAt } from '../world/fieldgoal-unit';
import { fieldGoalHeading } from '../world/world';
import { FieldGoalPlayback } from './fieldgoal-playback';
import { KickPlayback, type Playable } from './playback';
import {
  CATEGORY_LABEL,
  FG_RESULT_TEXT,
  Quit,
  RESULT_MS,
  RESULT_TEXT,
  Restart,
  Session,
  YARDS,
  describeFieldGoal,
  describeKick,
  fieldGoalReaction,
  freeKickReaction,
} from './session';

const P = DEFAULT_PARAMS;
type MsgOf<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

/** A launch that goes nowhere: the keeper's side plays the run-up over it until the real flight arrives. */
const resting = (spot: { x: number; z: number }): LaunchState => ({ pos: v3(spot.x, BALL_RADIUS, spot.z), vel: v3(), spin: v3() });

const sameInput = (a: KeeperInput | null, b: KeeperInput | null) =>
  a === b || (!!a && !!b && a.vx === b.vx && a.vy === b.vy && a.durMs === b.durMs && a.flickTick === b.flickTick);

export class OnlineSession extends Session {
  /** The kick in hand (to tell a restart of it from the next one), and whether a toss or kick is under way */
  private currentN = -1;
  private inFlow = false;
  private hintedTaunt = false;

  private get online(): OnlineConfig {
    return this.cfg as OnlineConfig;
  }

  private get friend(): string {
    return this.online.names[other(this.online.seat)] || 'Friend';
  }

  /** A server seat as the scoreboard sees it: 0 is us. */
  private local(seat: Seat): PlayerId {
    return seat === this.online.seat ? 0 : 1;
  }

  /** The match so far, from our side. */
  private stateOf(kicks: KickRecord[], nextShooter?: Seat): MatchState {
    const first = kicks[0]?.shooter ?? nextShooter ?? 0;
    return { firstShooter: this.local(first), kicks: kicks.map((k) => ({ ...k, shooter: this.local(k.shooter) })) };
  }

  /** The next of these messages from the server (given up if the kick's called off). */
  private recv<T extends ServerMsg['t']>(...types: T[]): Promise<MsgOf<T>> {
    return this.guard<MsgOf<T>>((done) => {
      const ac = new AbortController();
      void this.online.conn.next(types, ac.signal).then(done);
      return () => ac.abort();
    });
  }

  /** ms from now to a server time. */
  private msUntil(serverMs: number): number {
    return Math.max(0, this.online.conn.toLocal(serverMs) - performance.now());
  }

  async run(): Promise<'rematch' | 'menu'> {
    const { conn } = this.online;
    const fieldGoals = this.online.mode === 'fieldgoal';
    this.hud.show(true);
    this.hud.setNames(['You', this.friend]);
    this.hud.setScoreboardVisible(true);
    this.hud.setScore(this.stateOf([]));
    this.hud.setRound('Waiting for the kick-off…');
    let opponentGone = 0;
    conn.on('emote', (m) => {
      this.world.emote(fieldGoals ? 'gunner' : 'keeper', m.kind as Emote);
      sound.taunt(false);
      if (!this.hintedTaunt) {
        this.hintedTaunt = true;
        this.hud.toast(`${this.friend} is taunting you`);
      }
    });
    conn.on('opponent', (m) => {
      clearInterval(opponentGone);
      if (m.connected) return this.hud.prompt(null);
      // The server waits 20 s for them.
      const back = performance.now() + 20_000;
      const tick = () => this.hud.prompt(`${this.friend} lost connection · ${Math.max(0, Math.ceil((back - performance.now()) / 1000))}`);
      tick();
      opponentGone = window.setInterval(tick, 500);
    });
    conn.on('rematch', () => this.hud.toast(`${this.friend} wants a rematch`));
    conn.onDrop = (dropped) => this.hud.prompt(dropped ? 'Connection lost · reconnecting…' : null);
    // A kick (or the toss) the server's started over: drop the one in hand.
    conn.onQueue = (m) => {
      if (!this.inFlow) return;
      if (m.t === 'end' || m.t === 'toss_call' || (m.t === 'kick_start' && m.n <= this.currentN)) this.kickAbort.abort();
    };
    try {
      for (;;) {
        // (A call-off that came in after the last kick had already finished has nothing left to stop.)
        if (this.kickAbort.signal.aborted) this.kickAbort = new AbortController();
        const m = await this.recv('toss_call', 'kick_start', 'end');
        if (m.t === 'end') return await this.matchEnd(m);
        this.inFlow = true;
        try {
          if (m.t === 'toss_call') await this.toss(m);
          else await this.kick(m);
        } catch (e) {
          if (!(e instanceof Restart)) throw e;
          this.tidy();
        } finally {
          this.inFlow = false;
        }
      }
    } catch (e) {
      if (e instanceof Quit) {
        conn.close();
        return 'menu';
      }
      throw e;
    } finally {
      clearInterval(opponentGone);
      for (const t of ['emote', 'opponent', 'rematch', 'keeper', 'launch'] as const) conn.on(t, null);
      conn.onDrop = null;
      conn.onQueue = null;
      this.gestures.mode = 'none';
      this.gestures.onTap = null;
      this.view.setRole(null);
      this.world.rig.setTrack(null);
      this.hud.show(false);
      this.world.setTrace(null);
    }
  }

  /** After a kick's been called off: nothing left half done. */
  private tidy(): void {
    this.kickAbort = new AbortController();
    this.playing = null;
    this.idle = null;
    this.gestures.mode = 'none';
    this.online.conn.on('keeper', null);
    this.online.conn.on('launch', null);
    this.hud.prompt(null);
    this.hud.setStakes(null);
    this.hud.setWind(null);
    this.hud.setTimer(null);
    this.hud.hint(null);
    sound.hush(false);
    this.world.setRefCall(null);
  }

  protected onTaunt(kind: Emote): void {
    this.online.conn.send({ t: 'emote', kind });
  }

  // ── The toss ───────────────────────────────────────────────────────────

  private async toss(m: MsgOf<'toss_call'>): Promise<void> {
    const { conn, seat } = this.online;
    const { hud, world } = this;
    const fieldGoals = this.online.mode === 'fieldgoal';
    this.currentN = -1;
    const clock = this.startTossScene(fieldGoals);
    try {
      await this.sleep(1700);
      const calling = m.caller === seat;
      if (calling) {
        hud.setRound('Coin toss · call it!');
        const i = await this.pick(
          [
            { icon: '🙂', label: 'Heads' },
            { icon: '⭐', label: 'Tails' },
          ],
          this.msUntil(m.deadline),
          0,
        );
        const call: CoinSide = i === 0 ? 'heads' : 'tails';
        conn.send({ t: 'call', side: call });
        hud.setRound(`Coin toss · you called ${call}`);
      } else hud.setRound(`Coin toss · ${this.friend} is calling it…`);
      const t = await this.recv('toss');
      const won = t.winner === seat;
      if (!calling) hud.setRound(`Coin toss · ${this.friend} called ${t.call}`);
      world.coinToss.flip(t.side, won ? 'you' : 'ai', clock());
      sound.setCrowd(0.65, 0.4);
      await this.sleep(COIN_FLIGHT * 1000 + 350);
      sound.taunt(won);
      world.stadium.cheer(won ? 0.6 : 0.2);
      sound.setCrowd(won ? 0.6 : 0.35, 1.5);
      await this.banner(t.side === 'heads' ? 'Heads!' : 'Tails!', won ? 'You won the toss' : `${this.friend} won the toss`, won ? 'good' : 'info', 1500);
      const kickWord = fieldGoals ? 'Kick' : 'Shoot';
      const keepWord = fieldGoals ? 'Defend' : 'Keep';
      if (won) {
        hud.setRound('You won the toss · choose');
        const i = await this.pick(
          [
            { icon: fieldGoals ? '🏈' : '⚽', label: `${kickWord} first` },
            { icon: fieldGoals ? '🛡️' : '🧤', label: `${keepWord} first` },
          ],
          this.msUntil(t.deadline),
          0,
        );
        conn.send({ t: 'choose', kickFirst: i === 0 });
      } else hud.setRound(`${this.friend} is choosing…`);
      const c = await this.recv('toss_choice');
      hud.setRound('Coin toss');
      const youFirst = c.firstShooter === seat;
      const chooser = c.chooser === seat ? 'You' : this.friend;
      await this.banner(
        youFirst ? `You ${kickWord.toLowerCase()} first` : `${this.friend} ${kickWord.toLowerCase()}s first`,
        `${chooser} chose to ${(c.kickFirst ? kickWord : keepWord).toLowerCase()} first`,
        'info',
        1800,
      );
    } finally {
      this.endTossScene();
    }
  }

  // ── A kick ─────────────────────────────────────────────────────────────

  private async kick(k: MsgOf<'kick_start'>): Promise<void> {
    const { hud } = this;
    this.currentN = k.n;
    const fieldGoals = this.online.mode === 'fieldgoal';
    const state = this.stateOf(k.kicks, k.shooter);
    hud.setScore(state);
    const sd = isSuddenDeath(k.round);
    if (sd && !this.suddenDeath) await this.suddenDeathIntro(k.spot, fieldGoals);
    const label = sd ? `Sudden death · round ${k.round}` : `Round ${k.round} of 5`;
    hud.setRound(label);
    this.world.stadium.setScreens([label.toUpperCase(), `${state.kicks.filter((x) => x.shooter === 0 && x.scored).length} – ${state.kicks.filter((x) => x.shooter === 1 && x.scored).length}`, `YOU v ${this.friend.toUpperCase()}`]);
    const stakes = this.stakes(state, this.local(k.shooter), fieldGoals);
    hud.setStakes(stakes?.text ?? null, stakes?.tone);
    this.pressure = !!stakes || sd;
    try {
      if (fieldGoals) await this.fieldGoal(k);
      else await this.freeKick(k);
    } finally {
      hud.setStakes(null);
      this.pressure = false;
    }
  }

  /** The result's in: the score, and (after the replay) tell the server we're ready for the next. */
  private settle(r: MsgOf<'result'>): void {
    this.hud.setScore(this.stateOf(r.kicks));
  }

  private async freeKick(k: KickStart): Promise<void> {
    const { world, hud } = this;
    const { conn, seat } = this.online;
    const { spot, wind } = k;
    const youShoot = k.shooter === seat;
    world.setMode('freekick');
    world.setWind(wind);
    world.setKits(youShoot ? KITS.you : KITS.ai, youShoot ? KITS.aiKeeper : KITS.youKeeper, youShoot ? KITS.ai : KITS.you);
    world.setSpot(spot);
    hud.setRole(youShoot ? 'You shoot' : 'You keep', !youShoot);
    hud.readout(null);
    sound.setTheme('soccer');
    sound.setPhase('between');
    const toGoal = fieldGoalHeading(spot);
    const mph = this.showWind(wind, youShoot ? toGoal : { x: -toGoal.x, z: -toGoal.z });
    const stance = new KeeperSim(planKeeper(null, spot.keeperX, P), spot.keeperX, P).partsAt(0);
    const ballAtSpot = v3(spot.x, 0.11, spot.z);
    this.idle = () => world.pose(ballAtSpot, stance, 0, -1.2);

    // The reveal.
    this.view.setRole(null);
    world.rig.setTrack(null);
    world.rig.set(world.aerialCam(spot));
    sound.setCrowd(0.35, 2);
    await Promise.all([
      this.banner(CATEGORY_LABEL[spot.category], `${Math.round(spot.distance)} m · ${mph < 1 ? 'calm' : `wind ${mph} mph`}`, 'info', 1500),
      world.rig.flyTo(youShoot ? world.shooterCam(spot) : world.keeperCam(spot), 1.7),
    ]);
    this.view.setRole(youShoot ? 'shoot' : 'keep', youShoot ? v3(spot.x, 0.6, spot.z) : v3(spot.keeperX, 1, KEEPER_Z));

    // The wall: we set it, or wait for theirs.
    let wall: WallConfig | null = null;
    if (spot.maxWall > 0) {
      if (!youShoot) {
        const mine = await this.humanWall(spot);
        conn.send({ t: 'wall', wall: mine });
        hud.prompt('Waiting for the shooter…');
      } else hud.prompt(`${this.friend} is setting the wall…`);
      wall = (await this.recv('wall')).wall;
      hud.prompt(null);
      world.setWall(wall ? wallLayout(spot, wall).players : []);
    }

    // The aim: ours, or theirs (and our taunts while they line up).
    sound.setPhase(youShoot ? 'home' : 'away');
    if (this.pressure) sound.hush(true);
    let committed: MsgOf<'committed'> | MsgOf<'result'>;
    let kick: KickInput | null = null;
    if (youShoot) {
      kick = await this.humanAim(spot);
      if (kick) conn.send({ t: 'kick', input: kick });
      else hud.prompt('Time!');
      committed = await this.recv('committed', 'result');
      hud.prompt(null);
    } else {
      const close = this.tauntBar('keeper');
      hud.prompt(`${this.friend} is lining up…`);
      try {
        committed = await this.recv('committed', 'result');
      } finally {
        close();
        hud.prompt(null);
      }
    }
    if (committed.t === 'result') return this.shotClock(committed, youShoot);

    // The run-up, the flight, the keeper.
    const setup = { spot, wall, wind };
    const start = conn.toLocal(committed.contact) - (RUNUP_TICKS / TICK_RATE) * 1000;
    let live: KickPlayback;
    let mine: KeeperInput | null = null;
    if (youShoot) {
      const launch = committed.launch!;
      live = new KickPlayback(setup, launch, null);
      world.showAim(targetFromInput(kick!));
      hud.readout(describeKick(kick!, launch, spot));
      world.kickStyle = kickStyle(kick!, launch, P);
      // Their flick, as it comes.
      conn.on('keeper', (m) => m.n === k.n && this.applyKeeper(m.input));
    } else {
      // Over a ball at rest until the flight lands (at contact).
      live = new KickPlayback(setup, resting(spot), null);
      conn.on('launch', (m) => {
        if (m.n !== k.n) return;
        live = new KickPlayback(setup, m.launch, mine);
        world.kickStyle = kickStyle({ x: 0, y: 0, p: 0, sx: 0, durMs: 150 }, m.launch, P);
        this.swapPlayback(live);
      });
    }
    this.idle = null;
    sound.whistle();
    let shown: Promise<void> = Promise.resolve();
    try {
      await this.playLive(
        live,
        !youShoot,
        () => {
          const r = live.result;
          const [title, sub] = RESULT_TEXT[r.tag];
          const react = freeKickReaction(r, youShoot);
          sound.react(react);
          world.stadium.cheer(react.homeGood ? 1 : react.near ? 0.45 : 0.15);
          sound.setCrowd(react.homeGood ? 0.7 : 0.3, 3);
          shown = this.banner(title, sub, youShoot === (r.outcome === 'goal') ? 'good' : 'bad', RESULT_MS);
        },
        {
          from: { start, pre: RUNUP_TICKS },
          waiting: !youShoot,
          onScore: () => {
            sound.goal(youShoot);
            world.stadium.cheer(youShoot ? 1 : 0.4);
          },
          onKeeperInput: (input) => {
            mine = input;
            conn.send({ t: 'keeper', input });
          },
        },
      );
    } finally {
      conn.on('keeper', null);
      conn.on('launch', null);
    }
    await shown;
    // The server's word is final (it only ever differs if a flick arrived too late to count).
    const result = await this.recv('result');
    if (!sameInput(live.keeperInput, result.keeper)) live.setKeeper(result.keeper);
    this.settle(result);
    await this.replayAndReady(live);
    hud.setWind(null);
    const rest = live.lastTick;
    this.idle = () => world.pose(live.ballAt(rest), live.keeperAt(rest), live.wallYAt(rest), rest / TICK_RATE);
  }

  private async fieldGoal(k: KickStart): Promise<void> {
    const { world, hud } = this;
    const { conn, seat } = this.online;
    const { spot, wind, cam } = k;
    const youKick = k.shooter === seat;
    world.setMode('fieldgoal');
    world.setFieldGoalTeams(youKick ? KITS.fbYou : KITS.fbAi, youKick ? KITS.fbAi : KITS.fbYou);
    world.setSpot(spot);
    world.setWind(wind);
    world.setCableCam(cam);
    world.opTime = FG_OP_TIME;
    sound.setTheme('football');
    sound.setPhase('between');
    hud.setRole(youKick ? 'You kick' : `${this.friend} kicks`, false);
    hud.readout(null);
    const mph = this.showWind(wind, fieldGoalHeading(spot));
    // The round's clock (the cam swings on it) is the server's.
    const clock = () => (conn.serverNow() - k.clock0) / 1000;
    this.idle = () => {
      world.pose(snapBallAt(spot, -1), null, 0, -10, -1);
      world.poseCableCam(clock());
    };
    this.view.setRole(null);
    world.rig.setTrack(null);
    world.rig.set(world.aerialCam(spot));
    sound.setCrowd(0.35, 2);
    const hash = spot.x < -1 ? 'left hash' : spot.x > 1 ? 'right hash' : 'middle';
    await Promise.all([
      this.banner('Field goal', `${Math.round(spot.distance * YARDS)} yards · ${hash} · ${mph < 1 ? 'calm' : `wind ${mph} mph`}`, 'info', 1600),
      world.rig.flyTo(world.shooterCam(spot), 1.7),
    ]);
    this.view.setRole('shoot', v3(spot.x, 0.6, spot.z));
    sound.setPhase(youKick ? 'home' : 'away');
    if (this.pressure) sound.hush(true);

    let committed: MsgOf<'committed'> | MsgOf<'result'>;
    let kick: KickInput | null = null;
    if (youKick) {
      kick = await this.humanAim(spot, FIELD_GOAL_LIMITS.maxAimY);
      if (kick) conn.send({ t: 'kick', input: kick });
      else hud.prompt('Time!');
      committed = await this.recv('committed', 'result');
      hud.prompt(null);
    } else {
      const close = this.tauntBar('gunner');
      hud.prompt(`${this.friend} is lining up…`);
      try {
        committed = await this.recv('committed', 'result');
      } finally {
        close();
        hud.prompt(null);
      }
    }
    if (committed.t === 'result') {
      world.setCableCam(null);
      return this.shotClock(committed, youKick, 'Delay of game', 'The play clock ran out');
    }
    sound.bounce(3);
    const launch = committed.launch!;
    const pb = new FieldGoalPlayback({ spot, wind, opTime: FG_OP_TIME, cam, clock: (committed.contact - k.clock0) / 1000 }, launch);
    if (youKick && kick) {
      world.showAim(targetFromInput(kick, FIELD_GOAL_LIMITS));
      hud.readout(describeFieldGoal(kick, launch));
    }
    world.kickStyle = 'instep';
    world.setRefCall({ at: pb.result.decidedTick / TICK_RATE, good: pb.result.good });
    this.idle = null;
    let shown: Promise<void> = Promise.resolve();
    await this.playLive(
      pb,
      false,
      () => {
        const r = pb.result;
        const [title, sub] = FG_RESULT_TEXT[r.tag];
        const react = fieldGoalReaction(r, youKick);
        sound.react(react);
        sound.setCrowd(react.homeGood ? 0.7 : 0.3, 3);
        world.stadium.cheer(react.homeGood ? 1 : react.near ? 0.5 : 0.15);
        shown = this.banner(title, sub, youKick === r.good ? 'good' : 'bad', RESULT_MS);
      },
      {
        from: { start: conn.toLocal(committed.contact) - FG_OP_TIME * 1000, pre: Math.round(FG_OP_TIME * TICK_RATE) },
        onScore: () => {
          sound.goal(youKick);
          world.stadium.cheer(youKick ? 1 : 0.4);
        },
      },
    );
    await shown;
    this.settle(await this.recv('result'));
    await this.replayAndReady(pb);
    hud.setWind(null);
    const rest = pb.lastTick;
    const restAt = performance.now();
    this.idle = () => {
      world.pose(pb.ballAt(rest), null, 0, rest / TICK_RATE);
      world.poseCableCam(pb.camClock(rest) + (performance.now() - restAt) / 1000);
    };
  }

  /** Someone ran out the shot clock. */
  private async shotClock(r: MsgOf<'result'>, ours: boolean, title = RESULT_TEXT.shot_clock[0], sub = RESULT_TEXT.shot_clock[1]): Promise<void> {
    sound.hush(false);
    this.hud.setWind(null);
    sound.react(ours ? { homeGood: false, humanActed: true, near: false, wild: true } : { homeGood: true, humanActed: false, near: false, wild: true });
    sound.setPhase('between');
    await this.banner(title, ours ? sub : `${this.friend} ran out of time`, ours ? 'bad' : 'good', 1500);
    this.settle(r);
    this.online.conn.send({ t: 'ready' });
  }

  private async replayAndReady(pb: Playable): Promise<void> {
    await this.playReplay(pb);
    this.world.rig.setTrack(null);
    this.online.conn.send({ t: 'ready' });
  }

  // ── The end ────────────────────────────────────────────────────────────

  private async matchEnd(m: MsgOf<'end'>): Promise<'rematch' | 'menu'> {
    const { conn, seat } = this.online;
    const won = m.winner === seat;
    const state = this.stateOf(m.kicks);
    this.hud.setScore(state);
    const g0 = state.kicks.filter((k) => k.shooter === 0 && k.scored).length;
    const g1 = state.kicks.filter((k) => k.shooter === 1 && k.scored).length;
    this.world.stadium.setScreens(['FULL TIME', `${g0} – ${g1}`, won ? 'YOU WIN!' : `${this.friend.toUpperCase()} WINS`]);
    if (won) this.world.stadium.cheer(1);
    const title = m.forfeit ? (won ? `${this.friend} left` : 'Forfeit') : won ? 'You win!' : `${this.friend} wins`;
    await this.banner(title, m.forfeit && won ? 'You win' : '', won ? 'good' : 'bad', 1800);
    this.hud.show(false);
    const choice = await this.menu.showEnd(state, won, ['You', this.friend]);
    if (choice === 'rematch' && !m.forfeit) {
      conn.send({ t: 'rematch' });
      return 'rematch';
    }
    conn.close();
    return 'menu';
  }
}
