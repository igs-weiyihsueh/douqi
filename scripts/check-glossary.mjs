/**
 * 用語表檢查：確認 wiki/glossary.md 每一列的「程式名稱」與「設定」在目前程式碼裡還存在，對不上就列出警告。
 *
 * - 程式名稱欄：`檔案` › `名稱`、`名稱2`（多組以「；」分隔），名稱在該檔案中要找得到（取最後一段，例 slowTuning.lockRadius → lockRadius）；
 *   以引號包住的字面值（例 `'absent'`）要原樣出現在該檔案
 * - 設定欄：`a.b.c` 為 GameConfig 的屬性路徑，`*` 代表任一子鍵
 *
 * 只警告不擋建置（一律 exit 0），由 npm run build 先行呼叫；也可單獨執行 npm run check:glossary
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 檢查的用語表；可用第一個參數指定其他檔案（例：審稿中的新版） */
const GLOSSARY = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'wiki', 'glossary.md');
/** 表格列中各欄位的索引（以「|」切開後，第 0 格為列首空字串） */
const COL = { NAME: 1, CODE: 3, CONFIG: 4 };

/** 讀取專案內的檔案；不存在回傳 null */
function readSource(rel) {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

/** 把 config.ts 轉成 JS 後載入，取得 GameConfig 物件（config.ts 不 import 其他模組） */
async function loadGameConfig() {
  const { outputText } = ts.transpileModule(readSource('config.ts'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 }
  });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  return mod.GameConfig;
}

/** 取出儲存格中所有 `反引號` 包住的片段 */
function ticked(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** 屬性路徑是否存在於物件中；`*` 代表任一子鍵（至少一個子鍵符合後續路徑即可） */
function hasPath(obj, keys) {
  if (keys.length === 0) return true;
  if (obj === null || typeof obj !== 'object') return false;
  const [key, ...rest] = keys;
  if (key === '*') return Object.values(obj).some((v) => hasPath(v, rest));
  return Object.prototype.hasOwnProperty.call(obj, key) && hasPath(obj[key], rest);
}

/** 程式名稱是否出現在檔案中：字面值原樣比對，識別字取最後一段並去掉呼叫括號後以單字邊界比對 */
function hasSymbol(source, symbol) {
  if (/^['"]/.test(symbol)) return source.includes(symbol);
  const id = symbol.replace(/\(.*\)$/, '').split('.').pop();
  return new RegExp(`\\b${id}\\b`).test(source);
}

/** 檢查一列，回傳該列的問題清單 */
function checkRow(cells, config) {
  const name = cells[COL.NAME];
  const problems = [];
  for (const group of cells[COL.CODE].split('；')) {
    const [file, ...symbols] = ticked(group);
    if (!file) continue;
    const source = readSource(file);
    if (source === null) {
      problems.push(`${name}：找不到檔案 ${file}`);
      continue;
    }
    for (const symbol of symbols) {
      if (!hasSymbol(source, symbol)) problems.push(`${name}：${file} 裡找不到 ${symbol}`);
    }
  }
  for (const configPath of ticked(cells[COL.CONFIG])) {
    if (!hasPath(config, configPath.split('.'))) problems.push(`${name}：設定 GameConfig.${configPath} 不存在`);
  }
  return problems;
}

async function main() {
  if (!fs.existsSync(GLOSSARY)) return;
  const config = await loadGameConfig();
  const problems = [];
  for (const line of fs.readFileSync(GLOSSARY, 'utf8').split('\n')) {
    // 只看資料列：略過表頭（正式名稱）與分隔線
    if (!line.startsWith('|') || line.startsWith('|---') || line.includes('| 正式名稱 |')) continue;
    const cells = line.split('|').map((s) => s.trim());
    if (cells.length <= COL.CONFIG) continue;
    problems.push(...checkRow(cells, config));
  }
  if (problems.length === 0) return;
  console.warn(`\n⚠️  用語表（${path.relative(ROOT, GLOSSARY)}）有 ${problems.length} 處對不上程式，請更新用語表或確認是否誤改：`);
  for (const p of problems) console.warn(`   - ${p}`);
  console.warn('');
}

main().catch((err) => console.warn(`⚠️  用語表檢查無法執行：${err.message}`));
