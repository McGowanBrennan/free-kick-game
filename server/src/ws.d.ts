// The small part of the 'ws' package's API the server uses (it ships no types of its own).

declare module 'ws' {
  import type { IncomingMessage, Server } from 'node:http';
  import type { EventEmitter } from 'node:events';

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    ping(): void;
    on(event: 'message', fn: (data: Buffer | string) => void): this;
    on(event: 'close', fn: () => void): this;
    on(event: 'pong', fn: () => void): this;
    on(event: 'error', fn: (err: Error) => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(opts: { server: Server; path?: string; maxPayload?: number });
    readonly clients: Set<WebSocket>;
    on(event: 'connection', fn: (ws: WebSocket, req: IncomingMessage) => void): this;
    close(): void;
  }
}
