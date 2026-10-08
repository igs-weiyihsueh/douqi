# 鬥氣割草專案術語表

> 統一專案核心概念和程式碼對照，便於開發團隊和AI理解專案架構

---

## 角色系統 (Character System)

| 術語 | 說明 | 程式碼位置 | 相關文檔 |
|------|------|----------|----------|
| **Character** | 玩家和BOT共用的角色基類 | `objects/Character.ts:16-25` | [戰鬥系統](./systems/combat-system.md) |
| **Player** | 玩家控制的角色 (characters[0]) | `scenes/GameScene.ts:21-24` | [遊戲功能設計](./design/gameplay-evolution.md) |
| **Bot** | AI控制的角色 (isBot: true) | `objects/Character.ts:17` | [戰鬥系統](./systems/combat-system.md) |
| **spirit** | 連段計數值 | `objects/Character.ts:26` | [UI系統實作](./systems/ui-implementation.md) |
| **energy** | v55新增能量值 (0-10) | `objects/Character.ts:28` | [戰鬥系統](./systems/combat-system.md) |
| **credit** | 階段二貨幣點數 | `objects/Character.ts:30` | [UI系統實作](./systems/ui-implementation.md) |
| **comboState** | 階段三COMBO獎勵系統狀態 | `objects/Character.ts:31-39` | [UI系統實作](./systems/ui-implementation.md) |
| **skillLockUntil** | 技能演出鎖定時間戳 | `objects/Character.ts:45` | [戰鬥系統](./systems/combat-system.md) |
| **lockedTarget** | 當前鎖定的目標 (敵人或道具) | `objects/Character.ts:64-66` | [資料流程](./architecture/data-flow.md) |
| **empowered** | 慢速模式強化狀態標記 | `objects/Character.ts:54` | [戰鬥系統](./systems/combat-system.md) |
| **empowerUntil** | 快速模式強化結束時間戳 | `objects/Character.ts:53` | [戰鬥系統](./systems/combat-system.md) |

## 敵人系統 (Enemy System)

| 術語 | 說明 | 程式碼位置 | 相關文檔 |
|------|------|----------|----------|
| **EnemyType** | 敵人類型聯合型別 | `objects/Enemy.ts:4` | [遊戲功能設計](./design/gameplay-evolution.md) |
| **normal** | 基礎近戰敵人 | `objects/Enemy.ts:4` | [戰鬥系統](./systems/combat-system.md) |
| **tank** | 高血量肉盾型敵人 | `objects/Enemy.ts:4` | [戰鬥系統](./systems/combat-system.md) |
| **shielder** | 護盾型敵人 | `objects/Enemy.ts:4` | [戰鬥系統](./systems/combat-system.md) |
| **treasure** | 寶箱怪 (特殊獎勵型) | `objects/Enemy.ts:4` | [遊戲功能設計](./design/gameplay-evolution.md) |
| **boss** | BOSS級敵人 | `objects/Enemy.ts:4` | [戰鬥系統](./systems/combat-system.md) |
| **aiState** | 敵人AI狀態機 | `objects/Enemy.ts:31` | [資料流程](./architecture/data-flow.md) |
| **targetSeat** | 黏著目標角色索引 | `objects/Enemy.ts:49` | [戰鬥系統](./systems/combat-system.md) |
| **forceChase** | 強制追擊模式 | `objects/Enemy.ts:58` | [戰鬥系統](./systems/combat-system.md) |
| **aggroActive** | 主動仇恨標記 | `objects/Enemy.ts:63` | [戰鬥系統](./systems/combat-system.md) |
| **treasureHits** | 寶箱怪被命中次數 | `objects/Enemy.ts:21` | [遊戲功能設計](./design/gameplay-evolution.md) |

## 場景系統 (Scene System)

| 術語 | 說明 | 程式碼位置 | 相關文檔 |
|------|------|----------|----------|
| **GameScene** | 核心遊戲邏輯場景 (422KB) | `scenes/GameScene.ts:26` | [遊戲引擎架構](./architecture/game-engine.md) |
| **UIScene** | HUD系統覆蓋場景 (71KB) | `scenes/UIScene.ts:40` | [UI系統實作](./systems/ui-implementation.md) |
| **TitleScene** | 主選單場景 (44KB) | `scenes/TitleScene.ts:7` | [UI/UX設計](./design/ui-ux-decisions.md) |
| **BootScene** | 資源載入場景 (25KB) | `scenes/BootScene.ts` | [遊戲引擎架構](./architecture/game-engine.md) |
| **MinigameMenuScene** | 小遊戲選單場景 | `scenes/MinigameMenuScene.ts` | [小遊戲系統](./design/minigame-system.md) |
| **CollectRaceScene** | 收集競賽場景 (31KB) | `scenes/CollectRaceScene.ts:25` | [小遊戲系統](./design/minigame-system.md) |
| **PushSurvivalScene** | 推人生存場景 (32KB) | `scenes/PushSurvivalScene.ts:29` | [小遊戲系統](./design/minigame-system.md) |
| **BombArenaScene** | 炸彈人對戰場景 (36KB) | `scenes/BombArenaScene.ts` | [小遊戲系統](./design/minigame-system.md) |

## 波次系統 (Wave System)

| 術語 | 說明 | 程式碼位置 | 相關文檔 |
|------|------|----------|----------|
| **WaveSpawnState** | 波次生成狀態介面 | `systems/waveMath.ts:15` | [戰鬥系統](./systems/combat-system.md) |
| **progress** | 本波已累積進度 | `systems/waveMath.ts:16` | [戰鬥系統](./systems/combat-system.md) |
| **targetProgress** | 本波目標進度 | `systems/waveMath.ts:17` | [戰鬥系統](./systems/combat-system.md) |
| **refilling** | 補生栓狀態 (防抖機制) | `systems/waveMath.ts:24` | [效能配置](./systems/performance-config.md) |
| **shouldSpawnMore** | 生成控制函數 | `systems/waveMath.ts:39` | [戰鬥系統](./systems/combat-system.md) |
| **waveState** | 波次狀態 ('spawning'等) | `scenes/GameScene.ts:94` | [資料流程](./architecture/data-flow.md) |

## 配置系統 (Config System)

| 術語 | 說明 | 程式碼位置 | 相關文檔 |
|------|------|----------|----------|
| **GameConfig** | 遊戲主配置物件 | `config.ts:5` | [效能配置](./systems/performance-config.md) |
| **levelLerp** | 等級化數值計算函數 | `config.ts` | [效能配置](./systems/performance-config.md) |
| **arena** | 場地配置 (經典模式) | `config.ts:107-115` | [UI/UX設計](./design/ui-ux-decisions.md) |
| **characterParams** | 角色參數存讀檔系統 (5740cfc新增) | `systems/characterParams.ts:1` | [角色編輯器](./systems/character-editor.md) |
| **CharacterEditorPanel** | 角色編輯器面板類別 (5740cfc新增) | `objects/CharacterEditorPanel.ts:70` | [角色編輯器](./systems/character-editor.md) |
| **attackCooldownMs** | 攻擊冷卻間隔參數 (5740cfc可調) | `GameScene.ts:xxx` | [角色編輯器](./systems/character-editor.md) |
| **markerColor** | HUD位置標記顏色(綠色) (05dafae新增) | `config.ts:84` | [關卡系統](./systems/stage-system.md) |
| **BossController** | BOSS系統控制器類別 (9782518新增) | `controllers/BossController.ts:45` | [BOSS系統](./systems/boss-system.md) |
| **BossHost** | BOSS控制器場景介面 (9782518新增) | `controllers/BossController.ts:7` | [專案架構](./architecture/project-structure.md) |
| **TelegraphFx** | 預警特效介面型別 (9782518抽出) | `systems/telegraphFx.ts:5` | [BOSS系統](./systems/boss-system.md) |
| **SkillController** | 招式系統控制器類別 (7bd6845新增) | `controllers/SkillController.ts:36` | [招式系統](./systems/skill-system.md) |
| **SkillHost** | 招式控制器場景介面 (7bd6845新增) | `controllers/SkillController.ts:8` | [招式系統](./systems/skill-system.md) |
| **ArtStyleController** | 美術切換控制器 (82f5fb6新增) | `controllers/ArtStyleController.ts:35` | [專案架構](./architecture/project-structure.md) |
| **ScenePalette** | 場景配色介面 (fe938ff抽出) | `systems/zoneScenery.ts:12` | [場景渲染](./systems/scene-rendering.md) |
| **isFixedEnemy** | 固定敵人判斷函式 (55cca6d統一) | `systems/enemyKinds.ts:10` | [專案架構](./architecture/project-structure.md) |
| **GoIndicator** | GO指示器控制器類別 (7fe3754迭代) | `controllers/GoIndicator.ts:30` | [GO指示器](./systems/go-indicator.md) |
| **GoDirection** | GO指示器方向型別 (69f5a1c新增) | `controllers/GoIndicator.ts:5` | [GO指示器](./systems/go-indicator.md) |
| **markerDotScale** | 位置標記中心亮點縮放 (05dafae新增) | `config.ts:85` | [關卡系統](./systems/stage-system.md) |
| **drawStageMarker** | HUD位置標記繪製函式 (05dafae新增) | `UIScene.ts:858` | [關卡系統](./systems/stage-system.md) |
| **stageCycle** | 無限關卡循環配置 (874b8f9新增) | `config.ts:920` | [關卡系統](./systems/stage-system.md) |
| **chestTickets** | 關卡寶箱彩票獎勵配置 (874b8f9新增) | `config.ts:927` | [關卡系統](./systems/stage-system.md) |
| **areaVariant** | 場景變體標識('A'荒城/'B'火山) (874b8f9新增) | `GameScene.ts:91` | [關卡系統](./systems/stage-system.md) |
| **dirLock** | 關卡轉場方向限制 (874b8f9新增) | `GameScene.ts:91` | [關卡系統](./systems/stage-system.md) |
| **waveHud** | 卷軸HUD視覺配置 (874b8f9重構) | `config.ts:58` | [UI實作](./systems/ui-implementation.md) |
| **stage** | 關卡模式配置 (2decdde更新→874b8f9重構) | `config.ts` | [架構決策演進](./decisions/architecture-evolution.md) |
| **followDeadzoneW/H** | 鏡頭跟隨死區 (7975cc9新增) | `config.ts` | [架構決策演進](./decisions/architecture-evolution.md) |
| **enemySeparation** | 敵人分離系統配置 | `config.ts:123-142` | [效能配置](./systems/performance-config.md) |
| **enemySticky** | 敵人黏著目標配置 | `config.ts:151-158` | [戰鬥系統](./systems/combat-system.md) |
| **debug** | 除錯開關配置 | `config.ts:17-22` | [技術選擇](./decisions/technical-choices.md) |

## UI系統 (UI System)

| 術語 | 說明 | 程式碼位置 | 相關文檔 |
|------|------|----------|----------|
| **CharStat** | 角色狀態顯示介面 | `scenes/UIScene.ts:18-35` | [UI系統實作](./systems/ui-implementation.md) |
| **ComboState** | COMBO系統狀態介面 | `scenes/UIScene.ts:7-16` | [UI系統實作](./systems/ui-implementation.md) |
| **StatsPayload** | 統計資料載體介面 | `scenes/UIScene.ts:37-50` | [UI系統實作](./systems/ui-implementation.md) |
| **burstMark** | 角色爆發標記 | `objects/Character.ts:85` | [UI系統實作](./systems/ui-implementation.md) |
| **rootMark** | 角色定身標記 | `objects/Character.ts:89` | [UI系統實作](./systems/ui-implementation.md) |
| **empowerOrbit** | 強化軌道特效 | `objects/Character.ts:75` | [UI系統實作](./systems/ui-implementation.md) |
| **hpBar** | 角色血條 | `objects/Character.ts:81` | [UI系統實作](./systems/ui-implementation.md) |
| **spiritBar** | 連段條 | `objects/Character.ts:83` | [UI系統實作](./systems/ui-implementation.md) |

## 小遊戲系統 (Minigame System)

| 術語 | 說明 | 程式碼位置 | 相關文檔 |
|------|------|----------|----------|
| **MinigameEntry** | 小遊戲註冊介面 | `minigames/registry.ts:7-14` | [小遊戲系統](./design/minigame-system.md) |
| **MINIGAMES** | 小遊戲註冊陣列 | `minigames/registry.ts:16` | [小遊戲系統](./design/minigame-system.md) |
| **ShapeKey** | 收集競賽形狀類型 | `scenes/CollectRaceScene.ts:4` | [小遊戲系統](./design/minigame-system.md) |
| **Fighter** | 推人生存角色介面 | `scenes/PushSurvivalScene.ts:5-21` | [小遊戲系統](./design/minigame-system.md) |
| **WarnRing** | 推人生存危險圈 | `scenes/PushSurvivalScene.ts:23-31` | [小遊戲系統](./design/minigame-system.md) |

## 物理系統 (Physics System)

| 術語 | 說明 | 程式碼位置 | 相關文檔 |
|------|------|----------|----------|
| **Breakable** | 可破壞物件類 | `objects/Breakable.ts:6` | [遊戲功能設計](./design/gameplay-evolution.md) |
| **Item** | 道具物件類 | `objects/Item.ts:4` | [戰鬥系統](./systems/combat-system.md) |
| **SkillType** | 技能道具類型 | `objects/Item.ts:1` | [戰鬥系統](./systems/combat-system.md) |
| **separateCharacterFromEnemies** | 角色敵人分離函數 | `scenes/GameScene.ts` | [效能配置](./systems/performance-config.md) |
| **bounceRestitution** | 邊界反彈係數 | `config.ts:115` | [Phaser技術架構](./architecture/phaser-typescript.md) |

## 技術架構 (Technical Architecture)

| 術語 | 說明 | 程式碼位置 | 相關文檔 |
|------|------|----------|----------|
| **Phaser.Game** | 遊戲實例 | `main.ts:15` | [遊戲引擎架構](./architecture/game-engine.md) |
| **__game** | 全域除錯接口 | `main.ts:25` | [Phaser技術架構](./architecture/phaser-typescript.md) |
| **GameConfig** | 遊戲配置物件 | `main.ts:7` | [遊戲引擎架構](./architecture/game-engine.md) |
| **levelLerp** | 動態數值計算 | `config.ts` | [效能配置](./systems/performance-config.md) |
| **activeFxCount** | 特效計數器 | `scenes/GameScene.ts` | [效能配置](./systems/performance-config.md) |
| **maxActiveFx** | 特效數量上限 | `config.ts` | [技術選擇](./decisions/technical-choices.md) |

---

## 縮寫對照表

| 縮寫 | 全稱 | 說明 |
|------|------|------|
| **AI** | Artificial Intelligence | 敵人人工智慧系統 |
| **AOE** | Area of Effect | 範圍效果攻擊 |
| **HUD** | Heads-Up Display | 抬頭顯示介面 |
| **MVP** | Minimum Viable Product | 最小可行產品 |
| **NPC** | Non-Player Character | 非玩家角色 |
| **UI** | User Interface | 使用者介面 |
| **UX** | User Experience | 使用者體驗 |
| **FPS** | Frames Per Second | 每秒幀數 |

---

## 重要常數

| 常數名稱 | 數值 | 說明 | 位置 |
|----------|------|------|------|
| **width** | 1920 | 遊戲解析度寬度 | `config.ts:10` |
| **height** | 1080 | 遊戲解析度高度 | `config.ts:11` |
| **maxActiveFx** | 40 | 同時特效上限 | 各場景 |
| **footBarW** | 34 | 角色腳下狀態條寬度 | `objects/Character.ts:92` |
| **padding** | 72 | 場地邊界內縮 | `config.ts:109` |

---

*本術語表基於專案程式碼 v2026-10-07 版本建立*  
*維護者：文騎*
