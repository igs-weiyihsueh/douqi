# 3C大亂鬥 H5

《3C大亂鬥》的 H5 重寫版本 — 由原 Unity 專案改用 **Phaser 3 + TypeScript + Vite** 開發。

一款兒童街機抽獎／兌換機的 2D 動作遊戲。

## 🌐 線上版本

**正式版**: https://igs-weiyihsueh.github.io/douqi/

## 📋 分支架構

- **deploy_test** = 主開發分支（完整源碼 + 專案文檔）
- **deploy-pure** = 生產部署分支（GitHub Pages 用，純建置產物）  
- **master** = 暫時廢棄（存在系統性問題）

**所有開發工作都在 deploy_test 分支進行**

## 玩法

- **唯一操作**：右下角「攻擊」大按鈕（可點擊 / 觸控）或鍵盤 **空白鍵**。
- 按下攻擊 → 角色自動衝刺到「最近的怪」旁揮擊（鎖敵與位移全自動，玩家不需走位）。
- 每次命中累積 **鬥氣**（每擊 +10，上限 100）。
- 鬥氣集滿時按鈕與鬥氣條變金色提示。
- 鬥氣滿時攻擊 → 觸發 **爆發連招**：衝進敵群連打多段、範圍掃全場、大量傷害 + 擊退，結束後鬥氣歸零。
- 怪碰到角色會扣血；血量歸零 → 結算畫面（擊殺數 + 存活時間），可重新開始。
- 敵人從畫面四周持續生成、隨時間變密變多。

## 開發指令

**⚠️ 重要：必須在 deploy_test 分支進行所有開發工作**

```bash
git checkout deploy_test  # 切換到主開發分支
npm install               # 安裝相依套件
npm run build            # 型別檢查 + 產出 dist/
npm run preview          # 預覽 build 產物
npm run typecheck        # 只跑 tsc 型別檢查
```

**⚠️ 禁止執行的命令**（會導致實例卡住）：
```bash
# ❌ 這些命令會啟動持續運行的開發服務器
npm run dev
npm start
vite dev
yarn dev
pnpm dev
```

**正確的開發流程**：
1. 修改程式碼
2. `npm run build` 建置
3. 開啟 `dist/` 目錄中的檔案預覽
4. 或使用 `npm run preview` 預覽建置產物

## 專案結構

```
/mnt/d/3C/douqi/  (deploy_test 分支)
├── index.html              # HTML 進入點
├── package.json            # 相依套件與指令
├── tsconfig.json           # TypeScript 設定
├── vite.config.ts          # Vite 建置設定
├── CLAUDE.md               # 團隊協作規範
├── PROGRESS.md             # 開發進度記錄
├── README.md               # 專案說明（本檔案）
├── .kiro/                  # AgEnD 工具設定
├── public/                 # 靜態資源（直接複製到 dist）
│   └── assets/             # 遊戲資源
└── src/
    ├── main.ts             # 遊戲進入點（建立 Phaser.Game）
    ├── config/             # 全域設定常數
    ├── scenes/             # Phaser 場景
    ├── systems/            # 遊戲系統邏輯
    └── entities/           # 遊戲實體
```

## 技術版本

| 項目       | 版本      |
| ---------- | --------- |
| Phaser     | ^3.90.0   |
| TypeScript | ^5.6.3    |
| Vite       | ^6.0.3    |
| Node       | v22 (建議) |

## 開發規範

詳細的團隊協作規範請參考 [`CLAUDE.md`](CLAUDE.md)，包含：

- 🛡️ **安全規範** - 禁止執行的阻塞性命令
- 👥 **團隊分工** - 各成員角色與責任
- 🎯 **專案目標** - 當前開發重點
- 📞 **協作流程** - 任務分派與溝通原則

## 遊戲設計

這是一款從 Unity 移植到 H5 的 2D 動作遊戲，設計目標是兒童街機抽獎/兌換機遊戲。

具體的遊戲機制和數值設定請參考 `src/config/` 目錄中的設定檔案。

## 部署流程

### 當前部署架構
- **開發**: deploy_test 分支（完整專案）
- **生產**: deploy-pure 分支（純建置產物，自動部署到 GitHub Pages）

## 完整開發部署流程

### 📝 開發階段

```bash
# 1. 環境準備
git checkout deploy_test           # 切換到主開發分支
git pull origin deploy_test        # 同步最新代碼
npm install                        # 確保依賴已安裝

# 2. 開發新功能
# (編輯源碼...)

# 3. 建置和驗證
npm run typecheck                  # 型別檢查
npm run build                      # 建置專案

# 4. 檢查建置產物
ls -la dist/                       # 確認檔案生成
# 必須包含: index.html, assets/main-*.js, editor/, scenes/
du -sh dist/assets/*.js            # 檢查JS檔案大小 (約1.7MB)

# 5. 本地測試
npm run preview                    # 預覽建置產物
# 或直接開啟 dist/index.html 檢查功能

# 6. 提交代碼
git add .
git commit -m "🎮 [功能描述]"
git push origin deploy_test
```

### 🚀 部署階段

```bash
# 1. 準備部署
git checkout deploy-pure           # 切換到部署分支
git status                         # 確認乾淨的工作區

# 2. 從開發分支複製建置產物
# 方法A: 複製特定檔案
git checkout deploy_test -- assets/
git checkout deploy_test -- index.html

# 方法B: 重新建置 (如果需要)
git checkout deploy_test
npm run build
git checkout deploy-pure
cp -r ../path/to/deploy_test/dist/* .

# 3. 驗證部署內容
ls -la                             # 檢查檔案結構
# 應包含: index.html, assets/, editor/, scenes/
file assets/*.js                   # 檢查JS檔案類型
wc -c assets/*.js                  # 檢查檔案大小

# 4. 執行部署
git add .
git commit -m "🚀 部署 v[日期] - [更新內容]"
git push origin deploy-pure

# 5. 部署驗證
echo "部署已觸發，GitHub Pages 更新需要2-5分鐘"
echo "請在約5分鐘後檢查: https://igs-weiyihsueh.github.io/douqi/"
```

### 🔧 故障排除

```bash
# 部署回滾
git checkout deploy-pure
git log --oneline -10              # 查看歷史提交
git reset --hard [上個工作版本]    # 回滾到指定版本
git push --force origin deploy-pure

# 檢查部署狀態
curl -I https://igs-weiyihsueh.github.io/douqi/
# 檢查HTTP狀態碼和響應

# 清除GitHub Pages快取
# 在GitHub repo -> Settings -> Pages -> 重新選擇 deploy-pure 分支

# 緊急熱修復流程
git checkout deploy_test
# 快速修復關鍵問題...
npm run build
git add . && git commit -m "🚨 緊急修復: [問題描述]"
git push origin deploy_test
# 立即執行上述部署流程
```

### 📋 部署檢查清單

**建置前檢查**：
- [ ] 在 deploy_test 分支
- [ ] 代碼已提交並推送
- [ ] `npm run typecheck` 無錯誤
- [ ] `npm run build` 建置成功

**建置產物檢查**：
- [ ] `dist/index.html` 存在且大小正常 (~5KB)
- [ ] `dist/assets/main-*.js` 存在且大小約1.7MB
- [ ] `dist/editor/` 和 `dist/scenes/` 目錄存在

**部署前檢查**：
- [ ] 在 deploy-pure 分支
- [ ] 建置產物已正確複製
- [ ] 本地預覽功能正常

**部署後檢查**：
- [ ] GitHub Actions 部署成功
- [ ] 線上版本可以訪問
- [ ] 遊戲載入正常，無JavaScript錯誤
- [ ] 主要功能（關卡、UI、操作）正常工作
