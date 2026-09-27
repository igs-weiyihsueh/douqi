import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

/** 編輯器工作檔（含背景圖、障礙物種類等遊戲不讀的編輯器專用欄位） */
const WORK_FILE = path.resolve(repoRoot, 'public/assets/data/levels/Level01.json');
/** 遊戲實際讀取的場景檔目錄（GameEngine._loadSceneData 讀 /scenes/<name>.douqi.json） */
const SCENE_DIR = path.resolve(repoRoot, 'public/scenes');

const SCENE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

function sceneFilePath(name: string): string {
  if (!SCENE_NAME_RE.test(name)) throw new Error(`場景名不合法：${name}`);
  const p = path.resolve(SCENE_DIR, `${name}.douqi.json`);
  // 再確認一次解析後仍在 SCENE_DIR 內，擋掉路徑穿越
  if (path.dirname(p) !== SCENE_DIR) throw new Error(`場景路徑不合法：${name}`);
  return p;
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 存檔直達磁碟（只在 dev server 生效）。
 * 沒有這層時，編輯器只能靠瀏覽器下載，企劃還要自己把檔案搬進專案。
 */
function levelEditorSavePlugin(): Plugin {
  return {
    name: 'level-editor-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/__api/')) return next();

        const parsed = new URL(url, 'http://localhost');
        const json = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(body));
        };

        try {
          // 讀遊戲場景檔：讓編輯器開檔時以「遊戲真正讀到的資料」為準
          if (parsed.pathname === '/__api/scene' && req.method === 'GET') {
            const file = sceneFilePath(parsed.searchParams.get('name') || 'default');
            if (!fs.existsSync(file)) return json(404, { ok: false, error: '場景檔不存在' });
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(fs.readFileSync(file, 'utf8'));
            return;
          }

          // 寫編輯器工作檔
          if (parsed.pathname === '/__api/save-level' && req.method === 'POST') {
            const text = await readBody(req);
            JSON.parse(text); // 壞 JSON 就不要落地
            fs.mkdirSync(path.dirname(WORK_FILE), { recursive: true });
            fs.writeFileSync(WORK_FILE, text, 'utf8');
            return json(200, { ok: true, path: path.relative(repoRoot, WORK_FILE) });
          }

          // 寫遊戲場景檔
          if (parsed.pathname === '/__api/save-scene' && req.method === 'POST') {
            const file = sceneFilePath(parsed.searchParams.get('name') || 'default');
            const text = await readBody(req);
            JSON.parse(text);
            fs.mkdirSync(SCENE_DIR, { recursive: true });
            fs.writeFileSync(file, text, 'utf8');
            return json(200, { ok: true, path: path.relative(repoRoot, file) });
          }
        } catch (e: any) {
          return json(500, { ok: false, error: String(e?.message || e) });
        }

        return json(404, { ok: false, error: 'unknown api' });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [levelEditorSavePlugin()],
  server: {
    fs: {
      // Allow serving files from parent directories (for level JSON)
      allow: ['..', '../..'],
    },
  },
  publicDir: './public/assets/data', // 關卡 JSON 放在 public/assets/data/levels/ 目錄
});
