# 仇恨機制系統 (Enemy Targeting & Aggro System)

**系統概述**：基於DouPo仇恨系統設計的怪物目標選擇和仇恨管理機制，實現黏著式目標綁定、主被動仇恨分類，以及多人遊戲的公平戰鬥體驗。

## 🎯 **核心仇恨機制**

### **黏著目標系統** (仿DouPo設計)
怪物生成時綁定最近角色，之後黏著不亂換，解決「別人走一圈把怪吸走」的問題：

```typescript
/**
 * 黏著目標(階段1):決定一隻怪這一幀要追誰。優先序 = 【事件覆寫 > 黏著綁定 > 就近重綁】。
 * - 事件波(守護)：一般怪強制打 guardNpc(忽略黏著)。BOSS/塔/NPC 不套用。
 * - 黏著:讀 targetSeat 綁定角色;若目標死/移除 → 立即重綁最近。
 *   若目標存活但距離 > stickyBreakRadius 持續 stickyBreakSec → 才重綁最近(防抖);否則黏著不換。
 */
interface EnemyTargetSystem {
  /** 綁定角色在 GameScene.characters 的 index(-1=未綁) */
  targetSeat: number;
  
  /** 目標超距的起始時間戳(0=未超距);達門檻才解鎖重綁,防抖 */
  stickyOutOfRangeSince: number;
}
```

### **仇恨分類系統**
區分主動仇恨和被動仇恨，實現不同的戰鬥行為：

```typescript
interface AggroClassification {
  /** 主動仇恨:被玩家攻擊命中/鎖定過→true。主動怪不計入「單角色被動警戒上限」、永遠可追 */
  aggroActive: boolean;
  
  /** 被動怪(aggroActive=false 因 alertRadius 自己進 chase)才計入上限 */
  aggroCapPassive: number; // 單一角色最多同時被15隻被動怪盯上
}
```

## 🔧 **技術實作**

### **目標解析邏輯** (GameScene.resolveEnemyTarget)
```typescript
private resolveEnemyTarget(enemy: Enemy, time: number): Character | { x: number; y: number } | null {
  // ① 事件覆寫(最高優先):守護事件期間一般怪打 NPC
  const guardNpc = this.eventCtl.guardNpc;
  if (this.waveState === 'event' && this.eventCtl.kind === 'guard' && guardNpc && guardNpc.active &&
      !isFixedEnemy(enemy)) {
    return guardNpc;
  }
  
  // ② 黏著綁定
  const cfg = GameConfig.enemySticky;
  let seat = enemy.targetSeat;
  let bound: Character | null = (seat >= 0 && seat < this.characters.length) ? this.characters[seat] : null;
  
  // 目標死/移除 → 立即重綁最近（召集中的怪結束召集）
  if (!bound || !bound.alive) {
    enemy.endRally();
    seat = this.nearestSeat(enemy.x, enemy.y);
    enemy.targetSeat = seat;
    enemy.stickyOutOfRangeSince = 0;
    bound = (seat >= 0) ? this.characters[seat] : null;
    return bound;
  }
  
  // 召集中：一路追綁定的玩家，不重綁
  if (enemy.isRallying()) return bound;
  
  // 目標存活但超距(>stickyBreakRadius)持續 stickyBreakSec → 才重綁(防抖);否則黏著
  const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, bound.x, bound.y);
  if (dist > cfg.stickyBreakRadius) {
    if (enemy.stickyOutOfRangeSince === 0) enemy.stickyOutOfRangeSince = time;
    else if (time - enemy.stickyOutOfRangeSince >= cfg.stickyBreakSec * 1000) {
      seat = this.nearestSeat(enemy.x, enemy.y);
      enemy.targetSeat = seat;
      enemy.stickyOutOfRangeSince = 0;
      bound = (seat >= 0) ? this.characters[seat] : bound;
    }
  } else {
    enemy.stickyOutOfRangeSince = 0; // 回到範圍內→清超距計時
  }
  
  return bound;
}
```

### **BOSS仇恨特殊規則**
BOSS擁有不同於一般怪物的仇恨機制：

```typescript
// BOSS目標選擇邏輯
class BossTargeting {
  /** BOSS初始鎖定最近玩家 */
  private initializeTarget(): void {
    const nearestSeat = this.host.nearestSeat(this.boss.x, this.boss.y);
    this.boss.targetSeat = 0; // BOSS預設鎖定P1，或使用nearestSeat
  }
  
  /** BOSS黏著機制 - 800px黏著距離 */
  private updateTarget(): void {
    const currentTarget = this.getCurrentTarget();
    const distance = this.getDistanceToTarget(currentTarget);
    
    // BOSS使用相同的800px黏著機制
    if (distance > GameConfig.enemySticky.stickyBreakRadius) {
      // 開始計時，持續1秒後才重新選擇目標
      this.startBreakTimer();
    }
  }
  
  /** BOSS不依傷害轉移仇恨，只依距離和時間 */
  private shouldSwitchTarget(): boolean {
    // BOSS仇恨轉移不看傷害，只看距離超出800px持續1秒
    return this.breakTimer >= GameConfig.enemySticky.stickyBreakSec * 1000;
  }
}
```

## ⚙️ **配置參數**

### **黏著目標配置**
```typescript
// config.ts - enemySticky 黏著目標系統
const enemySticky = {
  /** 綁定目標超過此距離(像素)才【可能】解鎖重綁(需持續 stickyBreakSec)。設大(遠)→很黏 */
  stickyBreakRadius: 800,
  
  /** 超距需【持續】幾秒才真的重綁(防抖:短暫拉開不換目標) */
  stickyBreakSec: 1
};
```

### **仇恨警戒配置**
```typescript
// config.ts - 仇恨警戒上限
const aggroConfig = {
  /** 仇恨警戒上限:單一角色(seat)最多同時被幾隻【被動】怪盯上(進 chase) */
  /** 被動=自己因 alertRadius 進範圍而追;主動=被玩家攻擊命中/鎖定過(aggroActive)→不計入、永遠可追 */
  aggroCapPassive: 15
};
```

## 🎮 **仇恨機制特色**

### **DouPo vs Miraculous 對比**
根據問騎分析，兩套仇恨系統的關鍵差異：

**DouPo系統** (當前採用):
- ✅ **黏著式綁定**: 怪物生成時綁定最近角色，之後黏著不換
- ✅ **800px黏著機制**: 目標超出800px持續1秒才重新綁定
- ✅ **防抖設計**: 避免「別人走一圈把怪吸走」的問題
- ✅ **不依傷害**: 仇恨轉移不看傷害，只看距離和時間

**Miraculous系統** (對比參考):
- 🔄 **動態仇恨**: 根據傷害、距離等因素動態計算仇恨值
- 🔄 **實時切換**: 仇恨值變化時立即切換目標
- 🔄 **複雜算法**: 多因素權重計算，更真實但複雜

### **當前系統優勢**
- **穩定性**: 黏著機制提供穩定的戰鬥體驗，目標不會頻繁跳躍
- **可預測性**: 玩家能預期怪物會追擊特定角色，便於戰略規劃
- **多人友好**: 避免怪物被其他玩家「搶走」，確保每人都有怪可打
- **性能優化**: 簡單的距離判斷比複雜仇恨計算更高效

## 🔄 **仇恨觸發機制**

### **主動仇恨觸發**
```typescript
// 玩家攻擊或鎖定怪物時觸發主動仇恨
function triggerActiveAggro(enemy: Enemy, attacker: Character): void {
  enemy.aggroActive = true; // 標記為主動仇恨
  enemy.targetSeat = attacker.seatIndex; // 綁定攻擊者
  enemy.stickyOutOfRangeSince = 0; // 重置超距計時
}

// 主動仇恨怪物特權
function hasActiveAggroPrivilege(enemy: Enemy): boolean {
  return enemy.aggroActive; // 不計入被動警戒上限、永遠可追
}
```

### **被動仇恨觸發**
```typescript
// 怪物因警戒範圍進入追擊狀態
function triggerPassiveAggro(enemy: Enemy): boolean {
  if (this.getPassiveAggroCount(enemy.targetSeat) >= GameConfig.aggroCapPassive) {
    return false; // 該玩家的被動仇恨已滿
  }
  
  enemy.aggroActive = false; // 標記為被動仇恨
  return true; // 可以進入追擊狀態
}
```

## 🔍 **特殊仇恨情況**

### **召集系統整合**
```typescript
// 智能召集系統與仇恨機制的整合
function rallyEnemyToPlayer(enemy: Enemy, targetSeat: number): void {
  enemy.targetSeat = targetSeat; // 綁定被召集的玩家
  enemy.aggroActive = true;      // 標為主動仇恨
  enemy.startRally(targetSeat, rallyTimeout); // 開始召集狀態
}

// 召集中的怪物仇恨特性
function isRallyingEnemy(enemy: Enemy): boolean {
  return enemy.isRallying() && enemy.aggroActive; // 召集中且主動仇恨
}
```

### **事件仇恨覆蓋**
```typescript
// 守護事件期間的特殊仇恨規則
function getEventOverrideTarget(enemy: Enemy): Character | GameObject | null {
  if (this.waveState === 'event' && this.eventCtl.kind === 'guard') {
    const guardNpc = this.eventCtl.guardNpc;
    if (guardNpc && guardNpc.active && !isFixedEnemy(enemy)) {
      return guardNpc; // 事件優先級最高，覆蓋黏著機制
    }
  }
  return null;
}
```

## 📊 **性能與平衡**

### **性能優化**
- **簡單距離計算**: 避免複雜的仇恨值計算
- **防抖機制**: 減少頻繁的目標切換和計算
- **上限控制**: 被動仇恨上限避免單一玩家被過多怪物圍攻

### **遊戲平衡**
- **多人公平**: 每個玩家都有穩定的怪物分配
- **戰略深度**: 玩家可利用黏著機制進行走位策略
- **BOSS挑戰**: BOSS使用相同機制但通常鎖定P1，增加主玩家壓力

## 🔍 **除錯與監控**

### **仇恨狀態除錯**
```typescript
// F9除錯面板顯示仇恨資訊
private aggroDebugInfo(): string[] {
  return this.enemies.children.entries.map(enemy => {
    const e = enemy as Enemy;
    return `Enemy ${e.name}: Seat=${e.targetSeat}, Active=${e.aggroActive}, Rally=${e.isRallying()}`;
  });
}
```

### **黏著機制監控**
```typescript
// 監控黏著機制狀態
private stickyDebugInfo(): string[] {
  return [
    `Sticky Break Radius: ${GameConfig.enemySticky.stickyBreakRadius}px`,
    `Sticky Break Time: ${GameConfig.enemySticky.stickyBreakSec}s`,
    `Passive Aggro Cap: ${GameConfig.aggroCapPassive}`,
    `Active Aggro Enemies: ${this.getActiveAggroCount()}`
  ];
}
```

## 🚀 **系統演進記錄**

### **DouPo仇恨系統基礎** (持續演進)
- **黏著機制**: 生成時綁定最近角色，800px+1秒的解綁條件
- **仇恨分類**: 主動/被動仇恨區分，不同的追擊規則
- **防抖設計**: 避免目標頻繁跳躍，提供穩定體驗

### **智能召集系統整合** (03286bc)
- **召集仇恨**: 被召集的怪物自動獲得主動仇恨
- **目標綁定**: 召集期間強制綁定特定玩家
- **優先級**: 召集狀態覆蓋一般黏著機制

### **多人仇恨平衡** (持續優化)
- **公平分配**: 確保每個玩家都有適量的怪物對手
- **上限控制**: 被動仇恨上限避免過度聚集
- **BOSS特殊**: BOSS通常優先攻擊P1，增加主玩家挑戰

## 參考檔案

- `objects/Enemy.ts` - 仇恨狀態定義 (targetSeat, aggroActive)
- `scenes/GameScene.ts` - 目標解析邏輯 (resolveEnemyTarget)
- `config.ts` - 仇恨系統配置 (enemySticky, aggroCapPassive)
- `controllers/EnemyRallyController.ts` - 召集系統仇恨整合
- `controllers/BossController.ts` - BOSS仇恨機制

**仇恨機制系統確保公平穩定的多人戰鬥體驗！**
