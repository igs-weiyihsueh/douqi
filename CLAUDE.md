# 地球宿舍 AI 團隊配置

## 🚀 **專案概況**
- **專案名稱**：3C大亂鬥 (3C鬥氣割草 H5版)
- **類型**：H5 網頁遊戲 (TypeScript + Phaser + Vite)
- **工作目錄**：`/mnt/d/3C/douqi`
- **版本控制**：Git + GitHub Pages 部署

## 📋 **分支架構**
- **deploy_test** = 主開發分支（完整功能 + 專案文檔）
- **deploy-pure** = 生產部署分支（GitHub Pages 用，純建置產物）
- **master** = 暫時廢棄（存在系統性問題）

**當前線上版本**: https://igs-weiyihsueh.github.io/douqi/ (deploy-pure 分支)

## 👥 **團隊成員**

### **異靈** (coordinator)
- **角色**：專案統籌、需求分析、任務分配
- **責任**：規劃優先級、協調團隊、品質把關

### **翼騎** (main developer + terrain editor)
- **角色**：主力開發、H5 遊戲程式開發
- **責任**：核心功能開發、編輯器移植、技術實現

### **征騎** (副手開發·槽環)
- **角色**：副手開發、測試調試
- **責任**：輔助開發、bug 修復、品質測試

### **零式** (numerical designer)
- **角色**：數值設計、遊戲平衡
- **責任**：遊戲數值、平衡調整、配置優化

### **陀螺-leader** (project consultant)
- **角色**：專案顾問、SpinningTop 經驗分享
- **責任**：技術諮詢、最佳實踐指導

## 🛡️ **核心安全規範**

### ⚠️ **嚴禁執行的命令**

**以下命令會導致實例卡住，絕對禁止執行**：

```bash
# ❌ 開發服務器 (會持續運行不退出)
npm run dev
npm start
vite
vite dev
yarn dev
```

### 🔍 **部署安全規範**

**每次部署前必須執行的安全檢查**：

1. **JS 引用一致性檢查**
   ```bash
   # 檢查 HTML 中的所有 JS 引用
   grep -n "main-.*\.js" index.html
   
   # 確認實際檔案存在
   ls assets/main-*.js
   
   # 驗證引用與實際檔案一致
   ```

2. **雙重引用防護**
   - index.html 不得同時引用多個不同的 main-*.js
   - 靜態 script 標籤與動態載入必須使用相同檔名
   - 部署前必須統一所有引用

3. **建置產物驗證**
   ```bash
   # 檢查檔案大小合理性 (約1.6-1.8MB)
   du -sh assets/main-*.js
   
   # 檢查檔案完整性
   file assets/main-*.js  # 應為 ASCII text
   ```

4. **回滾準備**
   - 每次部署前記錄當前 commit hash
   - 確認上一個穩定版本的位置
   - 測試失敗時立即回滾，不要嘗試多次修復

**違反安全規範的後果**：
- ❌ JS 檔案 404 錯誤
- ❌ 遊戲無法載入
- ❌ 用戶體驗中斷
- ❌ 緊急修復成本高
pnpm dev

# ❌ 其他阻塞性命令
webpack-dev-server
live-server
http-server
```

**技術原因**：
- 這些命令會啟動持續運行的開發服務器
- 佔用 tmux 會話，導致 AgEnD 實例無法響應新任務
- 狀態會變成 "stuck"，需要手動中斷

**替代方案**：
```bash
# ✅ 使用建置命令 (一次性執行)
npm run build
npm run test
npm run lint
```

### 📋 **強制啟動檢查**

每次啟動/重啟時**必須**：

1. **讀取本檔案** - 確認最新規範和角色定義
2. **檢查 PROGRESS.md** - 了解當前專案狀態
3. **確認工作目錄** - 確保在 `/mnt/d/3C/douqi`
4. **查看最新任務** - 從進度檔案獲取當前任務
5. **遵守安全規範** - 絕不執行禁止的阻塞命令

## 🎯 **專案重點**

### **當前目標**
1. **H5 遊戲系統完善** - 基於 Phaser 引擎的完整遊戲功能
2. **關卡與UI系統** - 關卡選擇、背景系統、遊戲循環
3. **穩定部署流程** - deploy_test → deploy-pure 同步機制

## 🛠️ **開發工作流程**

### **主要分支使用**
1. **deploy_test** - 主開發分支
   - 包含完整源碼和專案文檔
   - 所有開發工作都在此進行
   - 功能測試和驗證

2. **deploy-pure** - 生產部署分支
   - 只包含建置產物 (index.html + assets/)
   - 用於 GitHub Pages 部署
   - 從 deploy_test 同步更新

### **開發流程**
```bash
# 1. 在 deploy_test 分支開發
git checkout deploy_test
# 開發新功能...
npm run build  # 建置測試

# 2. 功能完成後同步到 deploy-pure
git checkout deploy-pure
# 複製 deploy_test 的建置產物...
git push origin deploy-pure  # 部署到線上
```

## 🚀 **完整開發部署工作流程**

### **第一階段：開發與測試**
```bash
# 1. 確保在正確的分支
git checkout deploy_test
git pull origin deploy_test

# 2. 開發新功能
# (編輯程式碼...)

# 3. 建置和測試
npm run build
npm run typecheck  # 型別檢查

# 4. 檢查建置產物
ls -la dist/  # 確認檔案生成
# 檢查主要檔案：index.html, assets/*.js

# 5. 本地驗證
# 開啟 dist/index.html 或使用 npm run preview

# 6. 提交變更
git add .
git commit -m "🎮 新功能: [描述]"
git push origin deploy_test
```

### **第二階段：生產部署**

**⚠️ 部署安全檢查清單 - 必須逐項確認**

#### **部署前檢查 (Pre-Deploy)**
```bash
# 1. 切換到部署分支
git checkout deploy-pure

# 2. 檢查當前 JS 檔案引用
grep -n "main-.*\.js" index.html  # 必須檢查所有 JS 引用
grep -n "assets/main" index.html   # 包含動態載入的引用

# 3. 記錄當前引用的檔名
echo "當前 index.html 引用的 JS 檔："
grep -o "main-[^.]*\.js" index.html | sort | uniq

# 4. 從 deploy_test 複製建置產物
git checkout deploy_test
npm run build  # 確保是最新建置
ls -la dist/assets/main-*.js  # 記錄實際檔名

# 5. 檢查檔名一致性
echo "實際檔案名稱："
ls dist/assets/main-*.js | head -1
```

#### **檔案同步 (File Sync)**
```bash
# 6. 切回 deploy-pure 並同步
git checkout deploy-pure

# 7. 複製建置產物
cp -r ../temp_deploy_test/dist/assets/* assets/ 2>/dev/null || (
  git checkout deploy_test -- assets/ &&
  cp assets/* ../temp_assets/ &&
  git checkout deploy-pure &&
  cp ../temp_assets/* assets/
)

# 8. 更新 index.html 中的所有 JS 引用
NEW_JS=$(ls assets/main-*.js | head -1 | sed 's|assets/||')
echo "新的 JS 檔名: $NEW_JS"

# 手動檢查並更新所有引用
sed -i "s|main-[^.]*.js|$NEW_JS|g" index.html
```

#### **部署後驗證 (Post-Deploy Verification)**
```bash
# 9. 最終檢查
echo "=== 最終檢查 ==="
echo "實際 JS 檔案:"
ls -la assets/main-*.js

echo "index.html 引用:"
grep -n "main-.*\.js" index.html

echo "引用一致性檢查:"
JS_FILE=$(ls assets/main-*.js | head -1 | sed 's|assets/||')
if grep -q "$JS_FILE" index.html; then
  echo "✅ 檔案引用一致"
else
  echo "❌ 檔案引用不一致！停止部署！"
  exit 1
fi

# 10. 提交並部署
git add .
git commit -m "🚀 部署: [版本描述] (JS: $JS_FILE)"
git push origin deploy-pure
```

# 3. 檢查部署檔案完整性
echo "=== 檔案完整性檢查 ==="
ls -la  # 確認: index.html, assets/, editor/, scenes/
du -sh assets/*.js  # 檢查JS檔案大小 (應該約1.7MB)

echo "=== JS 引用最終確認 ==="
echo "HTML 引用的檔案:"
grep -o "main-[^.]*\.js" index.html

echo "實際存在的檔案:"
ls assets/main-*.js | xargs basename

# 4. 部署安全驗證
if [ $(grep -o "main-[^.]*\.js" index.html | sort | uniq | wc -l) -gt 1 ]; then
  echo "❌ 警告：index.html 引用多個不同的 JS 檔案！"
  echo "請檢查並統一引用"
  exit 1
fi

# 5. 提交並部署
git add .
git commit -m "🚀 部署: [版本描述]"
git push origin deploy-pure  # 觸發 GitHub Pages 自動部署

# 6. 部署後驗證 (約2-5分鐘後)
echo "🌐 部署完成，請在 2-5 分鐘後檢查："
echo "URL: https://igs-weiyihsueh.github.io/douqi/"
echo "檢查項目：遊戲載入、場景切換、功能正常"
```

### **第三階段：故障排除**

#### **常見部署問題**

**1. JS 檔案缺失 (404錯誤)**
```bash
# 症狀：瀏覽器控制台顯示 main-XXX.js 404
# 原因：index.html 引用的檔名與實際檔案不符

# 診斷
grep -o "main-[^.]*\.js" index.html  # 查看引用的檔名
ls assets/main-*.js                  # 查看實際檔案

# 修復
NEW_JS=$(ls assets/main-*.js | head -1 | sed 's|assets/||')
sed -i "s|main-[^.]*.js|$NEW_JS|g" index.html
git add . && git commit -m "🔧 修復JS檔案路徑"
git push origin deploy-pure
```

**2. 雙重引用不一致**
```bash
# 症狀：index.html 中有多處不同的 JS 檔案引用
# 原因：靜態引用和動態載入使用不同檔名

# 診斷
grep -n "main-.*\.js" index.html  # 找出所有引用位置

# 修復：統一為同一個檔案
TARGET_JS="main-CbaDQGVi.js"  # 使用最新的檔案
sed -i "s|main-[^.]*.js|$TARGET_JS|g" index.html
```

**3. 緊急回滾**
```bash
# 回滾到上一個工作版本
git checkout deploy-pure
git log --oneline -5  # 查看最近提交
git reset --hard [上一個工作的commit]  # 回滾
git push --force origin deploy-pure  # 強制推送回滾
```

**4. 緊急修復流程**
```bash
git checkout deploy_test
# 快速修復...
npm run build
git add . && git commit -m "🔧 緊急修復"
git push origin deploy_test
# 然後重複第二階段部署流程（包含安全檢查）
```

### **強制啟動檢查**

每次啟動/重啟時**必須**：

1. **讀取本檔案** - 確認最新規範和角色定義
2. **檢查 PROGRESS.md** - 了解當前專案狀態
3. **確認工作目錄** - 確保在 `/mnt/d/3C/douqi`
4. **切換到 deploy_test** - 主開發分支
5. **遵守安全規範** - 絕不執行禁止的阻塞命令

## 📞 **協作規範**

### **任務流程**
1. **異靈**：分析需求 → 分派任務
2. **執行者**：開發實現 → 測試驗證  
3. **征騎**：品質檢查 → bug 修復
4. **回報**：完成狀態 → 更新進度

### **溝通原則**
- **直接有效**：避免冗長確認，直接執行
- **狀態透明**：及時更新 PROGRESS.md
- **問題反饋**：遇到阻塞立即提出

## 🚨 **緊急情況處理**

### **實例卡住 (stuck)**
1. 用戶執行 `/clear` 或 Ctrl+C 中斷
2. 重啟後立即讀取本檔案
3. 從 PROGRESS.md 恢復工作狀態
4. 繼續執行中斷的任務

### **規則違反**
- 執行禁止命令 → 立即停止，重申規範
- 忽視安全規則 → 團隊提醒，加強監督

---

**⚡ 此檔案為地球宿舍專案的核心配置，所有 AI 成員必須嚴格遵守！**

*最後更新：2026-09-24*
*版本：v1.0.0*
