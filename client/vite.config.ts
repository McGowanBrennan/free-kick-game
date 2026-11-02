import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5175, strictPort: true },
  // One bundle (three.js included) is ~160 kB gzipped: fine for a game that loads once and then runs offline.
  build: { chunkSizeWarningLimit: 700 },
});
