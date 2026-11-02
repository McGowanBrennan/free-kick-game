import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_PARAMS as P, ONLINE, kickInputForTarget, powerForSpeed, type ServerMsg, type Seat } from '@fk/shared';
import { Room } from '../src/room';

type Inbox = ServerMsg[];

/** A room with two players whose messages are collected; times run on fake timers. */
function setup(mode: 'freekick' | 'fieldgoal' = 'freekick', random = () => 0.3) {
  const inbox: [Inbox, Inbox] = [[], []];
  const room = new Room('ABCDEF', mode, { random });
  const seat = (i: Seat) => ({ name: i ? 'Guest' : 'Host', token: `t${i}`, send: (m: ServerMsg) => inbox[i].push(m), rtt: 60 });
  room.sit(seat(0));
  room.sit(seat(1));
  const last = <T extends ServerMsg['t']>(i: Seat, t: T) => [...inbox[i]].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  return { room, inbox, last, seat };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a friend match on the server', () => {
  test('both are seated and told about each other, then the friend who joined calls the toss', () => {
    const { inbox, last } = setup();
    expect(last(0, 'room')!.names).toEqual(['Host', 'Guest']);
    expect(last(1, 'room')!.seat).toBe(1);
    expect(last(0, 'opponent')!.name).toBe('Guest');
    vi.advanceTimersByTime(700);
    expect(last(0, 'toss_call')!.caller).toBe(1);
    expect(inbox[1].some((m) => m.t === 'toss_call')).toBe(true);
  });

  test('the toss: the winner chooses, and choosing to keep makes the other side shoot first', () => {
    // random 0.3: heads; the guest calls heads and wins.
    const { room, last } = setup();
    vi.advanceTimersByTime(700);
    room.call(0, 'tails'); // not the caller: ignored
    room.call(1, 'heads');
    const toss = last(0, 'toss')!;
    expect(toss.side).toBe('heads');
    expect(toss.winner).toBe(1);
    room.choose(0, true); // not the winner: ignored
    room.choose(1, false);
    expect(last(0, 'toss_choice')).toMatchObject({ chooser: 1, kickFirst: false, firstShooter: 0 });
    vi.advanceTimersByTime(2500);
    const k = last(1, 'kick_start')!;
    expect(k.shooter).toBe(0);
    expect(k.n).toBe(0);
  });

  test('no call or choice in time: called heads, and the winner kicks first', () => {
    const { last } = setup('freekick', () => 0.9);
    vi.advanceTimersByTime(700 + 1700 + ONLINE.callMs + ONLINE.graceMs + 10);
    expect(last(0, 'toss')).toMatchObject({ call: 'heads', side: 'tails', winner: 0 });
    vi.advanceTimersByTime(3000 + ONLINE.chooseMs + ONLINE.graceMs + 10);
    expect(last(1, 'toss_choice')).toMatchObject({ chooser: 0, kickFirst: true, firstShooter: 0 });
  });

  test('a free kick: the keeper only gets the flight at contact; the flick goes to the shooter; one result for both', () => {
    const { room, inbox, last } = setup();
    vi.advanceTimersByTime(700);
    room.call(1, 'heads');
    room.choose(1, true); // the guest shoots first
    vi.advanceTimersByTime(2500);
    const k = last(0, 'kick_start')!;
    expect(k.shooter).toBe(1);
    if (k.spot.maxWall > 0) room.wall(0, { size: 3, offset: 0.4 });
    room.shoot(1, kickInputForTarget(k.spot, 2.5, 1.2, powerForSpeed(27, P), 0, P));
    const shooterSaw = last(1, 'committed')!;
    const keeperSaw = last(0, 'committed')!;
    expect(shooterSaw.launch).toBeDefined();
    expect(keeperSaw.launch).toBeUndefined();
    expect(inbox[0].some((m) => m.t === 'launch')).toBe(false);
    // The flick, during the run-up (a guess), is passed on.
    vi.advanceTimersByTime(800);
    room.keep(0, { vx: 0.3, vy: -0.1, durMs: 150, flickTick: -100 });
    expect(last(1, 'keeper')!.input.vx).toBeCloseTo(0.3);
    vi.advanceTimersByTime(ONLINE.runupMs);
    expect(inbox[0].some((m) => m.t === 'launch')).toBe(true);
    vi.advanceTimersByTime(4000);
    const r0 = last(0, 'result')!;
    const r1 = last(1, 'result')!;
    expect(r0).toEqual(r1);
    expect(r0.kicks).toHaveLength(1);
    expect(r0.keeper!.flickTick).toBeGreaterThanOrEqual(-110);
  });

  test("a keeper can't claim to have flicked earlier than he could have", () => {
    const { room, last } = setup();
    vi.advanceTimersByTime(700);
    room.call(1, 'heads');
    room.choose(1, true);
    vi.advanceTimersByTime(2500);
    const k = last(0, 'kick_start')!;
    if (k.spot.maxWall > 0) room.wall(0, null);
    room.shoot(1, kickInputForTarget(k.spot, -2.5, 0.6, powerForSpeed(27, P), 0, P));
    // Well after contact, claiming a flick in the run-up.
    vi.advanceTimersByTime(ONLINE.runupMs + 300);
    room.keep(0, { vx: -0.3, vy: -0.05, durMs: 150, flickTick: -150 });
    // 300 ms after contact, less half the round trip (30) and the jitter allowance (120): 150 ms = 36 ticks.
    expect(last(1, 'keeper')!.input.flickTick).toBe(36);
  });

  test('the shot clock: a miss; two in a row and the match is forfeited', () => {
    const { room, last } = setup('fieldgoal');
    vi.advanceTimersByTime(700);
    room.call(1, 'heads');
    room.choose(1, true);
    vi.advanceTimersByTime(2500);
    vi.advanceTimersByTime(ONLINE.revealMs + ONLINE.aimMs + ONLINE.graceMs + 10);
    expect(last(0, 'result')).toMatchObject({ tag: 'shot_clock', scored: false, launch: null });
    // Both ready: the other side's kick.
    room.ready(0);
    room.ready(1);
    expect(last(0, 'kick_start')!.shooter).toBe(0);
    room.shoot(0, kickInputForTarget(last(0, 'kick_start')!.spot, 0, 8, powerForSpeed(30, P), 0, P));
    vi.advanceTimersByTime(10_000);
    room.ready(0);
    room.ready(1);
    vi.advanceTimersByTime(ONLINE.revealMs + ONLINE.aimMs + ONLINE.graceMs + 10);
    expect(last(0, 'end')).toMatchObject({ winner: 0, forfeit: true });
  });

  test('a whole field goal match plays out to a winner, and both can rematch', () => {
    const { room, last } = setup('fieldgoal');
    vi.advanceTimersByTime(700);
    room.call(1, 'heads');
    room.choose(1, true);
    vi.advanceTimersByTime(2500);
    for (let i = 0; i < 40 && !last(0, 'end'); i++) {
      const k = last(0, 'kick_start')!;
      // The host makes everything (a big kick down the middle), the guest kicks it nowhere.
      const input =
        k.shooter === 0 ? kickInputForTarget(k.spot, 0, 9, powerForSpeed(34, P), 0, P) : kickInputForTarget(k.spot, 15, 0.5, 0.2, 0, P);
      room.shoot(k.shooter, input);
      vi.advanceTimersByTime(10_000);
      room.ready(0);
      room.ready(1);
    }
    const end = last(1, 'end')!;
    expect(end.forfeit).toBe(false);
    expect(end.winner).toBe(0);
    room.rematch(0);
    expect(last(1, 'rematch')!.seat).toBe(0);
    room.rematch(1);
    expect(last(0, 'toss_call')).toBeDefined();
  });

  test('a dropped player is waited for (the kick starts over when they are back); gone too long and they forfeit', () => {
    const { room, last, inbox, seat } = setup();
    vi.advanceTimersByTime(700);
    room.call(1, 'heads');
    room.choose(1, true);
    vi.advanceTimersByTime(2500);
    const n = inbox[0].filter((m) => m.t === 'kick_start').length;
    room.drop(1);
    expect(last(0, 'opponent')!.connected).toBe(false);
    // Nothing moves on while they're gone.
    vi.advanceTimersByTime(ONLINE.reconnectMs - 1000);
    expect(last(0, 'result')).toBeUndefined();
    room.rejoin(1, seat(1).send);
    expect(last(0, 'opponent')!.connected).toBe(true);
    expect(inbox[0].filter((m) => m.t === 'kick_start').length).toBe(n + 1);
    room.drop(1);
    vi.advanceTimersByTime(ONLINE.reconnectMs + 10);
    expect(last(0, 'end')).toMatchObject({ winner: 0, forfeit: true });
  });

  test('rejoining a chair that was given up does not throw', () => {
    const room = new Room('ABCDEF', 'freekick');
    room.sit({ name: 'Host', token: 't0', send: () => undefined, rtt: 60 });
    room.leave(0);
    expect(() => room.rejoin(0, () => undefined)).not.toThrow();
    expect(room.seats[0]).toBeNull();
  });

  test('a third player cannot take a chair once the match has both of them, even before the toss', () => {
    const { room } = setup();
    expect(room.sit({ name: 'Late', token: 't2', send: () => undefined, rtt: 60 })).toBeNull();
    expect(room.seats[0]?.name).toBe('Host');
    expect(room.seats[1]?.name).toBe('Guest');
  });

  test('a disconnect before the toss holds that chair: the late joiner is refused, and the toss waits', () => {
    const inbox: [Inbox, Inbox] = [[], []];
    const room = new Room('ABCDEF', 'freekick', { random: () => 0.3 });
    const send0 = (m: ServerMsg) => inbox[0].push(m);
    const send1 = (m: ServerMsg) => inbox[1].push(m);
    room.sit({ name: 'Host', token: 't0', send: send0, rtt: 60 });
    room.sit({ name: 'Guest', token: 't1', send: send1, rtt: 60 });
    room.drop(1);
    expect(inbox[0].at(-1)).toMatchObject({ t: 'opponent', connected: false });
    expect(room.sit({ name: 'Late', token: 't2', send: () => undefined, rtt: 60 })).toBeNull();
    expect(room.seats[1]?.token).toBe('t1');
    vi.advanceTimersByTime(2000);
    expect(inbox[0].some((m) => m.t === 'toss_call')).toBe(false);
    room.rejoin(1, (m) => inbox[1].push(m));
    vi.advanceTimersByTime(700);
    expect(inbox[0].some((m) => m.t === 'toss_call')).toBe(true);
    expect(inbox[1].some((m) => m.t === 'toss_call')).toBe(true);
  });

  test('after the toss, a drop pauses the kick; the old socket closing after they are back does not', () => {
    const inbox: [Inbox, Inbox] = [[], []];
    const room = new Room('ABCDEF', 'fieldgoal', { random: () => 0.3 });
    const send0 = (m: ServerMsg) => inbox[0].push(m);
    const send1 = (m: ServerMsg) => inbox[1].push(m);
    room.sit({ name: 'Host', token: 't0', send: send0, rtt: 60 });
    room.sit({ name: 'Guest', token: 't1', send: send1, rtt: 60 });
    vi.advanceTimersByTime(700);
    room.call(1, 'heads');
    room.choose(1, true);
    // The kick is due 2.4s after the choice. They drop: it must not start without them.
    room.drop(1);
    vi.advanceTimersByTime(3000);
    expect(inbox[0].some((m) => m.t === 'kick_start')).toBe(false);
    const send1b = (m: ServerMsg) => inbox[1].push(m);
    room.rejoin(1, send1b);
    // The socket they replaced closes late. That must not pause the kick again.
    room.dropFrom(1, send1);
    expect(inbox[0].filter((m) => m.t === 'opponent' && m.connected === false)).toHaveLength(1);
    expect(inbox[0].some((m) => m.t === 'kick_start')).toBe(true);
    expect(inbox[1].some((m) => m.t === 'kick_start')).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(inbox[0].filter((m) => m.t === 'opponent' && m.connected === false)).toHaveLength(1);
  });
});
