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

### 部署步驟
```bash
# 1. 在 deploy_test 分支開發和測試
git checkout deploy_test
# ... 開發工作 ...
npm run build

# 2. 將建置產物同步到 deploy-pure 分支
git checkout deploy-pure
# 複製 deploy_test 分支的建置產物到 deploy-pure
# （具體同步流程由團隊統一執行）

# 3. 推送 deploy-pure 觸發自動部署
git push origin deploy-pure
```

**注意**: deploy-pure 分支只包含建置產物，不包含源碼。所有開發都在 deploy_test 進行。
