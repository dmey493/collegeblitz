import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produces ONE self-contained dist/index.html (double-click to play vs CPU).
// During `npm run dev`, /ws is proxied to the game server (`npm run server`) for online play.
export default defineConfig({
  plugins: [viteSingleFile()],
  server: {
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
  },
});
