import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './', // 使用相對路徑適應GitHub Pages子目錄
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@/core': resolve(__dirname, './src/core'),
      '@/entities': resolve(__dirname, './src/entities'),
      '@/systems': resolve(__dirname, './src/systems'),
      '@/ui': resolve(__dirname, './src/ui'),
    },
  },
  server: {
    port: 3001, // 避免與其他編輯器衝突
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
