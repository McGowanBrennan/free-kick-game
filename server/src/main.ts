// The Flick Arena game server: serves the built game (client/dist) and runs friend
// matches over a WebSocket at /ws (SPEC §6). One process, one port (PORT,
// default 8787), so it can be deployed anywhere that runs Node and allows
// WebSockets. Rooms live in memory.

import { randomBytes, randomInt } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { ONLINE, ROOM_CODE_CHARS, ROOM_CODE_LENGTH, type ClientMsg, type Seat, type ServerMsg } from '@fk/shared';
import { Room } from './room';

const PORT = Number(process.env.PORT ?? 8787);
const STATIC = resolve(process.env.STATIC_DIR ?? join(fileURLToPath(new URL('.', import.meta.url)), '../../client/dist'));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

// ── The game itself, as static files (any page path falls back to the app) ──

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(`ok ${rooms.size} rooms`);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  let file = normalize(join(STATIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC + sep) && file !== STATIC) {
    res.writeHead(403);
    return res.end();
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('The game has not been built: run npm run build');
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  // Hashed assets never change; everything else is checked each time.
  const cache = url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
});

// ── Rooms ──

const rooms = new Map<string, Room>();
/** Where each player token sits, so a dropped connection can come back */
const seatsByToken = new Map<string, { room: Room; seat: Seat }>();
/** The live socket for a token. A replaced connection's close must not drop the seat. */
const sockets = new Map<string, WebSocket>();

function forgetToken(token: string): void {
  seatsByToken.delete(token);
  sockets.delete(token);
}

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

function closeRoom(room: Room): void {
  room.dispose();
  rooms.delete(room.code);
  for (const [token, at] of seatsByToken) if (at.room === room) forgetToken(token);
}

// Tidy up: rooms nobody's connected to, or nobody joined, after a while.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if ((room.closed && now - room.lastActive > ONLINE.reconnectMs * 2) || now - room.lastActive > ONLINE.idleRoomMs) closeRoom(room);
  }
}, 30_000);

// ── Connections ──

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  let token = '';
  let name = 'Player';
  let at: { room: Room; seat: Seat } | null = null;
  let alive = true;
  ws.on('pong', () => (alive = true));
  const beat = setInterval(() => {
    if (!alive) {
      clearInterval(beat);
      ws.terminate();
      return;
    }
    alive = false;
    try {
      ws.ping();
    } catch {
      // Already closing.
    }
  }, 15_000);

  const send = (m: ServerMsg) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
  const error = (msg: string) => send({ t: 'error', msg });
  /** This socket is the live one for the token. An older socket is closed and must not drop the seat. */
  const claim = () => {
    const prev = sockets.get(token);
    sockets.set(token, ws);
    if (prev && prev !== ws) prev.terminate();
  };
  const sit = (room: Room) => {
    const seat = room.sit({ name, token, send, rtt: 100 });
    if (seat === null) return error('That room is full');
    at = { room, seat };
    seatsByToken.set(token, at);
    claim();
  };

  ws.on('message', (data) => {
    // Any traffic counts as alive. A proxy may swallow protocol pongs; the client's own pings must not look like a dead socket.
    alive = true;
    // A socket we already replaced (they reconnected) can still deliver a late message. Ignore it.
    const owner = token ? sockets.get(token) : undefined;
    if (owner && owner !== ws) return;
    let m: ClientMsg;
    try {
      m = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    try {
      if (m.t === 'ping') {
        send({ t: 'pong', c: m.c, s: Date.now() });
        if (at) at.room.setRtt(at.seat, m.rtt);
        return;
      }
      if (m.t === 'hello') {
        name = String(m.name ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Player';
        // Coming back with a token that still has a chair: pick the match back up.
        const requested = typeof m.token === 'string' ? m.token : undefined;
        const back = requested ? seatsByToken.get(requested) : undefined;
        const holder = back && rooms.has(back.room.code) ? back.room.seats[back.seat] : undefined;
        if (back && holder?.token === requested) {
          token = requested!;
          send({ t: 'welcome', token, restored: true });
          at = back;
          claim();
          back.room.rejoin(back.seat, send);
          return;
        }
        if (requested) forgetToken(requested);
        token = randomBytes(16).toString('hex');
        send({ t: 'welcome', token, ...(requested ? { restored: false } : {}) });
        if (requested) send({ t: 'error', msg: 'The match ended while you were disconnected' });
        return;
      }
      if (!token) return error('Say hello first');
      if (m.t === 'create') {
        if (at) at.room.leave(at.seat);
        const room = new Room(newCode(), m.mode === 'fieldgoal' ? 'fieldgoal' : 'freekick', { onSeatGone: forgetToken });
        rooms.set(room.code, room);
        return sit(room);
      }
      if (m.t === 'join') {
        const room = rooms.get(String(m.code ?? '').toUpperCase().trim());
        if (!room) return error('No room with that code');
        if (at?.room === room && at.room.seats[at.seat]?.token === token) return;
        if (at) at.room.leave(at.seat);
        return sit(room);
      }
      if (!at) return;
      const { room, seat } = at;
      switch (m.t) {
        case 'leave':
          room.leave(seat);
          forgetToken(token);
          at = null;
          if (room.closed) closeRoom(room);
          return;
        case 'call':
          return room.call(seat, m.side);
        case 'choose':
          return room.choose(seat, m.kickFirst);
        case 'wall':
          return room.wall(seat, m.wall);
        case 'kick':
          return room.shoot(seat, m.input);
        case 'keeper':
          return room.keep(seat, m.input);
        case 'emote':
          return room.emote(seat, m.kind);
        case 'ready':
          return room.ready(seat);
        case 'rematch':
          return room.rematch(seat);
      }
    } catch (err) {
      console.error('room message failed', err);
    }
  });

  ws.on('close', () => {
    clearInterval(beat);
    // Only the socket that still owns the chair can drop it. The one we replaced must not.
    if (!at || sockets.get(token) !== ws) return;
    at.room.dropFrom(at.seat, send);
  });
  ws.on('error', () => undefined);
});

http.listen(PORT, () => {
  console.log(`Flick Arena server on :${PORT} (game files from ${STATIC}${existsSync(STATIC) ? '' : ', not built yet'})`);
});
