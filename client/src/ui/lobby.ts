// The "Play a friend" screen: your name and the game, then create a room
// (a code and an invite link to send) or join one with its code. An invite
// link (/?room=CODE) opens straight onto it. When both are in, the match
// starts (the server runs it from there).

import { ROOM_CODE_LENGTH, other, type ServerMsg } from '@fk/shared';
import { OnlineClient, saveName, savedName } from '../net/online';
import type { GameMode, OnlineConfig } from './menu';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class Lobby {
  private conn: OnlineClient | null = null;
  /** Stops a wait for the friend when the player backs out */
  private waiting: AbortController | null = null;
  private code = '';

  constructor(
    private readonly onStart: (cfg: OnlineConfig) => void,
    private readonly mode: () => GameMode,
    private readonly back: () => void,
  ) {
    const name = $<HTMLInputElement>('#online-name');
    name.value = savedName();
    const code = $<HTMLInputElement>('#online-code');
    code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH)));
    document.querySelectorAll<HTMLElement>('[data-online]').forEach((b) =>
      b.addEventListener('click', () => {
        const what = b.dataset.online;
        if (what === 'create') void this.create();
        else if (what === 'join') void this.join(code.value);
        else if (what === 'share') void this.share();
        else if (what === 'back') this.leave();
      }),
    );
  }

  /** Open the screen (fresh), optionally with an invite's code (joined straight away if we know the player's name). */
  open(code?: string): void {
    this.reset();
    if (!code) return;
    $<HTMLInputElement>('#online-code').value = code.toUpperCase().slice(0, ROOM_CODE_LENGTH);
    if (savedName()) void this.join(code);
    else {
      this.status('Pop your name in, then tap Join');
      $<HTMLInputElement>('#online-name').focus();
    }
  }

  private reset(): void {
    this.waiting?.abort();
    this.waiting = null;
    this.conn?.close();
    this.conn = null;
    $('#screen-online .online-setup').hidden = false;
    $('#screen-online .online-wait').hidden = true;
    this.status('');
    this.busy(false);
  }

  private leave(): void {
    this.reset();
    this.back();
  }

  private status(text: string, error = false): void {
    const el = $('#screen-online .online-status');
    el.textContent = text;
    el.classList.toggle('error', error);
  }

  private busy(on: boolean): void {
    document.querySelectorAll<HTMLButtonElement>('#screen-online .online-setup button').forEach((b) => (b.disabled = on));
  }

  private name(): string | null {
    const input = $<HTMLInputElement>('#online-name');
    const name = input.value.trim().slice(0, 16);
    if (name.length < 2) {
      this.status('Pick a name first (2–16 letters)', true);
      input.focus();
      return null;
    }
    saveName(name);
    return name;
  }

  /** Connect, and send the first message (create or join); resolves with the room, or null (the error's shown). */
  private async enter(first: { t: 'create'; mode: GameMode } | { t: 'join'; code: string }): Promise<Extract<ServerMsg, { t: 'room' }> | null> {
    const name = this.name();
    if (!name) return null;
    this.busy(true);
    this.status('Connecting…');
    const conn = new OnlineClient(name);
    try {
      await conn.connect();
    } catch {
      this.busy(false);
      this.status("Can't reach the game server. Check your connection and try again.", true);
      return null;
    }
    this.conn = conn;
    conn.send(first);
    const m = await conn.next(['room', 'error']);
    if (m.t === 'error') {
      this.reset();
      this.status(m.msg, true);
      return null;
    }
    return m;
  }

  private async create(): Promise<void> {
    const room = await this.enter({ t: 'create', mode: this.mode() });
    if (!room) return;
    this.code = room.code;
    $('#screen-online .online-setup').hidden = true;
    $('#screen-online .online-wait').hidden = false;
    $('#screen-online .room-code').textContent = room.code;
    $('#screen-online .room-game').textContent = room.mode === 'fieldgoal' ? 'Field goals' : 'Free kicks';
    this.status('Waiting for your friend…');
    await this.awaitFriend(room);
  }

  private async join(code: string): Promise<void> {
    if (code.length !== ROOM_CODE_LENGTH) {
      this.status(`Room codes are ${ROOM_CODE_LENGTH} letters`, true);
      return;
    }
    const room = await this.enter({ t: 'join', code });
    if (!room) return;
    this.status(`Joining ${room.names[0] || 'your friend'}'s room…`);
    await this.awaitFriend(room);
  }

  private async awaitFriend(room: Extract<ServerMsg, { t: 'room' }>): Promise<void> {
    const conn = this.conn!;
    this.waiting = new AbortController();
    const signal = this.waiting.signal;
    const m = await Promise.race([conn.next(['opponent'], signal), new Promise<null>((r) => signal.addEventListener('abort', () => r(null)))]);
    if (!m || !m.connected) return;
    this.waiting = null;
    const names: [string, string] = [room.names[0] ?? '', room.names[1] ?? ''];
    names[other(room.seat)] = m.name ?? 'Friend';
    // The match has it now.
    this.conn = null;
    this.onStart({ kind: 'online', mode: room.mode, conn, seat: room.seat, names });
  }

  /** The invite: the share sheet where there is one, otherwise the link copied. */
  private async share(): Promise<void> {
    const url = `${location.origin}/?room=${this.code}`;
    const text = `Come and play me at Free Kick Duel: room ${this.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Free Kick Duel', text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      this.status('Invite link copied: send it to your friend');
    } catch {
      this.status(`Send your friend the code ${this.code}, or ${url}`);
    }
  }
}
