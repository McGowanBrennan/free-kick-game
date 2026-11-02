// The online protocol (SPEC §6): plain JSON over a WebSocket. The server is
// the authority: it runs the match, the coin toss and every kick's sim, and
// the clients send inputs and play back what it tells them. Seats are 0 (who
// made the room) and 1 (who joined); times are the server's clock, in ms.

import type { CableCam } from './fieldgoal';
import type { KeeperInput, KickInput } from './input';
import type { LaunchState } from './launch';
import type { KickRecord, PlayerId } from './match';
import type { Outcome, OutcomeTag } from './sim';
import type { Spot } from './spots';
import type { Vec3 } from './vec';
import type { WallConfig } from './wall';

export type OnlineMode = 'freekick' | 'fieldgoal';
export type Seat = PlayerId;
export type CoinCall = 'heads' | 'tails';

/** Rooms are joined by a code like "K7Q2XM" (no 0/O, 1/I lookalikes). */
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Timings (ms) the server holds the clients to. */
export const ONLINE = {
  /** A dropped player has this long to come back before forfeiting */
  reconnectMs: 20_000,
  /** The coin toss: the call, and the winner's choice */
  callMs: 5_000,
  chooseMs: 5_000,
  /** The keeper's wall */
  wallMs: 8_000,
  /** The shot clock, regulation and sudden death */
  aimMs: 10_000,
  suddenDeathAimMs: 7_000,
  /** Time the clients take to reveal a spot before the clock starts, plus slack for the network */
  revealMs: 2_000,
  graceMs: 1_500,
  /** Before the first kick of sudden death the clients show its title card */
  suddenDeathCardMs: 3_600,
  /** Contact comes this long after a free kick is committed (the run-up, plus slack for the network) */
  runupMs: 1_450,
  /** ...and for a field goal, after the snap's called (plus the operation time) */
  snapLeadMs: 250,
  /** After a result, the next kick starts when both have watched the replay, or after this */
  replayMs: 12_000,
  /** A keeper flick is trusted to this much earlier than when it arrived (network jitter) */
  flickToleranceMs: 120,
  /** Rooms nobody has joined are closed after this */
  idleRoomMs: 10 * 60_000,
} as const;

export type ClientMsg =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'create'; mode: OnlineMode }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  /** Clock sync: the client's clock when sent, and its latest round-trip estimate */
  | { t: 'ping'; c: number; rtt?: number }
  | { t: 'call'; side: CoinCall }
  | { t: 'choose'; kickFirst: boolean }
  | { t: 'wall'; wall: WallConfig | null }
  | { t: 'kick'; input: KickInput }
  | { t: 'keeper'; input: KeeperInput }
  | { t: 'emote'; kind: string }
  /** Done watching the replay */
  | { t: 'ready' }
  | { t: 'rematch' };

/** Everything a client needs to play one kick. */
export interface KickStart {
  /** Which kick of the match (0-based), the round, and who shoots */
  n: number;
  round: number;
  shooter: Seat;
  spot: Spot;
  wind: Vec3;
  cam: CableCam | null;
  /** When the round's clock (the cable cam's swing) started */
  clock0: number;
  /** The shot clock, ms */
  aimMs: number;
  /** Every kick so far */
  kicks: KickRecord[];
}

export interface KickResultMsg {
  n: number;
  /** Null: the shot clock ran out */
  launch: LaunchState | null;
  keeper: KeeperInput | null;
  wall: WallConfig | null;
  outcome: Outcome;
  tag: OutcomeTag;
  scored: boolean;
  kicks: KickRecord[];
}

export type ServerMsg =
  | { t: 'welcome'; token: string; /** False: the token was for a match that is already gone */ restored?: boolean }
  | { t: 'room'; code: string; mode: OnlineMode; seat: Seat; names: [string, string | null] }
  | { t: 'pong'; c: number; s: number }
  | { t: 'opponent'; connected: boolean; name?: string }
  /** The coin toss: who calls it, and by when */
  | { t: 'toss_call'; caller: Seat; deadline: number }
  /** How it came down, and by when the winner must choose */
  | { t: 'toss'; call: CoinCall; side: CoinCall; winner: Seat; deadline: number }
  | { t: 'toss_choice'; chooser: Seat; kickFirst: boolean; firstShooter: Seat }
  | ({ t: 'kick_start' } & KickStart)
  /** The keeper's wall is set (the clock starts now) */
  | { t: 'wall'; n: number; wall: WallConfig | null; deadline: number }
  /** The shot's committed: contact at this time. The shooter (and both, for a field goal) get the launch now; the keeper only at contact. */
  | { t: 'committed'; n: number; contact: number; launch?: LaunchState }
  | { t: 'launch'; n: number; launch: LaunchState }
  /** The keeper's flick, passed on to the shooter */
  | { t: 'keeper'; n: number; input: KeeperInput }
  | ({ t: 'result' } & KickResultMsg)
  | { t: 'emote'; kind: string }
  | { t: 'end'; winner: Seat; kicks: KickRecord[]; forfeit: boolean }
  | { t: 'rematch'; seat: Seat }
  | { t: 'error'; msg: string };
