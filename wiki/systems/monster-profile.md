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
- **即時補怪**: 二段變身瞬間在玩家身旁補一批怪物
- **不計數規則**: 補充的怪物不計入擊殺進度
- **無上限限制**: 即使場上已滿也照常補6~10隻

### **高階寶箱BOSS亂入** (48384b8上線)
- **亂入機制**: 高階寶箱30%機率觸發
- **登場時機**: 擊殺進度達50%時BOSS登場
- **增加挑戰**: 提升高階寶箱的戰鬥體驗

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
- **登場時機**: 擊殺進度50%時登場

## 參考檔案

- `systems/stageMonsters.ts` - 怪物配置核心系統
- `scenes/GameScene.ts` - 關卡邏輯整合
- `config.ts` - 基礎配置參數
- commits: 7906123, 8da8231, bec9e9f, b424dd8, 48384b8

**關卡怪物系統為每個寶箱等級提供精確的難度匹配體驗！**
