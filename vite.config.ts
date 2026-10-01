import { defineConfig } from 'vite';
import { resolve } from 'path';

// 🔧 Vite重新架構：修正entry point，專注解決4vs24模組問題 + 目錄分離
export default defineConfig({
  base: './',
  
  // 📁 目錄分離：使用src/index.html作為入口
  root: 'src',
  publicDir: resolve(__dirname, 'public'),
  
  server: {
    host: true,
    port: 5173
  },

  build: {
    target: 'es2020',
    outDir: resolve(__dirname, 'dist'), // 📦 輸出到根目錄的dist/
    emptyOutDir: true,  // 🧹 解決outDir warning，清空輸出目錄
    minify: false,
    sourcemap: false,  // 先關閉sourcemap避免警告
    
    rollupOptions: {
      // 🎯 修正：讓Vite自動發現entry point
      treeshake: false,
      
      output: {
        entryFileNames: 'assets/index-[hash].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
});
