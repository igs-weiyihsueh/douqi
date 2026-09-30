import { defineConfig } from 'vite';
import { resolve } from 'path';
import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readdirSync, statSync, unlinkSync } from 'fs';

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 2000, // Suppress chunk size warnings (Three.js is large)
    rollupOptions: {
      input: {
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },
  plugins: [
    {
      name: 'neutralino-build-api',
      configureServer(server) {
        // POST /__build_exe — triggers Neutralino build from editor
        server.middlewares.use('/__build_exe', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'POST only' }));
            return;
          }

          // Read request body (JSON with sceneBundle + optional outputDir)
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body);
              const sceneBundle = payload.sceneBundle;
              const outputDir = payload.outputDir; // optional: user-chosen output path

              // Save scene bundle to public directory for game.html to load
              const exportDir = resolve(__dirname, 'public', 'assets', 'models', 'Env', 'exp');
              mkdirSync(exportDir, { recursive: true });
              writeFileSync(resolve(exportDir, 'auto-export.scene.json'), sceneBundle);

              // Run the full build + neu package pipeline (spawnSync to ignore warnings on stderr)
              console.log('[Build EXE] Starting vite build...');
              const viteBuild = spawnSync('npx', ['vite', 'build'], {
                cwd: __dirname,
                shell: true,
                timeout: 90000,
                env: { ...process.env, FORCE_COLOR: '0' },
              });
              if (viteBuild.status !== 0) {
                throw new Error('vite build failed (exit ' + viteBuild.status + '): ' + (viteBuild.stderr?.toString().slice(-300) || ''));
              }
              console.log('[Build EXE] vite build done.');

              // Clean dist/assets/ — remove raw public files (models/textures from public/)
              // BUT keep Vite's built JS/CSS chunks (also in dist/assets/)
              // The scene bundle already has all models/textures embedded as base64
              const distDir = resolve(__dirname, 'dist');
              const publicDirs = ['models', 'textures', 'sounds', 'fonts'];
              for (const dir of publicDirs) {
                const fullPath = resolve(distDir, 'assets', dir);
                if (existsSync(fullPath)) {

                  rmSync(fullPath, { recursive: true, force: true });
                  console.log(`[Build EXE] Removed dist/assets/${dir}/`);
                }
              }
              // Also remove any loose large files in dist/assets/ that aren't JS/CSS
              const distAssetsDir = resolve(distDir, 'assets');
              if (existsSync(distAssetsDir)) {

                for (const file of readdirSync(distAssetsDir)) {
                  const fp = resolve(distAssetsDir, file);
                  if (statSync(fp).isFile() && !file.endsWith('.js') && !file.endsWith('.css')) {
                    unlinkSync(fp);
                  }
                }
              }
              // Re-create scene bundle path
              const distExpDir = resolve(distDir, 'assets', 'models', 'Env', 'exp');
              mkdirSync(distExpDir, { recursive: true });
              writeFileSync(resolve(distExpDir, 'auto-export.scene.json'), sceneBundle);
              console.log('[Build EXE] Scene bundle saved, JS/CSS preserved.');

              // Ensure neutralino.js client + favicon exist in dist/
              console.log('[Build EXE] Running neu update...');
              spawnSync('neu', ['update'], { cwd: __dirname, shell: true, timeout: 30000 });
              const faviconPath = resolve(distDir, 'favicon.ico');
              if (!existsSync(faviconPath)) writeFileSync(faviconPath, '');

              console.log('[Build EXE] Starting neu build...');
              const neuBuild = spawnSync('neu', ['build'], {
                cwd: __dirname,
                shell: true,
                timeout: 60000,
                env: { ...process.env, FORCE_COLOR: '0' },
              });
              if (neuBuild.status !== 0) {
                throw new Error('neu build failed (exit ' + neuBuild.status + '): ' + (neuBuild.stderr?.toString().slice(-300) || ''));
              }
              console.log('[Build EXE] neu build done.');

              // Copy to release
              const distExe = resolve(__dirname, 'dist', 'DouQi_Game', 'DouQi_Game-win_x64.exe');
              const distNeu = resolve(__dirname, 'dist', 'DouQi_Game', 'resources.neu');
              const releaseDir = resolve(__dirname, 'release');
              mkdirSync(releaseDir, { recursive: true });

              if (existsSync(distExe)) copyFileSync(distExe, resolve(releaseDir, 'DouQi_Game-win_x64.exe'));
              if (existsSync(distNeu)) copyFileSync(distNeu, resolve(releaseDir, 'resources.neu'));

              // Also copy to user-specified output directory
              let finalOutputDir = releaseDir;
              if (outputDir) {
                try {
                  mkdirSync(outputDir, { recursive: true });
                  if (existsSync(distExe)) copyFileSync(distExe, resolve(outputDir, 'DouQi_Game-win_x64.exe'));
                  if (existsSync(distNeu)) copyFileSync(distNeu, resolve(outputDir, 'resources.neu'));
                  finalOutputDir = outputDir;
                } catch (copyErr: any) {
                  console.warn('[Build EXE] Could not copy to outputDir:', copyErr.message);
                }
              }

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                success: true,
                path: finalOutputDir,
                files: ['DouQi_Game-win_x64.exe', 'resources.neu'],
              }));
              console.log('[Build EXE] Done! →', finalOutputDir);
            } catch (err: any) {
              console.error('[Build EXE] Failed:', err.message);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
        });

        // POST /__save_bundle — save scene bundle to public dir (for manual bat workflow)
        server.middlewares.use('/__save_bundle', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'POST only' }));
            return;
          }
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            try {
              const exportDir = resolve(__dirname, 'public', 'assets', 'models', 'Env', 'exp');
              mkdirSync(exportDir, { recursive: true });
              writeFileSync(resolve(exportDir, 'auto-export.scene.json'), body);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          });
        });
      },
    },
  ],
});
