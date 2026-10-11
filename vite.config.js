import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produces ONE self-contained dist/index.html (double-click to play vs CPU).
// During `npm run dev`, /api (matchmaking) and /ws (server rooms) are proxied to the local
// game server (`npm start`) so online play works in development too.
export default defineConfig({
  plugins: [viteSingleFile()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787' },
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
  },
});
