// The connection to the game server for friend matches (SPEC §6): one
// WebSocket at /ws on the page's own host. It keeps the server's clock (NTP
// style: the round trip with the smallest delay wins), comes back on its own
// after a drop (same token, so the server gives the seat back), and hands
// messages to the game in order: events (the opponent's taunts, the keeper's
// flick, the flight) go straight to their handlers; everything else queues
// until the game asks for it.

import type { ClientMsg, ServerMsg } from '@fk/shared';

type MsgOf<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

const NAME_KEY = 'fk.name';

export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage unavailable: asked again next time.
  }
}

export class OnlineClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  /** Server clock minus ours, ms, and the round trip it was measured on */
  private offset = 0;
  private bestRtt = Infinity;
  private samples: { offset: number; rtt: number }[] = [];
  private readonly queue: ServerMsg[] = [];
  private readonly waiters: { types: string[]; resolve: (m: ServerMsg) => void }[] = [];
  private readonly handlers = new Map<string, (m: ServerMsg) => void>();
  private pingTimer = 0;
  private closedByUs = false;
  private connected = false;
  /** Told when the connection drops (true) or is back (false) */
  onDrop: ((dropped: boolean) => void) | null = null;
  /** Rtt, ms (the best recent one) */
  get rtt(): number {
    return Number.isFinite(this.bestRtt) ? this.bestRtt : 150;
  }

  /** Told when a message is queued (nobody was waiting for it): the game may need to drop what it's doing */
  onQueue: ((m: ServerMsg) => void) | null = null;

  /** (The token that holds our seat lives only as long as the page: a reload starts afresh.) */
  constructor(private readonly name: string) {}

  /** Connect (resolves once the server has said welcome). */
  connect(): Promise<void> {
    this.closedByUs = false;
    return new Promise((resolve, reject) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        return reject(e);
      }
      this.ws = ws;
      let welcomed = false;
      ws.onopen = () => this.send({ t: 'hello', name: this.name, token: this.token ?? undefined });
      ws.onmessage = (ev) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          this.token = m.token;
          if (!welcomed) {
            welcomed = true;
            this.connected = true;
            this.startPings();
            resolve();
          }
          return;
        }
        if (m.t === 'pong') return this.onPong(m);
        this.deliver(m);
      };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (!welcomed) return reject(new Error('Could not reach the game server'));
        this.connected = false;
        if (this.closedByUs) return;
        this.onDrop?.(true);
        void this.reconnect();
      };
    });
  }

  /** Back after a drop: try every second for as long as the server would hold the seat. */
  private async reconnect(): Promise<void> {
    const until = performance.now() + 25_000;
    while (!this.closedByUs && performance.now() < until) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        await this.connect();
        this.onDrop?.(false);
        return;
      } catch {
        // Not yet.
      }
    }
  }

  close(): void {
    this.closedByUs = true;
    clearInterval(this.pingTimer);
    if (this.connected) this.send({ t: 'leave' });
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  // ── The server's clock ──

  private startPings(): void {
    clearInterval(this.pingTimer);
    // A quick burst to get a good estimate, then every few seconds.
    let n = 0;
    const ping = () => this.send({ t: 'ping', c: performance.now(), rtt: Number.isFinite(this.bestRtt) ? this.bestRtt : undefined });
    ping();
    this.pingTimer = window.setInterval(() => {
      ping();
      if (++n === 5) {
        clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(ping, 5000);
      }
    }, 250);
  }

  private onPong(m: MsgOf<'pong'>): void {
    const now = performance.now();
    const rtt = now - m.c;
    this.samples.push({ offset: m.s - (m.c + rtt / 2), rtt });
    if (this.samples.length > 8) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset;
    this.bestRtt = best.rtt;
  }

  /** The server's clock now, ms. */
  serverNow(): number {
    return performance.now() + this.offset;
  }

  /** A server time as our performance.now(). */
  toLocal(serverMs: number): number {
    return serverMs - this.offset;
  }

  // ── Messages ──

  private deliver(m: ServerMsg): void {
    // Dev: every message, for the console (window.__fkNet).
    if (import.meta.env.DEV) ((window as unknown as { __fkNet?: unknown[] }).__fkNet ??= []).push([Math.round(performance.now()), m.t, 'n' in m ? m.n : '']);
    const h = this.handlers.get(m.t);
    if (h) return h(m);
    const i = this.waiters.findIndex((w) => w.types.includes(m.t));
    if (i >= 0) {
      const [w] = this.waiters.splice(i, 1);
      return w.resolve(m);
    }
    this.queue.push(m);
    this.onQueue?.(m);
  }

  /** Handle every message of this type as it comes, instead of queueing it (null to stop). */
  on<T extends ServerMsg['t']>(t: T, fn: ((m: MsgOf<T>) => void) | null): void {
    if (fn) this.handlers.set(t, fn as (m: ServerMsg) => void);
    else this.handlers.delete(t);
  }

  /**
   * The next message of any of these types (one already queued, or the next
   * to arrive). If `signal` aborts first, the wait is withdrawn (so the
   * message goes to whoever asks next) and the promise never settles.
   */
  next<T extends ServerMsg['t']>(types: T[], signal?: AbortSignal): Promise<MsgOf<T>> {
    const i = this.queue.findIndex((m) => (types as string[]).includes(m.t));
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0] as MsgOf<T>);
    return new Promise((resolve) => {
      const w = { types: types as string[], resolve: resolve as (m: ServerMsg) => void };
      this.waiters.push(w);
      signal?.addEventListener(
        'abort',
        () => {
          const k = this.waiters.indexOf(w);
          if (k >= 0) this.waiters.splice(k, 1);
        },
        { once: true },
      );
    });
  }

  /** A message of one of these types is waiting (without taking it). */
  has(...types: ServerMsg['t'][]): boolean {
    return this.queue.some((m) => types.includes(m.t));
  }

  /** Drop queued messages of these types. */
  discard(...types: ServerMsg['t'][]): void {
    for (let i = this.queue.length - 1; i >= 0; i--) if (types.includes(this.queue[i].t)) this.queue.splice(i, 1);
  }
}
