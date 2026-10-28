import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5174, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        determinism: resolve(__dirname, 'determinism.html'),
      },
    },
  },
});
