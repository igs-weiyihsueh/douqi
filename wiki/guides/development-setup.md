# 開發環境設置指南

## 專案設置

### 基本需求
- Node.js (建議 v18+)
- npm 或 yarn 套件管理器
- Git 版本控制
- 現代瀏覽器 (支援WebGL)

### 專案結構
```
/mnt/d/3C/douqi/
├── src/                 # 源代碼
├── public/              # 靜態資源
├── wiki/                # 專案WIKI
├── config.ts            # 遊戲配置
├── main.ts              # 入口檔案
├── package.json         # 依賴管理
└── vite.config.ts       # 建構配置
```

## 安裝步驟

1. **克隆專案**
```bash
cd /mnt/d/3C/douqi
git checkout deploy-refactor
```

2. **安裝依賴**
```bash
npm install
```

3. **建構專案**  
```bash
npm run build
```

## 重要注意事項

### ⚠️ 禁止使用的命令
```bash
npm run dev    # 會阻塞終端，絕對禁止
vite           # 直接啟動會導致掛起
```

### ✅ 正確的開發流程
```bash
# 1. 修改代碼
# 2. 建構專案
npm run build

# 3. 靜態檔案會在 public/ 目錄，支援即時serve
```

## Git 工作流程

### 分支策略
- **主要開發分支**：`deploy-refactor`
- **功能開發**：從 deploy-refactor 建立功能分支
- **部署**：合併到 master 後推送到 GitHub Pages

### 提交規範
```bash
git add .
git commit -m "feat: 新增XX功能"
git push origin deploy-refactor
```

## 測試流程

### 建構測試
```bash
npm run build
# 檢查是否有TypeScript編譯錯誤
```

### 功能測試  
- 在瀏覽器中打開 `public/index.html`
- 測試遊戲基本功能
- 檢查控制台是否有錯誤

## 常見問題

**Q: npm run build 失敗怎麼辦？**
A: 檢查TypeScript編譯錯誤，修正後重新建構

**Q: 如何查看遊戲效果？**  
A: 執行 `npm run build` 後打開瀏覽器載入 `public/index.html`

**Q: 修改代碼後沒效果？**
A: 確保執行了 `npm run build` 重新編譯

**Q: WSL環境下HMR不工作？**
A: 這是已知限制，使用 `public/` 靜態檔案即時serve即可

---
*創建日期：2026-10-07*  
*維護者：3C團隊*
