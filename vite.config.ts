import { defineConfig } from 'vite';
import { resolve } from 'path';

// 🔧 Vite重新架構：修正entry point，專注解決4vs24模組問題
export default defineConfig({
  base: './',
  
  server: {
    host: true,
    port: 5173
  },

  build: {
    target: 'es2020',
    outDir: 'dist',
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
