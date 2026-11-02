// Match rules (SPEC §1.1): 5 kicks each, early finish, sudden death.
// Pure functions over an immutable kick list, so server and clients agree.

import type { Outcome, OutcomeTag } from './sim';

export type PlayerId = 0 | 1;

export const REGULATION_KICKS = 5;

export interface KickRecord {
  shooter: PlayerId;
  scored: boolean;
  outcome: Outcome;
  tag: OutcomeTag;
}

export interface MatchState {
  firstShooter: PlayerId;
  kicks: readonly KickRecord[];
}

export function createMatch(firstShooter: PlayerId): MatchState {
  return { firstShooter, kicks: [] };
}

export function recordKick(state: MatchState, kick: KickRecord): MatchState {
  return { ...state, kicks: [...state.kicks, kick] };
}

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function kicksTaken(state: MatchState, p: PlayerId): number {
  return state.kicks.filter((k) => k.shooter === p).length;
}

export function goals(state: MatchState, p: PlayerId): number {
  return state.kicks.filter((k) => k.shooter === p && k.scored).length;
}

export function winner(state: MatchState): PlayerId | null {
  const ga = goals(state, 0);
  const gb = goals(state, 1);
  const ta = kicksTaken(state, 0);
  const tb = kicksTaken(state, 1);
  if (ta <= REGULATION_KICKS && tb <= REGULATION_KICKS) {
    // Regulation: over as soon as one side cannot be caught.
    if (ga > gb + (REGULATION_KICKS - tb)) return 0;
    if (gb > ga + (REGULATION_KICKS - ta)) return 1;
    return null;
  }
  // Sudden death: decided only at the end of a round.
  if (ta === tb && ga !== gb) return ga > gb ? 0 : 1;
  return null;
}

/** Who shoots next, or null when the match is over. */
export function nextShooter(state: MatchState): PlayerId | null {
  if (winner(state) !== null) return null;
  return state.kicks.length % 2 === 0 ? state.firstShooter : other(state.firstShooter);
}

/** 1-based round of the next kick. */
export function currentRound(state: MatchState): number {
  return Math.floor(state.kicks.length / 2) + 1;
}

export function isSuddenDeath(round: number): boolean {
  return round > REGULATION_KICKS;
}
