# WIKI維護操作記錄

> 這是鬥氣割草專案WIKI的維護日誌，記錄所有文檔變更和維護活動。
> 格式規範請參考：wiki-maintenance SKILL的templates/log-format.md

---

## [2026-10-07 16:27] 開發完成 | 二段能量條強化 + 移除能量球
**變更摘要**：翼騎完成UIScene頭上UI能量條二段強化（尺寸擴大、特效增強、bug修正）+ 移除擊殺能量球演出系統
**影響頁面**：wiki/systems/ui-implementation.md（頭上UI能量條段落需更新尺寸、提示文字、特效、EnergyUIElements型別；若有能量球orb相關內容需刪除）
**代碼位置**：commit 2f54bbf (deploy-refactor分支)
**銳騎審查**：97/100分通過
**開發詳情**：
- 能量條尺寸100×8→140×14，外框2px，提示改為「按Z變身」移到右方
- 修正bug：集滿時右側殘留黑格（進度條起點和寬度計算問題）
- 新增集滿特效：外發光脈動、掃光、外框金白交替
- 集滿判定改用energyTrigger門檻（150）
- 程式結構：能量條元件收斂為EnergyUIElements型別，版面特效數值集中在OVERHEAD_UI_CONFIG.ENERGY
- 完全移除能量球系統：config.energy.orb、spawnEnergyOrb、energyOrbCount等4處呼叫
**查重結果**：無重複內容，為新功能開發
**下次提醒**：威騎需更新wiki/systems/ui-implementation.md對應段落；用戶需實玩確認能量條尺寸、光暈強度、掃光速度

## [2026-10-07 16:16] 開發完成 | 翼騎完成3項重大功能改進
**變更摘要**：鏡頭跟隨空間擴大、關卡模式地圖邊界重定義、F4美術模式修正
**影響頁面**：[systems/camera-system.md] (需新建), [systems/scene-boundaries.md] (需更新), [design/visual-modes.md] (需更新)
**代碼位置**：
- 鏡頭系統: deadzone 540×600→320×180, setScrollFactor修正
- 地圖邊界: sceneMarginX/Top/Bottom重定義, 可移動區2520×840
- F4美術: 敵人外觀預設改紅圓, 同步切換機制
**Commit記錄**：7975cc9, b62d292, 2decdde, 66e51cb (已push到deploy-refactor)
**審查結果**：銳騎review通過 (98/100, 94/100, 96/100分)
**下次提醒**：
- 需建立camera-system技術文檔
- 需更新scene-boundaries配置說明  
- 待用戶實玩確認鏡頭手感和怪物密度
- 可能需要零式評估移動區變形後的數值平衡

## [2026-10-07 15:05] 初始化 | WIKI系統建立完成
**變更摘要**：建立完整的WIKI基礎架構，包括目錄結構和核心文檔
**影響頁面**：[README.md] (新建), [systems/project-overview.md] (新建), [conventions/h5-coding-standards.md] (新建), [decisions/team-structure.md] (新建), [guides/development-setup.md] (新建)
**代碼位置**：/mnt/d/3C/douqi/wiki/ (整個目錄結構)
**查重結果**：基於現有CLAUDE.md和soul.md內容整理，移除了CODING_STANDARDS.md重複內容
**下次提醒**：
- 等待文騎instance配置wiki-maintenance SKILL
- 需要建立architecture/目錄的技術架構文檔
- 考慮建立design/目錄記錄遊戲設計演進

---

## 維護者交接區

### 當前狀態
- ✅ **WIKI基礎架構完成** - 目錄結構和核心文檔已建立
- ✅ **文騎instance就位** - 專職維護者已創建
- 🎯 **進行中** - wiki-maintenance SKILL建立中
- ⏳ **待完成** - 檢查工具部署和自動化機制

### 重要提醒
- WIKI與專案代碼同步版控在 deploy-refactor 分支
- 所有變更都要記錄在此log.md檔案
- 維護三層架構：知識頁面(可編輯) + 專案記憶(參考) + 操作日誌(append-only)

### 下次開工檢查清單
1. 檢查此log.md最新記錄
2. 執行基礎連結和格式檢查  
3. 確認是否有代碼變更需要同步到文檔
4. 處理任何「下次提醒」中的待辦項目

---

## [2026-10-07 15:25] 維護者交接 | 文騎接手WIKI維護工作
**變更摘要**：文騎實例接手WIKI維護職責，已設定display_name並確認工作範圍
**影響頁面**：[log.md] (更新)
**代碼位置**：/mnt/d/3C/douqi/wiki/ (整個維護範圍)
**查重結果**：確認當前WIKI結構完整，包含systems/, conventions/, decisions/, guides/目錄
**下次提醒**：
- 執行第一次完整的連結和格式檢查
- 確認architecture/和design/目錄是否需要內容填充
- 建立定期維護的排程機制

---

## [2026-10-07 15:45] 內容初始化 | WIKI第三階段：系統性內容擴充完成
**變更摘要**：基於soul.md巨大知識庫，系統性填充各目錄技術文檔，避免與CLAUDE.md重複
**影響頁面**：
- [architecture/game-engine.md] (新建) - 遊戲引擎架構
- [architecture/data-flow.md] (新建) - 資料流程與系統關係  
- [architecture/phaser-typescript.md] (新建) - Phaser + TypeScript技術架構
- [design/gameplay-evolution.md] (新建) - 遊戲功能設計演進
- [design/ui-ux-decisions.md] (新建) - UI/UX設計決策
- [design/minigame-system.md] (新建) - 小遊戲系統設計
- [systems/combat-system.md] (新建) - 戰鬥系統技術文檔
- [systems/ui-implementation.md] (新建) - UI系統實作細節
- [systems/performance-config.md] (新建) - 效能和配置管理
- [decisions/technical-choices.md] (新建) - 技術選擇和原因
- [decisions/architecture-evolution.md] (新建) - 架構決策演進  
- [decisions/problem-solving.md] (新建) - 問題解決記錄
**代碼位置**：soul.md:1-300行 (主要參考來源)，CLAUDE.md:1-50行 (避免重複檢查)
**查重結果**：成功避開CLAUDE.md中的角色定義、流程規範等內容，專注技術實作與設計決策
**下次提醒**：
- 執行第一次完整的內部連結檢查
- 驗證技術文檔與實際代碼的同步性
- 建立文檔更新機制，確保與代碼變更同步

---

## [2026-10-07 15:50] 重建完成 | 基於程式碼的WIKI內容重建
**變更摘要**：用戶要求完全重做，刪除基於soul.md的文檔，改為掃描真實程式碼建立準確文檔
**影響頁面**：
- 刪除: 所有基於soul.md建立的12個文檔
- 重建: [architecture/game-engine.md] (新建) - 基於main.ts, config.ts真實架構
- 重建: [architecture/data-flow.md] (新建) - 基於GameScene.ts, Character.ts真實數據流
- 重建: [architecture/phaser-typescript.md] (新建) - 基於vite.config.ts, tsconfig.json真實配置
- 重建: [design/gameplay-evolution.md] (新建) - 基於TitleScene.ts, CollectRaceScene.ts真實遊戲設計
- 重建: [design/ui-ux-decisions.md] (新建) - 基於UIScene.ts真實UI實作
- 重建: [design/minigame-system.md] (新建) - 基於minigames/registry.ts真實框架
- 重建: [systems/combat-system.md] (新建) - 基於systems/waveMath.ts真實戰鬥邏輯
- 重建: [systems/ui-implementation.md] (新建) - 基於UIScene.ts真實UI系統
- 重建: [systems/performance-config.md] (新建) - 基於config.ts真實效能配置
- 重建: [decisions/technical-choices.md] (新建) - 基於package.json真實技術選擇
**代碼位置**：/mnt/d/3C/douqi/src/ (完整程式碼掃描)，main.ts, config.ts, package.json (核心配置)
**查重結果**：完全基於真實程式碼建立，避免與CLAUDE.md衝突，確保技術文檔準確性
**下次提醒**：
- 驗證文檔內容與實際代碼的一致性  
- 檢查所有檔案路徑和程式碼引用的準確性
- 建立程式碼變更同步文檔的機制

---

## [2026-10-07 15:52] 術語表建立 | 專案核心概念統一化
**變更摘要**：建立專案術語表，統一核心概念和程式碼對照，便於開發團隊和AI理解專案架構
**影響頁面**：
- [glossary.md] (新建) - 專案術語表，涵蓋角色、敵人、場景、波次、配置、UI、小遊戲、物理、技術架構等9大系統
- [README.md] (更新) - 添加術語表連結
**代碼位置**：Character.ts:16-92 (角色系統), Enemy.ts:4-150 (敵人系統), scenes/*.ts (場景系統), config.ts (配置系統)
**查重結果**：基於真實程式碼位置建立術語對照，每個術語都有精確的檔案和行號引用
**下次提醒**：
- 隨程式碼更新同步維護術語表
- 考慮建立術語表的自動化檢查機制  
- 新增術語時要同時更新相關文檔的交叉引用

---

## [2026-10-07 16:08] WIKI同步更新 | 鏡頭跟隨與地圖邊界重新定義
**變更摘要**：翼騎通知三個commit (7975cc9, b62d292, 2decdde) 已合併，WIKI需要同步更新以反映最新架構變更
**影響頁面**：
- [design/ui-ux-decisions.md] (更新) - 移除邊界編輯器，新增鏡頭跟隨系統說明
- [systems/ui-implementation.md] (更新) - 移除邊界編輯器實作，保留zoom編輯器
- [systems/combat-system.md] (更新) - 修正F4切換實際方法名稱
- [design/gameplay-evolution.md] (更新) - 更新鏡頭系統和關卡制架構
- [decisions/architecture-evolution.md] (新建) - 鏡頭跟隨空間擴大與地圖邊界重新定義ADR
- [glossary.md] (更新) - 新增stage配置、鏡頭相關術語
**代碼位置**：
- commit 7975cc9: 鏡頭跟隨 (deadzone 540×600→320×180, lerp X:0.08/Y:0.04)
- commit 2decdde: 地圖邊界 (arenaW/H 1920×1080→2520×840, 移除邊界編輯器)
- commit b62d292: sceneBackgrounds JSDoc註解
**查重結果**：所有更新都基於翼騎提供的實際commit內容，確保與最新程式碼一致
**下次提醒**：
- 定期檢查是否有新commit需要同步到WIKI
- 建立commit訊息與WIKI更新的流程機制
- 考慮自動化detect程式碼變更影響文檔的工具

---

## [2026-10-07 16:16] WIKI小幅同步 | F4敵人外觀預設值與重開狀態修正
**變更摘要**：翼騎通知commit 66e51cb已合併，需要同步F4敵人外觀預設值變更和UIScene重開狀態修正
**影響頁面**：
- [design/ui-ux-decisions.md] (更新) - useSkeletonWarrior預設值 true→false
- [design/gameplay-evolution.md] (更新) - useSkeletonWarrior預設值修正，補充F4首次切換說明
- [systems/ui-implementation.md] (更新) - 補充重開狀態重置說明
- [log.md] (更新) - 維護記錄
**代碼位置**：
- commit 66e51cb: useSkeletonWarrior預設false，UIScene.create()重置isP1HeadUIHidden
- 清理除錯log，移除未使用變數isBottomPanelOverlayMode
**查重結果**：基於翼騎提供的commit詳情，確保文檔與程式碼一致性
**下次提醒**：
- 持續關注commit通知，及時同步WIKI
- F4相關功能變更需要特別注意多處文檔同步
