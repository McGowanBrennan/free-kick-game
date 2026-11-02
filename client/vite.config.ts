import { defineConfig } from 'vite';

export default defineConfig({
  // Friend matches: the game server (npm run server) on 8787, reached through the dev server's own port.
  server: { port: 5175, strictPort: true, proxy: { '/ws': { target: 'ws://127.0.0.1:8787', ws: true } } },
  preview: { proxy: { '/ws': { target: 'ws://127.0.0.1:8787', ws: true } } },
  // One bundle (three.js included) is ~160 kB gzipped: fine for a game that loads once and then runs offline.
  build: { chunkSizeWarningLimit: 700 },
});
