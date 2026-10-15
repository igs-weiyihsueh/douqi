# 鬥氣割草用語表

> 團隊討論、文件、與 AI 溝通一律使用「正式名稱」。每個名稱對到一個程式位置與設定，方便從企劃用語找到程式、也能從程式找回企劃用語。
> 程式名稱寫「檔案 › 類別 / 函式 / 欄位」，不寫行號；設定指 `config.ts` 的 `GameConfig` 區塊。
> 名稱由使用者逐章裁定（2026-10-14）；新增或改名請先與使用者確認，再更新本表。

---

## UI 介面

| 正式名稱 | 說明 | 程式名稱 | 設定 |
|---|---|---|---|
| JP介面 | 畫面最上方置中的 JP 圖 | `scenes/UIScene.ts` | `jackpotBanner` |
| 關卡進度 | 畫面上方的圓點＋量條，顯示本關進度與後續關卡的寶箱 | `scenes/UIScene.ts` › waveHud 繪製 | `waveHud` |
| 波次間隔 | 波與波之間畫面中上方的 3→2→1 倒數 | `controllers/WaveCountdown.ts` › `WaveCountdown` | `stageMonsters.breakCountdown` |
| 提示文字 | 畫面跳出的提示訊息 | `scenes/GameScene.ts` › `showEventBanner` | — |
| 角色面板 | 跟著角色的頭上顯示（總稱） | `scenes/UIScene.ts` › `overheadUIs` | `headUi` |
| P位欄 | 角色面板上的 1P / 2P… 編號 | `scenes/UIScene.ts` › `overheadUIs` | `characters.colors` |
| CREDIT欄 | 角色面板上的劍形圖示＋CREDIT 數字 | `scenes/UIScene.ts` › `overheadUIs` | `credit` |
| 二段變身量條 | 角色面板上的二段變身能量條，集滿可變身 | `scenes/UIScene.ts` › `overheadUIs`；`objects/Character.ts` › `energy` | `energy` |
| 投幣提示 | CREDIT 用完時頭上的「投幣續關」＋倒數 | `controllers/CreditController.ts` | `credit.prompt`、`credit.continueText` |
| P位面板 | 畫面下方每位玩家一格的面板（總稱；F4 美術版不另命名） | `scenes/UIScene.ts` › `rows`、`bottomPanelOverlays` | — |
| 擊殺欄 | P位面板的 💀 擊殺數（暫留，之後可能拔掉） | `scenes/UIScene.ts` › `killBox` | — |
| 彩票欄 | P位面板的 🎫 彩票數 | `scenes/UIScene.ts` › `ticketBox` | — |
| 連段介面 | P位面板的 HIT 連段數，快中斷時閃爍 | `scenes/UIScene.ts` › `panelHitCounters` | `comboReward.WARNING_START_RATIO` |
| 多投多送量條 | P位面板的膠囊形加贈進度 | `objects/CoinBonusBar.ts` › `CoinBonusBar` | `credit.coinBar` |
| 待機提示 | 待機時 P位面板輪播「投幣加入遊戲／投越多送越多」 | `scenes/UIScene.ts` › `panelJoinTexts` | `credit.joinTexts` |
| 鎖定框 | 被自動鎖定的目標身上的框 | `controllers/TargetingController.ts` | `lock.marker` |
| 怪物提示 | 怪在畫面外時畫面邊緣的箭頭 | `controllers/OffscreenEnemyIndicator.ts` › `OffscreenEnemyIndicator` | `stage.offscreenIndicator` |
| 移動提示 | 出口開啟時指引方向的 GO | `controllers/GoIndicator.ts` › `GoIndicator` | `stage.goIndicator` |
| 結算介面 | 關卡結算的戰績、分數、名次面板 | `objects/StageSettlementPanel.ts` › `StageSettlementPanel` | `stageSettlement` |

## 投幣與彩票

| 正式名稱 | 說明 | 程式名稱 | 設定 |
|---|---|---|---|
| CREDIT | 投幣換得的遊玩點數，每招第一次命中扣 1 | `objects/Character.ts` › `credit`；`controllers/CreditController.ts` | `credit` |
| 彩票 | 玩家贏得的獎勵票 | `objects/Character.ts` › `tickets` | `ticketEffect` |
| 彩金池 | 每扣 1 CREDIT 依比例存進各獎項的彩票額度，獎項觸發時從這裡發票 | `controllers/PayoutController.ts` › `PayoutController` | `payout.shares` |
| 多投多送 | 依投幣次數循環加贈 CREDIT | `controllers/CreditController.ts` › `coinCycleStep` | `credit.coinCycle` |
| 投幣續關 | CREDIT 用完後倒數內投幣可繼續 | `controllers/CreditController.ts` | `credit.continueSeconds` |
| 待機 | 角色狀態：這個 P 位還沒投幣進場（或續關倒數結束） | `objects/Character.ts` › `creditState` = `'absent'` | — |
| 遊玩 | 角色狀態：有 CREDIT 在場上 | `objects/Character.ts` › `creditState` = `'playing'` | — |
| 續關 | 角色狀態：CREDIT 用完、等投幣續關（不參加關卡結算分寶箱） | `objects/Character.ts` › `creditState` = `'waiting'` | — |
| 關卡結算 | 關卡打完後播放結算介面，接著降下寶箱依分數分彩票 | `controllers/StageSettlementController.ts` › `StageSettlementController` | `stageSettlement` |
| 低階寶箱 | 一般關卡的寶箱；打完開左右出口 | `scenes/GameScene.ts` › `lastStageChest` = `'low'`；`controllers/PayoutController.ts` › `payStageChest` | `payout.shares.lowChest` |
| 高階寶箱 | 較高價值的寶箱；打完開上方出口 | `scenes/GameScene.ts` › `lastStageChest` = `'high'`；`controllers/PayoutController.ts` › `payStageChest` | `payout.shares.highChest` |
| 連段獎勵 | 連段達 5/10/20/50/100 HIT 記下獎勵，中斷時發彩票 | `controllers/ComboRewardController.ts` › `ComboRewardController`；`controllers/PayoutController.ts` › `payCombo` | `comboReward`、`payout.shares.combo` |
| 免費模式 | 除錯用：攻擊不扣 CREDIT（X 鍵） | `controllers/CreditController.ts` › `toggleFreePlay` | — |

## 操作與鎖定

| 正式名稱 | 說明 | 程式名稱 | 設定 |
|---|---|---|---|
| 移動 | 八方向移動 | `controllers/CharacterActionController.ts` | `slow.moveSpeed` |
| 攻擊鍵 | 出招 | `scenes/GameScene.ts` › `queuePlayerAttack` | — |
| 特殊鍵 | 進入二段變身；靠近虛弱BOSS時改為 BOSS變身 | `controllers/ComboSkillController.ts` › `tryManualEmpower`；`controllers/BossController.ts` › `tryTransform` | — |
| 投幣 | 投幣取得 CREDIT，待機時直接加入 | `controllers/CreditController.ts` › `insertCoin` | `credit` |
| 自動鎖定 | 自動選鎖定範圍內的目標（怪、木箱） | `controllers/TargetingController.ts` › `updateSlowLock` | `lock` |
| 鎖定範圍 | 自動鎖定能選到的距離（與衝刺距離同值，角色編輯器可調） | `scenes/GameScene.ts` › `slowTuning.lockRadius` | `slow.dashDistance` |
| 面向優先 | 範圍內有多個目標時，優先選面朝方向的 | `controllers/TargetingController.ts` › `pickAimConeTarget` | `aim.aimConeDeg` |
| 近戰攻擊 | 目標很近時原地揮扇形 | `controllers/CharacterActionController.ts` | `melee` |
| 衝刺攻擊 | 目標較遠時衝過去打 | `controllers/CharacterActionController.ts` | `slow.dashSpeed` |
| 衝刺 | 沒有目標時朝面向衝一段 | `controllers/CharacterActionController.ts` › `startDirectionDash` | `slow.dashDistance` |
| 真空圈 | 角色腳下怪進不來的橢圓地盤 | `scenes/GameScene.ts` | `slow.vacuumRadius`、`slow.vacuumFlatten` |

## 二段變身

| 正式名稱 | 說明 | 程式名稱 | 設定 |
|---|---|---|---|
| 二段變身 | 二段變身能量集滿按特殊鍵進入的強化狀態，約 7 秒，能量倒退到 0 結束 | `objects/Character.ts` › `empowered` | `energy`、`combo.empower` |
| 二段變身能量 | 打倒敵人累積，滿了可二段變身 | `objects/Character.ts` › `energy`；`controllers/ComboSkillController.ts` › `grantKillEnergy` | `energy` |
| 二段變身外觀 | 變身期間的金色調、光環、粒子 | `objects/Character.ts` › `empoweredForm` | `combo.empower.form` |
| 強化攻擊 | 二段變身期間的攻擊：衝向目標，以它為中心炸範圍傷害（也打木箱） | `controllers/CharacterActionController.ts` › `empoweredDash`；`controllers/ComboSkillController.ts` › `empowerAoeBurst` | `combo.empower.aoe` |
| 絕技 | 強化攻擊每打中 4 次自動觸發，原地亂打 16 下 | `controllers/ComboSkillController.ts` › `triggerBurst` | `combo.empower.burstEveryAoeHits`、`burst` |
| 額外補怪 | 二段變身／BOSS變身期間額外即時生的怪，不算關卡目標，清完才進下一波或結算 | `controllers/SpawnController.ts` › `spawnSurge`、`countQuotaExempt` | `stageMonsters.profiles.*.surge`、`stageMonsters.bossFormSurge` |
| 二段變身獎勵 | 二段變身期間打中怪發的彩票 | `controllers/PayoutController.ts` › `paySecondFormHit` | `payout.shares.secondForm` |

## 戰鬥與招式

| 正式名稱 | 說明 | 程式名稱 | 設定 |
|---|---|---|---|
| 連段 | 連續打中的 HIT 數，一段時間沒打中或受擊就中斷 | `controllers/ComboRewardController.ts`；`objects/Character.ts` › `comboState.currentStreak` | `comboReward` |
| 蓄力 | 打中累積，4 下放招式1、8 下放招式2，放完歸零 | `controllers/ComboSkillController.ts` › `onComboHit`；`objects/Character.ts` › `spirit` | `combo.slowThresholds` |
| 招式 | 蓄力集滿自動放的攻擊（招式1、招式2 總稱） | `controllers/ComboSkillController.ts` | `combo` |
| 招式1 | 蓄力 4 下：圓形範圍攻擊 | `controllers/ComboSkillController.ts` › `comboCircle` | `combo.circle` |
| 招式2 | 蓄力 8 下：直線貫穿攻擊 | `controllers/ComboSkillController.ts` › `comboLine` | `combo.line` |
| 受擊 | 被怪打中（不扣血，連段中斷） | `scenes/GameScene.ts` › `damageCharacterFrom` | — |
| 木箱 | 場上可打破的箱子 | `controllers/BreakableController.ts` › `BreakableController`；`objects/Breakable.ts` | `breakable` |
| 木箱獎勵 | 打破木箱發的彩票 | `controllers/PayoutController.ts` › `payCrate` | `payout.shares.crate` |

## 敵人

| 正式名稱 | 說明 | 程式名稱 | 設定 |
|---|---|---|---|
| 小怪 | 基本近戰怪 | `objects/Enemy.ts` › `EnemyType` `'normal'` | `enemy.types.normal` |
| 大怪 | 高血量、慢、體型大 | `objects/Enemy.ts` › `EnemyType` `'tank'` | `enemy.types.tank` |
| 遠程怪 | 遠距離丟炸彈，落點有預警圈 | `objects/Enemy.ts` › `EnemyType` `'bomber'` | `enemy.types.bomber` |
| 寶箱怪 | 跑來跑去、打中掉彩票的怪，4人合力積累共用池50張門檻 | `controllers/TreasureEnemyController.ts`；`objects/Enemy.ts` › `EnemyType` `'treasure'`；`controllers/PayoutController.ts` › `payTreasureHit`、`payTreasureKill`、`treasureFunded`、`lockTreasurePrize`、`refundTreasurePrize`；`scenes/GameScene.ts` › `spawnTreasureFromCrate` | `enemy.treasure`、`payout.treasure` |
| BOSS亂入 | 彩金池存夠時關卡中途限時出現的 BOSS，不打也能過關，時間到離開 | `controllers/BossController.ts` › `spawn(true)` | `stage.bossIntrude`、`stageMonsters.chests.*.bossIntrude` |
| BOSS變身 | 靠近虛弱BOSS按特殊鍵，玩家變成 BOSS | `controllers/BossController.ts` › `tryTransform` | `boss` |
| 虛弱BOSS | 打倒後留在地上的 BOSS，用來 BOSS變身 | `controllers/BossController.ts` › `corpse` | `boss` |
| BOSS獎勵 | BOSS亂入打中、打倒與 BOSS變身期間打怪發的彩票 | `controllers/PayoutController.ts` › `payBossHit`、`payBossKill`、`payBossFormKill` | `payout.boss` |
| 呼叫 | 玩家身邊怪太少時，從遠處叫怪過來 | `controllers/EnemyRallyController.ts` › `EnemyRallyController` | `enemyRally` |
| 仇恨 | 怪鎖定某位玩家追著打 | `objects/Enemy.ts` › `targetSeat`、`aggroActive` | `enemySticky` |
| 預警圈 | 遠程怪炸彈落點的預警 | `objects/Enemy.ts` › `telegraphing` | `enemy.types.bomber` |
| 出怪組合 | 每關隨機抽的出怪配置（下列三種總稱） | `controllers/SpawnController.ts` | `stageMonsters.profiles` |
| 小怪組合 | 小怪多、快節奏 | — | `stageMonsters.profiles.swarm` |
| 大怪組合 | 大怪多、慢節奏 | — | `stageMonsters.profiles.armor` |
| 遠程怪組合 | 遠程怪多 | — | `stageMonsters.profiles.artillery` |
| 近身組 | 直接出在玩家身邊的怪 | `controllers/SpawnController.ts` | `spawnAlloc` |
| 場上組 | 出在場地其他地方的怪 | `controllers/SpawnController.ts` | `spawnAlloc` |

## 關卡流程

| 正式名稱 | 說明 | 程式名稱 | 設定 |
|---|---|---|---|
| 關卡 | 打怪 → 關卡結算 → 走出口的一個單位 | `scenes/GameScene.ts` › `startStage`、`completeStage` | `stage` |
| 波次 | 一關分 3 批出怪 | `scenes/GameScene.ts` › `subWavesDone`、`subWavesTarget` | `stageMonsters.profiles.*.waves` |
| 關卡目標 | 一關要打倒的怪數（依寶箱階級與人數） | `scenes/GameScene.ts` › `waveQuota` | `stage.quotaByChest` |
| 場地 | 一個可走的場地畫面 | `controllers/SlotWorldController.ts` › `SlotWorldController` | `stage.arenaW`、`stage.arenaH` |
| 問號關 | 進去才揭曉低階或高階寶箱的關 | `systems/stageQueue.ts` › `StageNodeKind` `'mystery'` | `stage.mysteryHighChance` |
| 出口 | 關卡結束後開啟的換場點 | `controllers/SlotWorldController.ts` | `stage.exitOrb` |
| 左右出口 | 低階寶箱關打完開左或右一側，平移到相鄰場地 | `controllers/SlotWorldController.ts` › `openCrossing` | `stage.defaultCrossSide` |
| 上方出口 | 高階寶箱關打完開上方出口，閃黑到新場地 | `controllers/SlotWorldController.ts` › `openTopExit` | — |
| 分歧 | 問號關前同時開兩個出口選路 | `controllers/SlotWorldController.ts` › `openMysteryExits` | `stage.mysteryExitCombos` |
| 轉場 | 換場地時的平移或閃黑 | `controllers/SlotWorldController.ts` › `AreaTransition` | — |
| 隱藏入口 | 場地上方的熔岩拱門，彩金池存夠時開啟，通往派對密室 | `controllers/HiddenGateController.ts` | `stage.hiddenGate` |
| 派對密室 | 限時獎勵房，寶箱怪從周圍財寶堆跳進來 | `controllers/TreasureRoomController.ts` › `TreasureRoomController` | `stage.treasureRoom` |
| 派對獎勵 | 派對密室裡發的彩票 | `controllers/PayoutController.ts` › `payRoomHit`、`payRoomKill` | `payout.treasureRoom` |
