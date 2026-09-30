import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Vite config for building a single-file standalone game bundle.
 * Outputs one JS file (no code splitting) that can be inlined into HTML.
 */
export default defineConfig({
  build: {
    outDir: 'dist-standalone',
    rollupOptions: {
      input: {
        game: resolve(__dirname, 'game.html'),
      },
      output: {
        // Single chunk — no code splitting
        inlineDynamicImports: true,
      },
    },
  },
});
