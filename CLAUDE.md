# 地球宿舍 AI 團隊配置

## 🚀 **專案概況**
- **專案名稱**：鬥氣割草 (Douqi)
- **類型**：H5 網頁遊戲 (TypeScript + Phaser + Vite)
- **工作目錄**：`/mnt/d/3C/douqi`
- **版本控制**：Git + GitHub Actions 自動部署 (deploy-refactor)
- **部署分支**：deploy-refactor (主要開發分支)
- **CI/CD**：GitHub Actions (.github/workflows/deploy.yml)
- **架構**：根目錄扁平架構 (已修復CI路徑問題)

## 👥 **團隊成員**

### **異靈** (coordinator)
- **角色**：專案統籌、需求分析、任務分配
- **責任**：規劃優先級、協調團隊、品質把關

### **翼騎** (main developer + terrain editor)
- **角色**：主力開發、H5 遊戲程式開發
- **責任**：核心功能開發、編輯器移植、技術實現

### **征騎** (code review specialist)
- **角色**：代碼審查專家、品質把關
- **責任**：CODE REVIEW、代碼品質檢查、最佳實踐指導

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
1. **頭上UI系統開發** - 取代左側UI，實現角色上方浮動元素 🟢
   - ✅ 階段一：基礎架構 (編號牌系統)
   - ✅ 階段二：數據顯示 (Credit點數 + 二段能量條) - 征騎評級A-(90/100)
   - 🔄 階段三：COMBO獎勵系統 (準備開始)

### **技術棧**
- **前端**：TypeScript 5.4+ + Phaser + Vite 5.2+
- **架構**：根目錄扁平架構 (解決CI路徑解析問題)
- **部署**：GitHub Actions 自動化部署 (deploy-refactor 分支)

### **已完成**
- ✅ 專案架構重組 (2026-10-01)
- ✅ CI部署修復完成 (GitHub Actions + index.html修復)
- ✅ 遊戲系統移植 (完整功能)
- ✅ 檔案整合完成 (規格書、進度文檔統一到deploy-refactor)
- ✅ 部署流程驗證 (https://igs-weiyihsueh.github.io/douqi/)
- ✅ 進度追蹤機制 (CLAUDE.md + PROGRESS.md)
- ✅ 12個 AI 技能部署
- ✅ 頭上UI階段一：編號牌系統 (2026-10-01)
  - 移除舊左側UI系統 (144行代碼)
  - 建立overhead容器架構 (200×80px)
  - 實現彩色角色編號牌 (P1藍/BOT綠橙粉)
  - 修復位置追蹤和記憶體洩漏問題
- ✅ 頭上UI階段二：Credit顯示+能量條 (2026-10-01)
  - Credit點數系統：劍形圖標+五位數字+閃爍特效
  - 二段能量條移植：金色進度條+狀態色彩+脈動效果
  - UI重疊修復：垂直佈局優化(-25/+5/+35px)
  - 代碼品質重構：JSDoc註解+常數化+征騎評級A-(90/100)

## 📋 **程式碼規範**

### **CODING_STANDARDS.md強制遵守**
**檔案位置**: `/mnt/d/3C/douqi/CODING_STANDARDS.md`

**團隊職責**:
- **翼騎**: 按規範撰寫代碼 (JSDoc註解+禁止魔法數字+命名統一)
- **征騎**: 按規範審查代碼 (註解完整性+常數提取+結構清晰度)

**評分標準**:
- JSDoc註解完整性 (25%)
- 魔法數字提取 (20%) 
- 命名規範一致性 (15%)
- 程式碼結構清晰度 (15%)
- 複雜邏輯註解 (15%)
- TypeScript最佳實踐 (10%)

## 📞 **協作規範**

### **任務流程**
1. **異靈**：分析需求 → 分派任務
2. **執行者**：開發實現 → 測試驗證  
3. **征騎**：CODE REVIEW → 代碼品質檢查 (重點：代碼格式+註解品質)
4. **回報**：完成狀態 → 更新進度

### **開發部署流程**
1. **開發**：在 deploy-refactor 分支修改 TypeScript 源碼
2. **測試**：npm run build 本地驗證 (24 modules transformed)
3. **提交**：git add + commit + push origin deploy-refactor
4. **自動部署**：GitHub Actions 自動觸發 → build → 部署到 GitHub Pages
5. **驗證**：檢查 https://igs-weiyihsueh.github.io/douqi/ 更新狀態

**注意**：推送後 2-5 分鐘自動完成部署，無需手動干預。

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

*最後更新：2026-10-01*
*版本：v1.3.0* (階段二完成+代碼規範建立版本)
