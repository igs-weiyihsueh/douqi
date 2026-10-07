# WIKI維護操作記錄

> 這是鬥氣割草專案WIKI的維護日誌，記錄所有文檔變更和維護活動。
> 格式規範請參考：wiki-maintenance SKILL的templates/log-format.md

---

## [2026-10-07 19:30] 開發完成 | HUD地圖式進度改版 (05dafae)
**變更摘要**：卷軸HUD改為地圖式進度設計 - 最左位置標記+右側4寶箱，量條往下一個寶箱前進
**影響頁面**：
- [systems/stage-system.md] (更新) - HUD視覺渲染系統+配置參數更新
- [glossary.md] (更新) - 新增markerColor、markerDotScale、drawStageMarker術語
**代碼位置**：commit 05dafae (deploy-refactor分支)
**設計理念**：
- **位置標記**：最左綠色標記表示當前位置(不畫寶箱)
- **4個寶箱**：右邊依序排列接下來4關獎勵，第1個脈動高亮=本關獎勵
- **進度量條**：位置標記→第1個寶箱，填滿即獲得該寶箱  
- **動態遞補**：獲得後全體左移一格，舊位置標記淡出，剛獲得寶箱轉為新位置標記，最右新寶箱淡入
**技術實作**：
- 新增drawStageMarker函式(UIScene.ts:858)：不透明底盤+實心亮點+脈動外環
- config.waveHud新增markerColor(0x7affc0綠色)、markerDotScale(0.45倍縮放)  
- 更新drawStageHud渲染邏輯：xAt位置計算+遞補動畫+進度量條填充
**視覺強化**：位置標記脈動外環、第1個寶箱脈動高亮、量條填充動畫、遞補左移效果
**查重結果**：HUD視覺系統重構，地圖式進度全新設計
**下次提醒**：威騎已更新WIKI文檔同步，零式可評估地圖式進度的使用者體驗

## [2026-10-07 19:25] 開發完成 | 新關卡系統重大改版上線 (874b8f9)
**變更摘要**：新關卡系統完成並成功上線 - 從8關波次制改為無限小關卡循環+4圓點卷軸HUD+階級化轉場+荒城↔火山交替
**影響頁面**：
- [systems/stage-system.md] (新建) - 完整的新關卡系統技術文檔
- [design/gameplay-evolution.md] (更新) - 關卡系統設計章節重寫  
- [systems/ui-implementation.md] (更新) - 新增卷軸HUD系統+關卡獎勵特效
- [glossary.md] (更新) - 新增stageCycle、chestTickets、areaVariant、dirLock、waveHud術語
**代碼位置**：commits 15b5ce6~874b8f9 (deploy-refactor分支)
**系統架構**：
1. **核心機制**：4關循環(20/25/30/35擊殺→低/低/低/高階寶箱)，無限遞增關卡編號
2. **進度HUD**：4圓點卷軸，遞補動畫，脈動外框，高階金色光暈，進度條填充  
3. **轉場系統**：低階左右平移不回頭+高階上方閃黑，無限延伸世界
4. **場景變體**：荒城↔火山交替，三格slot重構機制
5. **獎勵機制**：直接發彩票(低階5張/高階30張)，面板位置特效
**移除內容**：森林/洞窟主題、BOSS關、事件輪替、8關限制、關卡橫幅自動顯示
**保留系統**：BOSS/事件本體供經典模式使用，除錯預覽功能
**技術細節**：翼騎提供完整行號對照(HEAD:6ebc151)，UIScene行號可能因HUD常數化(49b634d)略有差異
**開發階段**：
- 15b5ce6: 階段1 - 無限小關卡+4圓點HUD+直接發彩票
- 62edfc5: 階段3 - 階級化轉場+世界無限延伸+荒城↔火山交替  
- 936a60f~babca0a: 森林/洞窟清理4步驟
- 874b8f9: 驗收修正 - 走廊碎石細節移除+totalLevels註解更正
**查重結果**：遊戲核心機制重大重構，全新系統架構
**下次提醒**：威騎已完成WIKI文檔更新，零式需評估新關卡循環的數值平衡和遊戲節奏

## [2026-10-07 18:21] 開發完成 | 完整移除舊團隊等級系統（大幅簡化）
**變更摘要**：翼騎+征騎協作完成舊團隊等級/經驗系統的完整移除（teamLevel固定滿等10，levelLerp改基準值，所有數值行為不變但代碼大幅簡化）
**影響頁面**：wiki/glossary.md（level相關術語）；wiki/systems/combat-system.md（招式解鎖段落，現在全部開始可用）；wiki/architecture/phaser-typescript.md（config架構說明移除config.level區塊）
**代碼位置**：commits 362fdbd, bf510fe (deploy-refactor分支 9adb64a..bf510fe)
**銳騎審查**：96/100分通過
**開發詳情**：
- 征騎(362fdbd主體)：levelLerp全改基準值；刪除5個只會回傳1的倍率函式（curSkillDamageScale/curEnemyHpScale等）+約30處呼叫；刪除unlockLevel判斷；刪除teamLevel/teamExp/expToNext/maxLevelCheat+L鍵；刪除stats的level/comboUnlocked欄位；刪除config.level整個區塊、levelLerp、combo/energy.unlockLevel、rewards.expKills
- 翼騎(bf510fe補遺漏)：刪除空殼grantKillExp/debugGrantExp、廢棄enemy.unlockByLevel，修正9處過時註解
**系統簡化**：淨變動約-190行代碼，招式現在開始就全部可用無解鎖概念
**重要區別**：⚠️不要和「關卡level」（第1-8關currentLevel）搞混，關卡系統沒有變
**查重結果**：系統簡化重構，無重複內容
**下次提醒**：威騎需更新所有提到等級成長、Lv解鎖招式、團隊經驗、L鍵除錯的WIKI文檔

## [2026-10-07 17:53] 開發完成 | 爆發改為變身專屬招式（重大系統改版）
**變更摘要**：翼騎完成「爆發亂打改為二段變身專屬招式」重大改版（變身AOE命中計數、每4下觸發爆發、慢速COMBO門檻調整4/8、爆發期間暫停能量倒退）
**影響頁面**：wiki/systems/combat-system.md（慢速combo門檻4/8、爆發改為變身專屬每4次AOE命中、爆發期間暫停能量倒退）；wiki/architecture/phaser-typescript.md（config新增combo.slowThresholds、combo.empower.burstEveryAoeHits）
**代碼位置**：commit 9adb64a (deploy-refactor分支 d02849c..9adb64a)
**銳騎審查**：95/100分通過，build通過
**實作對照規格**：
1. **變身AOE命中計數**：empowerAoeBurst打中≥1隻時呼叫registerEmpowerAoeHit，Character.empowerAoeHits每次變身開始歸零
2. **每4下觸發爆發**：empowerAoeHits % combo.empower.burstEveryAoeHits(4) === 0觸發triggerBurst，可重複；爆發中不累計（isBursting提早return）
3. **COMBO系統調整**：快速模式完全不動；慢速改用combo.slowThresholds（4圓/8直），爆發移出combo循環，slowComboCap改為直線（8）
4. **變身時間延長**：能量倒退在角色爆發演出中（isBursting或skillLockUntil約2秒）暫停，等於延長爆發演出長度的變身時間
**系統影響**：慢速模式BOT不會變身所以沒有爆發（符合變身專屬規格）；保留團隊Lv6解鎖爆發限制
**建議評估**：零式需評估慢速模式節奏和數值（爆發頻率、變身持續時間）
**查重結果**：戰鬥系統重大重構，無重複內容  
**下次提醒**：威騎需更新戰鬥/連段技相關文檔；零式需評估慢速模式數值平衡；用戶需確認是否保留Lv6解鎖限制

## [2026-10-07 17:48] 開發完成 | COMBO獎勵規則調整 + 視覺強化
**變更摘要**：翼騎+征騎協作完成COMBO獎勵系統重大改版（計數規則改為命中制、新增100連擊里程碑、報獎特效重構到面板位置、視覺放大強化）
**影響頁面**：wiki/systems/ui-implementation.md（COMBO報獎特效位置、文字尺寸）；wiki/systems/combat-system.md（計數規則、里程碑[5,10,20,50,100]/[1,3,10,50,100]、100立即發獎）
**代碼位置**：commits 7f5496e, 06048cb, d02849c (deploy-refactor分支 92d636a..d02849c)
**銳騎審查**：94/100分通過
**開發詳情**：
- 翼騎(7f5496e)：COMBO計數改為「每次出手命中≥1隻+1」（普攻、衝刺、連段技、變身AOE都算，爆發整招只算1下）；移除普攻擊殺額外+1；新增100連擊里程碑立即發獎；程式重構grantComboReward/resetComboStreak；報獎特效重構到UIScene.playComboRewardFx面板位置
- 征騎(06048cb)：視覺放大強化（HIT文字24→36px、報獎文字28→42px、彩票20×12→30×18、閃光半徑8/60→12/90），寫死數字改成常數
- 翼騎(d02849c)：整合完成
**系統影響**：出票規則重大調整，建議零式評估數值平衡
**功能改善**：計數更直觀（命中制）、100連擊新挑戰、報獎特效位置更合理、視覺效果更突出
**查重結果**：獎勵系統重構，無重複內容
**下次提醒**：威騎需更新wiki相關COMBO系統文檔；零式需評估新出票規則的數值平衡；用戶需實玩確認面板報獎特效位置

## [2026-10-07 16:53] 開發完成 | COMBO移到下方面板 + 新分工測試
**變更摘要**：翼騎+征騎協作完成COMBO UI重構（從頭上移到下方面板右上角）+ 首次測試新分工模式（翼騎開發、征騎清理）
**影響頁面**：wiki/systems/ui-implementation.md（頭上UI段落需更新為「編號牌+Credit+能量條」兩層；下方面板段落需補上COMBO顯示說明）
**代碼位置**：commits 299e88b, a62f8c3, 92d636a (deploy-refactor分支 63ca142..92d636a)
**銳騎審查**：93/100分通過
**開發詳情**：
- 翼騎(299e88b)：新增panelComboTexts系統，支援原版色塊+F4面板圖雙模式，4角色獨立顯示
- 征騎(a62f8c3)：清理頭上舊COMBO系統（createComboUI、updateComboDisplay、OVERHEAD_UI_CONFIG.COMBO等）+ 移除約25行除錯log
- 翼騎(92d636a)：修正征騎清理時誤刪大括號造成的建置失敗
**功能改善**：F4模式下P1也能看到COMBO（原本頭上UI被隱藏），COMBO計數規則不變
**新分工測試**：首次實測翼騎開發+征騎清理的協作模式
**查重結果**：UI系統重構，無重複內容
**下次提醒**：威騎需更新wiki/systems/ui-implementation.md頭上UI和下方面板段落；用戶需實玩確認面板COMBO位置（PANEL_COMBO_CONFIG偏移量）

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
