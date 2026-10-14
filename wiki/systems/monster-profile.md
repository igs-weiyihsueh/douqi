# 關卡怪物系統 (Monster Profile System)

**系統概述**：關卡怪物配置管理系統，依寶箱階級決定小關卡的怪物數量、種類比例和分階段出怪規則，實現關卡難度動態調整。

## 🎯 **核心功能**

### **動態關卡配置**
根據寶箱階級(ChestTier)自動選擇適合的怪物配置，確保關卡難度與獎勵匹配：
- **低階寶箱** → 較少怪物數量，簡單種類配比
- **高階寶箱** → 更多怪物數量，複雜種類配比
- **自動適配** → 同時在場上限和分階段出怪規則

### **怪物種類比例**
新的怪種配置系統，精確控制各類型怪物出現比例：
```typescript
interface MonsterProfile {
  totalKills: number;           // 總擊殺數量
  concurrentLimit: number;      // 同時在場上限
  phases: MonsterPhase[];       // 分階段出怪
}

interface MonsterPhase {
  at: number;                   // 進度百分比觸發點
  surge: MonsterSurge;          // 怪物潮配置
}

interface MonsterSurge {
  normal: number;               // 普通怪數量
  tank: number;                 // 坦克怪數量
  bomber: number;               // 炸彈怪數量
}
```

### **實時配置查詢**
```typescript
// 依寶箱階級獲取怪物配置
function monsterProfile(id: string): MonsterProfile {
  return monsterProfiles[id] || monsterProfiles['default'];
}

// 隨機選擇配置（寶箱開啟時）
function pickMonsterProfile(chest: ChestTier, rand: () => number = Math.random): MonsterProfile {
  const profiles = chestToMonsterProfiles[chest] || ['default'];
  return monsterProfile(profiles[Math.floor(rand() * profiles.length)]);
}
```

## 🔧 **技術實作**

### **配置管理** (7906123上線)
- **系統位置**: `systems/stageMonsters.ts`
- **配置映射**: ChestTier → MonsterProfile[] → 隨機選擇
- **整體出現比例**: 確保實際比例等於配置比例

### **二段變身補怪** (bec9e9f+b424dd8上線)
- **即時補怪**: 二段變身瞬間在變身玩家身旁環狀補一批怪物
- **不計數規則**: 補充的怪物不計入擊殺進度
- **無上限限制**: 即使場上已滿也照常補（`profiles[].surge`）
- **各座位冷卻**: 每位玩家各自 `cooldownMs`

### **BOSS變身即時補怪（分兩批）** (08125a4調整)
`config.ts stageMonsters.bossFormSurge`（即 `GameScene.surgeOnBossForm()`，`scenes/GameScene.ts:1365-1380`）：
- **分兩批補怪**: 變身後在 **P1** 身旁環狀補怪
  - 第 1 批：`delayMs: 0`，`count: [12, 14]`（變身瞬間）
  - 第 2 批：`delayMs: 5000`，`count: [10, 12]`（變身後第 5 秒）
- **不乘人數**: 固定 count，不隨存活人數放大（有別於場上組的 `fieldBatchGrowthPerPlayer`）
- **抽怪比例**: `weights: { normal: 90, tank: 10, bomber: 0 }`
- **批次失效保護**: 輪到該批時若「變身已結束（`!bossCtl.isTransformed`）」或「關卡已打完（`!canSurge()`）」就 **不補**
- **無冷卻**: 每打倒一隻BOSS亂入才可能變身一次，變身本身即為節流
> 舊版為單批 `count: [12, 16]`，`weights` 相同；08125a4 改為兩批延遲補怪結構。

### **高階寶箱 BOSS 亂入（開打後計時）** (08125a4調整)
`config.ts stageMonsters.chests[tier].bossIntrude`：
- **亂入機制**: 高階寶箱 `chance: 0.3`（低階 `chance: 0`）
- **登場時機**: **開打後 `delayMs: 3000`（3 秒）登場**，不再看擊殺進度
- **決定方式**: 小關卡開打時 `Math.random() < chance` 決定本關是否BOSS亂入，命中則記錄 `bossIntrudeAt = time.now + delayMs`（`scenes/GameScene.ts:1180-1181`）
- **逐幀觸發**: `maybeBossIntrude(time)` 每幀檢查（`scenes/GameScene.ts:1337-1357`），到時且 `canSurge() && !bossCtl.current` 才生成
- **延後條件**: 波間休息（`intermission`）中、或 credit 模式下沒有人在場（`aliveCount()===0`）時不生成；本關已打完或場上已有 BOSS 則取消
> 舊版 `bossIntrude: { chance, atProgress: 0.5 }` 由 `stageKillProgress()` 達 50% 觸發；08125a4 改為 `{ chance, delayMs: 3000 }` 開打計時觸發（欄位 `atProgress → delayMs`，狀態 `bossIntrudeAtProgress → bossIntrudeAt`）。

### **關卡結算條件：即時補怪要清完** (08125a4新增)
最後一波打完時若場上還有「即時補怪（二段變身 surge / BOSS變身補怪）」未清，**先不結算關卡**：
- **判定來源**: `SpawnController.countQuotaExempt()`（原為 private，08125a4 開放為公開；`controllers/SpawnController.ts:431`）回傳場上（含預告中）不計配額的即時補怪數
- **延後旗標**: 達子區目標波數時若 `countQuotaExempt() > 0`，設 `pendingSurgeClear = true`、`waveState = 'clearing'`（停止生怪），否則直接 `finishStage()`（`scenes/GameScene.ts:1016-1022`）
- **逐幀檢查結算**: `finishStageWhenSurgeCleared()` 每幀在怪物更新後檢查，`countQuotaExempt()` 歸零才 `finishStage() + emitStats()`（`scenes/GameScene.ts:928-934`）
- **與寶箱怪延後並存**: `finishStage()` 內若場上還有寶箱怪，再設 `pendingSubZoneComplete` 等寶箱怪死/離場才真正切換（`scenes/GameScene.ts:1043-1054`）

## 📊 **配置數據**

### **怪物種類定義**
```typescript
type MonsterKind = 'normal' | 'tank' | 'bomber';

// 基礎怪物特性
const monsterTypes = {
  normal: '普通近戰怪 - 基礎移速和攻擊',
  tank: '坦克怪 - 高血量護盾，近戰',
  bomber: '炸彈怪 - 遠程爆炸攻擊'
};
```

### **關卡進度觸發**
分階段出怪系統確保關卡節奏：
- **0%**: 初始怪物潮
- **30%**: 中期增援
- **60%**: 後期挑戰
- **90%**: 最終清場

## 🎮 **遊戲體驗**

### **難度平衡**
- **寶箱階級對應**: 獎勵與挑戰匹配
- **動態調整**: 根據進度動態增加難度
- **多樣性確保**: 不同配置提供變化體驗

### **性能優化**
- **預配置查詢**: 避免運行時計算開銷
- **批量生成**: 分階段觸發減少瞬間負載
- **上限控制**: 同時在場數量限制確保流暢度

## 🔍 **除錯支援**

### **除錯介面**
```typescript
// GameScene.monsterProfileDebugLines()
private monsterProfileDebugLines(): string[] {
  return [
    `Profile: ${this.currentProfile.id}`,
    `Kills: ${this.kills}/${this.currentProfile.totalKills}`,
    `Concurrent: ${this.enemyCount}/${this.currentProfile.concurrentLimit}`,
    `Phase: ${this.currentPhaseIndex}/${this.currentProfile.phases.length}`
  ];
}
```

### **即時監控**
- **F9面板**: 顯示當前配置狀態
- **進度追蹤**: 擊殺數/總數、階段進度
- **怪物統計**: 各類型怪物當前數量

## 📋 **配置維護**

### **新增配置**
1. 在`monsterProfiles`定義新配置
2. 在`chestToMonsterProfiles`建立映射
3. 測試各階段觸發和數量平衡
4. 更新除錯介面顯示

### **平衡調整**
- **總擊殺數**: 影響關卡長度
- **同時上限**: 影響戰鬥密度
- **種類比例**: 影響戰鬥策略需求

## 🚀 **上線記錄**

### **關卡怪物配置** (7906123)
- **功能**: 小關卡依寶箱階級抽配置
- **決定因子**: 擊殺數、同時在場上限、分階段出怪
- **整體比例**: 確保實際出現比例等於配置

### **新怪種比例** (8da8231)  
- **改進**: 關卡怪物配置改用新的怪種比例
- **保證**: 整體出現比例等於配置比例

### **二段變身系統** (bec9e9f+b424dd8)
- **即時補怪**: 變身瞬間補6~10隻，不計擊殺數
- **無上限**: 場上已滿也照補，提升變身體驗

### **BOSS亂入機制** (48384b8)
- **高階寶箱**: 30%機率觸發BOSS亂入
- **登場時機**: 擊殺進度50%時登場（**已於 08125a4 改為開打後 3 秒**）

### **BOSS變身機制調整** (08125a4)
- **亂入時機**: 由「擊殺進度 50%」改為「開打後 3 秒」（`atProgress:0.5 → delayMs:3000`）
- **變身 BOSS 補怪**: 由單批 `[12,16]` 改為兩批（`delayMs:0 [12,14]` + `delayMs:5000 [10,12]`），不乘人數、批次失效保護
- **關卡結算**: 最後一波打完時場上還有即時補怪 → 清完才結算（`pendingSurgeClear` + `countQuotaExempt()`）
- **保險機制**: 關卡打完 `onStageComplete()` 清屍體不再變身、換區 `onZoneLeave()` 結束變身（收回無敵）、關卡進行中才留屍體（`isStageActive()`）

## 參考檔案

- `systems/stageMonsters.ts` - 怪物配置核心系統
- `scenes/GameScene.ts` - 關卡邏輯整合
- `config.ts` - 基礎配置參數
- commits: 7906123, 8da8231, bec9e9f, b424dd8, 48384b8, 08125a4

**關卡怪物系統為每個寶箱等級提供精確的難度匹配體驗！**
