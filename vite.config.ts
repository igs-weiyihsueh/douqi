import { defineConfig } from 'vite';
import { resolve } from 'path';

// 🔧 Vite配置：回歸單一目錄架構，解決CI部署問題
export default defineConfig({
  base: './',
  
  // 📁 傳統架構：從根目錄開始，無需特殊root設定
  publicDir: 'public',
  
  server: {
    host: true,
    port: 5173
  },

  build: {
    target: 'es2020',
    outDir: 'dist', // 📦 輸出到dist/目錄
    emptyOutDir: true,  // 🧹 清空輸出目錄
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
      '@': resolve(__dirname, '.') // 📂 根目錄別名
    }
  }
});
