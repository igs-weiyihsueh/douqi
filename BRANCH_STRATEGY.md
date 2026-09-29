# 🌳 分支部署策略 - douqi 專案

## 📋 分支架構總覽

```
🔄 開發流程     ├── main          # 開發主分支 (最新穩定版)
                ├── deploy_test   # 部署測試分支 (實驗性修復)
                ├── master        # 歷史主分支 (遊戲版本)
                └── master-deploy # 歷史部署分支
                
🚀 部署流程     └── gh-pages      # GitHub Pages 部署分支
```

## 🎯 分支用途定義

### **開發分支**

#### 📝 `main` - 開發主分支
- **用途**: 主要開發分支，最新穩定的功能版本
- **內容**: 完整的遊戲原始碼 + 編輯器功能
- **狀態**: ✅ 活躍使用
- **最新提交**: `16cc185` - 🔧 修復TypeScript錯誤

#### 🧪 `deploy_test` - 部署測試分支  
- **用途**: 實驗性修復和部署測試
- **內容**: 修復版本的遊戲代碼（關卡模式已移除）
- **狀態**: ✅ 當前活躍（用於修復）
- **最新提交**: `eebe6a1` - 📦 準備部署最新版本到gh-pages

#### 📚 `master` - 歷史主分支
- **用途**: 歷史版本，包含完整遊戲功能  
- **內容**: 遊戲本體 + 隱藏編輯器按鈕版本
- **狀態**: 🔒 穩定版本
- **最新提交**: `c557741` - 🚫 隱藏主菜單中的地形編輯器按鈕

#### 🗄️ `master-deploy` - 歷史部署分支
- **用途**: 舊版本的部署分支
- **狀態**: ❌ 不再使用

### **部署分支**  

#### 🌐 `gh-pages` - GitHub Pages 部署分支
- **用途**: **唯一的生產環境部署分支**
- **內容**: 構建後的靜態檔案（HTML + JS + Assets）
- **部署地址**: https://igs-weiyihsueh.github.io/douqi/
- **狀態**: ✅ 活躍部署
- **最新提交**: `7e2b4fd` - 🚀 部署最新修復版本

## 🔄 標準工作流程

### **開發階段**
```bash
# 1. 從 main 分支開始開發
git checkout main
git pull origin main

# 2. 創建功能分支（可選）
git checkout -b feature/your-feature

# 3. 開發完成後合併到 main
git checkout main  
git merge feature/your-feature
git push origin main
```

### **測試階段**
```bash
# 1. 合併到 deploy_test 進行部署測試
git checkout deploy_test
git merge main
git push origin deploy_test

# 2. 本地構建測試
npm run build
# 測試 dist/ 目錄內容
```

### **部署階段**
```bash
# 1. 構建最新版本
npm run build

# 2. 切換到 gh-pages 分支
git checkout gh-pages

# 3. 複製構建產物
cp -r dist/* .

# 4. 提交並推送
git add .
git commit -m "🚀 部署版本 v1.x.x"
git push origin gh-pages
```

## ⚠️ 重要注意事項

### **GitHub Pages 設定**
- **來源分支**: `gh-pages` 分支的根目錄
- **部署方式**: 手動部署（目前沒有 GitHub Actions）
- **更新時間**: 推送後 1-5 分鐘生效

### **分支保護**
- ✅ `gh-pages` - 僅包含構建產物，不包含原始碼
- ✅ `main` - 主要開發分支，應保持穩定
- ⚠️ `deploy_test` - 實驗性分支，可能包含不穩定代碼

### **檔案管理**
```
開發分支 (main/deploy_test/master):
├── src/                    # 原始碼
├── package.json           # 依賴設定
├── vite.config.ts        # 建置設定
└── 各種 .md 文檔

部署分支 (gh-pages):
├── index.html            # 遊戲入口
├── assets/               # 構建後的 JS/CSS
│   └── main-xxx.js      # 打包後的遊戲代碼
└── game.html            # 遊戲頁面
```

## 🎯 最佳實踐

### **部署前檢查清單**
- [ ] TypeScript 編譯無錯誤 (`npm run build`)
- [ ] 遊戲功能測試通過
- [ ] 確認移除了不需要的功能（如關卡模式）
- [ ] 構建產物大小合理（< 2MB）

### **緊急修復流程**  
```bash
# 1. 在 deploy_test 分支快速修復
git checkout deploy_test
# 修復代碼...
git commit -m "🚨 緊急修復: 問題描述"

# 2. 立即部署
npm run build
git checkout gh-pages  
cp -r dist/* .
git add . && git commit -m "🚨 緊急部署修復"
git push origin gh-pages

# 3. 稍後合併回 main
git checkout main
git merge deploy_test
```

## 📈 未來改進計劃

### **GitHub Actions 自動化**
```yaml
# 建議新增 .github/workflows/deploy.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [ main ]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci && npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

### **分支清理**
- 考慮移除 `master-deploy` 分支（已不使用）
- 統一 `main` 為主開發分支
- `deploy_test` 完成修復後可能合併到 `main`

---

**📅 文檔建立**: 2026-09-29  
**🔄 最後更新**: 2026-09-29  
**✍️ 維護者**: 翼騎-h5-t1545349337914282034
