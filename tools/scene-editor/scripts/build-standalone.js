/**
 * Build Standalone Game HTML
 * 
 * Combines dist/game.html + JS bundles + scene bundle into a single .html file.
 * Usage: node scripts/build-standalone.js <scene-bundle.json> [output.html]
 * 
 * The output file can be opened directly in a browser — no server needed.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');

// Parse args
const scenePath = process.argv[2];
const outputPath = process.argv[3] || resolve(rootDir, 'standalone-game.html');

if (!scenePath) {
  console.error('Usage: node scripts/build-standalone.js <scene-bundle.json> [output.html]');
  console.error('Example: node scripts/build-standalone.js my-scene.json standalone.html');
  process.exit(1);
}

if (!existsSync(scenePath)) {
  console.error(`Scene file not found: ${scenePath}`);
  process.exit(1);
}

console.log(`Building standalone game...`);
console.log(`  Scene: ${scenePath}`);
console.log(`  Output: ${outputPath}`);

// Read scene bundle
const sceneData = readFileSync(scenePath, 'utf-8');
console.log(`  Scene size: ${(sceneData.length / 1024).toFixed(0)} KB`);

// Read dist/game.html
const gameHtml = readFileSync(resolve(distDir, 'game.html'), 'utf-8');

// Find JS files referenced in game.html
const scriptMatches = gameHtml.matchAll(/src="([^"]+\.js)"/g);
const scripts = [];
for (const match of scriptMatches) {
  const jsPath = resolve(distDir, match[1].replace(/^\//, ''));
  if (existsSync(jsPath)) {
    scripts.push({ tag: match[0], path: jsPath, content: readFileSync(jsPath, 'utf-8') });
    console.log(`  JS: ${basename(jsPath)} (${(readFileSync(jsPath).length / 1024).toFixed(0)} KB)`);
  }
}

// Also find CSS
const cssMatches = gameHtml.matchAll(/href="([^"]+\.css)"/g);
const styles = [];
for (const match of cssMatches) {
  const cssPath = resolve(distDir, match[1].replace(/^\//, ''));
  if (existsSync(cssPath)) {
    styles.push({ tag: match[0], path: cssPath, content: readFileSync(cssPath, 'utf-8') });
  }
}

// Build the standalone HTML
let html = gameHtml;

// Inline CSS
for (const style of styles) {
  html = html.replace(`<link rel="stylesheet" ${style.tag}>`, `<style>${style.content}</style>`);
}

// Remove module preload links
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');

// Inline JS (replace script tags with inline scripts)
for (const script of scripts) {
  html = html.replace(
    `<script type="module" ${script.tag}></script>`,
    `<script type="module">${script.content}</script>`
  );
  // Also try crossorigin variant
  html = html.replace(
    `<script type="module" crossorigin ${script.tag}></script>`,
    `<script type="module">${script.content}</script>`
  );
}

// If there are still external script references, try to inline them differently
const remainingScripts = html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g);
for (const match of remainingScripts) {
  const src = match[1].replace(/^\//, '');
  const fullPath = resolve(distDir, src);
  if (existsSync(fullPath)) {
    const content = readFileSync(fullPath, 'utf-8');
    html = html.replace(match[0], `<script type="module">${content}</script>`);
    console.log(`  Inlined: ${src}`);
  }
}

// Inject scene data as an embedded variable (auto-load on start)
const sceneInjection = `
<script>
  // Embedded scene bundle — auto-loaded on game start
  window.__EMBEDDED_SCENE__ = ${sceneData};
</script>
`;

// Insert before closing </body>
html = html.replace('</body>', `${sceneInjection}\n</body>`);

// Write output
writeFileSync(outputPath, html, 'utf-8');
const outputSize = (readFileSync(outputPath).length / 1024 / 1024).toFixed(1);
console.log(`\n✅ Standalone game built: ${outputPath} (${outputSize} MB)`);
console.log(`   Open in browser to play!`);
