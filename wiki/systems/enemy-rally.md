# 智能呼叫系統 (Enemy Rally System)

**系統概述**：智能怪物呼叫系統，當玩家身邊完全沒有怪物時自動呼叫附近閒置怪物前來，確保戰鬥節奏的連續性和多人遊戲的公平性。

## 🎯 **核心機制**

### **呼叫觸發條件**
玩家身邊完全沒有怪物持續1.5秒時觸發呼叫：
- **檢測範圍**: `engagedRadius`內沒有怪物
- **狀態檢查**: 沒有怪物正在追擊或被呼叫去找該玩家  
- **持續時間**: 必須持續`lonelyMs`(1500ms)才觸發
- **冷卻機制**: 同一位玩家呼叫後冷卻`cooldownMs`(3000ms)

### **智能呼叫邏輯**
```typescript
/**
 * 呼叫：玩家身邊完全沒有怪（engagedRadius 內沒有、也沒有怪正在追他或被呼叫去找他）持續 lonelyMs，
 * 就從 searchRadius 內挑最近的 maxCount 隻閒置怪呼叫（原速，不加速）
 * - 多人：同一輪多位玩家缺怪時依座位順序挑，被挑走的怪不會再被別的玩家挑；同一位玩家呼叫後冷卻 cooldownMs
 * - 被呼叫的怪綁定該玩家直到走到附近 / 逾時 / 該玩家倒下（見 Enemy.startRally），途中不換目標
 */
interface EnemyRallyConfig {
  enabled: boolean;                    // 是否啟用召集系統
  checkIntervalMs: number;             // 評估間隔 (500ms)
  lonelyMs: number;                    // 觸發所需的孤獨持續時間 (1500ms)
  cooldownMs: number;                  // 玩家召集冷卻時間 (3000ms)
  engagedRadius: number;               // 身邊怪物檢測範圍 (150px)
  searchRadius: number;                // 召集搜尋範圍 (1000px)
  maxCount: number;                    // 每次召集的最大怪物數量 (3隻)
  maxRallyMs: number;                  // 召集持續時間上限 (15000ms)
  arriveRadius: number;                // 到達判定半徑 (100px)
  excludeNearOtherPlayer: number;      // 避免搶奪其他玩家附近怪物的距離 (200px)
}
```

## 🔧 **技術實作**

### **召集控制器** (controllers/EnemyRallyController.ts)
```typescript
class EnemyRallyController {
  /** 目前是否要召集（小關卡進行中） */
  private shouldRally(): boolean;
  
  /** 怪是否正在打它綁定的玩家：召集中、近戰怪在追擊/蓄力/冷卻中、投擲怪在綁定玩家的投擲射程內 */
  private isEngaged(enemy: Enemy, playerId: number): boolean;
  
  /** 評估所有玩家的召集需求並執行召集 */
  private evaluateRally(): void;
}
```

### **怪物召集狀態** (objects/Enemy.ts)
```typescript
class Enemy {
  /** 召集（config.enemyRally）截止時間：> 0 = 被召集去找身邊沒怪的玩家 */
  rallyUntil: number = 0;
  
  /** 被召集去找指定座位的玩家：綁定該玩家、標為主動仇恨、近戰怪巡邏中就直接轉追擊 */
  startRally(playerId: number, until: number): void;
  
  /** 是否在召集中 */
  isRallying(): boolean;
  
  /** 結束召集：以當下位置為新的出生點（否則活動範圍會立刻把怪拉回原本的出生點） */
  endRally(): void;
}
```

## 🎮 **多人遊戲支援**

### **公平分配機制**
- **座位順序**: 多位玩家同時缺怪時按座位順序優先分配
- **怪物獨占**: 被召集的怪物不會被其他玩家重複召集
- **防搶奪機制**: 不召集其他玩家附近(`excludeNearOtherPlayer`)的怪物
- **冷卻保護**: 防止同一玩家頻繁觸發召集

### **目標綁定系統**
召集中的怪物行為特殊化：
- **專一追擊**: 只追擊被召集去找的特定玩家
- **無視限制**: 不受活動範圍和脫離追擊規則限制
- **主動仇恨**: 標記為主動仇恨，不計入被動追擊上限

## 🔄 **召集週期**

### **觸發階段**
1. **孤獨檢測**: 每500ms檢查玩家身邊是否有怪物
2. **持續計時**: 沒有怪物時開始計時1.5秒
3. **範圍搜尋**: 在1000px範圍內尋找閒置怪物
4. **智能篩選**: 排除已被其他玩家佔用的怪物

### **召集過程**  
```typescript
// 召集流程示例
function rallyProcess(player: Character, nearbyEnemies: Enemy[]) {
  // 1. 選擇最近的3隻閒置怪物
  const candidates = nearbyEnemies
    .filter(e => e.isIdle() && !e.isRallying())
    .sort((a, b) => distance(player, a) - distance(player, b))
    .slice(0, 3);
    
  // 2. 開始召集
  candidates.forEach(enemy => {
    enemy.startRally(player.seatIndex, currentTime + maxRallyMs);
  });
}
```

### **結束條件**
- **到達目標**: 怪物走進`arriveRadius`(100px)範圍
- **超時機制**: 召集持續超過`maxRallyMs`(15秒)
- **目標失效**: 被召集的玩家倒下或離場
- **手動中斷**: 遇到其他更近的目標時

## 📊 **性能與平衡**

### **性能優化**
- **間隔檢測**: 500ms評估間隔避免過度計算
- **範圍限制**: 1000px搜尋範圍平衡效果與性能
- **數量控制**: 每次最多召集3隻避免過度聚集

### **遊戲平衡**
- **適度補充**: 不改變怪物移動速度，保持原有節奏
- **冷卻限制**: 3秒冷卻避免頻繁觸發
- **範圍合理**: 搜尋範圍足夠大但不會跨越整個關卡

## 🔍 **除錯與監控**

### **狀態顯示**
```typescript
// 召集狀態除錯資訊
private rallyDebugInfo(): string[] {
  return [
    `Rally Enabled: ${config.enemyRally.enabled}`,
    `Lonely Timer: ${this.lonelyTimer}/${config.enemyRally.lonelyMs}ms`,
    `Cooldown: ${this.cooldownTimer}ms remaining`,
    `Active Rallies: ${this.activeRallies.length}`
  ];
}
```

### **視覺指示** 
- **召集怪物**: 特殊顏色標記正在召集中的怪物
- **路徑顯示**: 開發模式下顯示召集路徑
- **計時器**: 顯示孤獨持續時間和冷卻倒數

## ⚙️ **配置調整**

### **基礎參數**
```typescript
// config.ts
const enemyRally = {
  enabled: true,              // 啟用/停用召集系統
  lonelyMs: 1500,            // 孤獨觸發時間
  cooldownMs: 3000,          // 冷卻時間
  maxCount: 3,               // 召集數量
  searchRadius: 1000,        // 搜尋範圍
  engagedRadius: 150         // 身邊檢測範圍
};
```

### **實驗性調整**
- **觸發時間**: 調整`lonelyMs`改變召集敏感度
- **召集數量**: 調整`maxCount`控制戰鬥密度
- **搜尋範圍**: 調整`searchRadius`影響召集距離

## 🚀 **上線記錄**

### **智能召集系統** (03286bc)
- **核心功能**: 玩家身邊完全沒怪持續1.5秒，召集附近最近3隻閒置怪
- **多人支援**: 依座位順序分配，防止搶奪機制
- **綁定機制**: 召集中怪物綁定特定玩家，不受活動範圍限制
- **平衡設計**: 原速移動，3秒冷卻，15秒超時

### **特殊行為**
- **目標專一**: 召集中不重綁目標，直到到達或超時
- **主動仇恨**: 被召集怪物標記為主動仇恨狀態
- **位置更新**: 召集結束後以當下位置為新出生點

## 參考檔案

- `controllers/EnemyRallyController.ts` - 召集系統核心控制器
- `objects/Enemy.ts` - 怪物召集狀態和行為
- `config.ts` - 召集系統配置參數  
- `scenes/GameScene.ts` - 遊戲場景整合
- commit 03286bc - 召集系統實作

**智能召集系統確保每位玩家都有持續的戰鬥體驗！**
