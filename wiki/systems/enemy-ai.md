# 敵人AI系統 (Enemy AI System)

**系統概述**：智能敵人行為控制系統，實現多樣化的敵人類型、戰術行為和場景適應性，包含目標選擇、移動邏輯、攻擊模式和特殊狀態處理，提供豐富的戰鬥體驗。

## 🤖 **最新AI優化** (4ea4419)

### **無目標狀態行為改善** (2026-10-12)
解決敵人無玩家時的異常行為問題：

```typescript
/**
 * 無目標行為優化：
 * - 原問題：場上沒有玩家時，敵人以自己位置為目標攻擊
 *   - 近戰怪：原地反覆出招 (實測多次蓄力)
 *   - 投擲怪：朝固定方向一路後退到邊界
 * - 新邏輯：改呼叫Enemy.updateIdle進行附近巡邏
 *   - 中斷蓄力和投擲蓄力
 *   - 結束召集狀態  
 *   - 附近巡邏不攻擊 (實測0次蓄力)
 */
class NoTargetBehavior {
  /** 無目標時的巡邏行為 */
  updateIdle(time: number): void {
    if (!this.runPreamble(time)) return;
    
    // 中斷所有攻擊行為
    this.cancelCharge();
    this.endRally();
    
    // 執行巡邏邏輯
    this.patrolStep(time);
  }
  
  /** 結束蓄力外觀和狀態 */
  cancelCharge(): void {
    this.chargeUntil = 0;
    this.chargeCircle?.setVisible(false);
    // 投擲怪特殊處理
    if (this.enemyType === 'bomber') {
      this.bombChargeUntil = 0;
    }
  }
}
```

### **投擲兵AI大幅改善** (4ea4419)
解決投擲兵發呆問題，提升戰鬥參與度：

```typescript
/**
 * 投擲兵智能追擊優化：
 * - 原問題：約70%時間停在活動範圍邊緣、射程外不動 (發呆)
 * - 新機制：目標在chaseRadius(900px)內時不受活動範圍限制
 * - 行為邏輯：走到射程內積極參戰，更遠才回出生點巡邏
 * - 實測效果：發呆率降至0%，戰鬥參與度大幅提升
 */
class BomberAI {
  /** 投擲兵智能追擊配置 */
  private readonly chaseConfig = {
    /** 追擊半徑：900px內無活動範圍限制 */
    chaseRadius: 900,
    
    /** 投擲射程：480px */
    throwRange: 480,
    
    /** 後退距離：200px以內後退 */
    retreatRange: 200,
    
    /** 偏好距離：300px保持距離 */
    preferRange: 300
  };
  
  /** 追擊決策邏輯 */
  shouldIgnoreActivityBounds(target: Character): boolean {
    const distance = Phaser.Math.Distance.Between(
      this.x, this.y, target.x, target.y
    );
    
    // 目標在900px內：無活動範圍限制，積極追擊到射程
    return distance <= this.chaseConfig.chaseRadius;
  }
  
  /** 投擲兵移動邏輯 */
  updateBomberMovement(target: Character, time: number): void {
    const distance = this.getDistanceToTarget(target);
    
    if (distance <= this.chaseConfig.retreatRange) {
      // 太近：後退
      this.moveAwayFromTarget(target);
    } else if (distance > this.chaseConfig.throwRange) {
      // 超出射程：追擊 (900px內忽略活動範圍)
      if (this.shouldIgnoreActivityBounds(target)) {
        this.moveTowardTarget(target);
      } else {
        this.returnToSpawnArea(); // 回出生點附近巡邏
      }
    } else {
      // 射程內：準備投擲
      this.prepareThrow(target, time);
    }
  }
}
```

## 🎯 **敵人類型AI特色**

### **一般近戰怪AI**
```typescript
/**
 * 近戰怪戰術特點：
 * - 直線衝鋒追擊
 * - 接近時蓄力攻擊
 * - 簡單但有效的威脅
 */
class NormalEnemyAI {
  /** 近戰追擊邏輯 */
  updateNormalBehavior(target: Character): void {
    const distance = this.getDistanceToTarget(target);
    
    if (distance <= GameConfig.enemy.chargeRange) {
      // 進入蓄力範圍
      this.startCharge(target);
    } else {
      // 直線追擊
      this.moveTowardTarget(target);
    }
  }
  
  /** 蓄力攻擊機制 */
  startCharge(target: Character): void {
    if (this.chargeUntil > 0) return; // 已在蓄力
    
    this.chargeUntil = this.scene.time.now + GameConfig.enemy.chargeMs;
    this.chargeTarget = { x: target.x, y: target.y };
    this.showChargeCircle();
  }
}
```

### **坦克型敵人AI**
```typescript
/**
 * 坦克戰術特點：
 * - 緩慢但穩定追擊
 * - 高血量肉盾角色
 * - 阻擋玩家逃跑路線
 */
class TankEnemyAI {
  /** 坦克移動邏輯 */
  updateTankBehavior(target: Character): void {
    // 坦克移動較慢但持續追擊
    this.moveTowardTarget(target, 0.8); // 80%速度
    
    // 坦克蓄力時間較長但傷害更高
    if (this.shouldStartCharge(target)) {
      this.startHeavyCharge(target);
    }
  }
  
  /** 重型蓄力攻擊 */
  startHeavyCharge(target: Character): void {
    this.chargeUntil = this.scene.time.now + GameConfig.enemy.tankChargeMs;
    this.chargeDamage = GameConfig.enemy.tankDamage;
  }
}
```

### **投擲兵AI (4ea4419優化)**
```typescript
/**
 * 投擲兵戰術特點 (最新優化)：
 * - 保持距離戰術
 * - 預測性投擲攻擊  
 * - 智能走位和射程控制
 * - 900px追擊半徑內積極參戰
 */
class BomberAI {
  /** 投擲兵核心行為循環 */
  updateBomberBehavior(target: Character, time: number): void {
    const distance = this.getDistanceToTarget(target);
    
    // 冷卻中的走位邏輯
    if (this.bombCooldownUntil > time) {
      this.updatePositioning(target, distance);
      return;
    }
    
    // 射程判斷和投擲邏輯
    if (distance >= this.config.retreatRange && 
        distance <= this.config.throwRange) {
      this.startBombCharge(target, time);
    } else {
      this.updatePositioning(target, distance);
    }
  }
  
  /** 智能走位系統 */
  updatePositioning(target: Character, distance: number): void {
    if (distance < this.config.retreatRange) {
      // 太近：後退到安全距離
      this.moveAwayFromTarget(target);
    } else if (distance > this.config.throwRange) {
      // 太遠：追擊到射程 (900px內無限制)
      if (distance <= this.config.chaseRadius) {
        this.moveTowardTarget(target);
      } else {
        this.returnToPatrol(); // 回巡邏區域
      }
    } else {
      // 理想距離：微調到偏好位置
      this.adjustToPreferredRange(target, distance);
    }
  }
  
  /** 預測性投擲攻擊 */
  startBombCharge(target: Character, time: number): void {
    this.bombChargeUntil = time + this.config.bombChargeMs;
    
    // 鎖定目標當前位置作為落點
    this.bombTarget = { x: target.x, y: target.y };
    
    // 顯示蓄力效果
    this.showBombChargeEffect();
  }
}
```

## 🔄 **AI狀態管理**

### **狀態轉換系統**
```typescript
/**
 * 敵人AI狀態機：
 * - idle: 巡邏狀態 (無目標)
 * - chase: 追擊狀態 (有目標)  
 * - charge: 蓄力狀態 (準備攻擊)
 * - attack: 攻擊狀態 (執行攻擊)
 * - retreat: 撤退狀態 (受到威脅)
 * - rally: 召集狀態 (被召集中)
 */
enum AIState {
  IDLE = 'idle',
  CHASE = 'chase', 
  CHARGE = 'charge',
  ATTACK = 'attack',
  RETREAT = 'retreat',
  RALLY = 'rally'
}

class EnemyAIStateMachine {
  private currentState: AIState = AIState.IDLE;
  
  /** 狀態更新邏輯 */
  updateState(target: Character | null, time: number): void {
    switch (this.currentState) {
      case AIState.IDLE:
        if (target) this.transitionTo(AIState.CHASE);
        else this.updateIdle(time); // 4ea4419新增巡邏
        break;
        
      case AIState.CHASE:
        if (!target) this.transitionTo(AIState.IDLE);
        else this.updateChase(target, time);
        break;
        
      case AIState.CHARGE:
        this.updateCharge(time);
        break;
        
      case AIState.ATTACK:
        this.updateAttack(time);
        break;
    }
  }
  
  /** 狀態轉換處理 */
  transitionTo(newState: AIState): void {
    this.exitCurrentState();
    this.currentState = newState;
    this.enterNewState(newState);
  }
}
```

### **目標選擇邏輯**
```typescript
/**
 * AI目標選擇與仇恨機制整合：
 */
class AITargetSelection {
  /** 目標有效性檢查 */
  isValidTarget(character: Character): boolean {
    return character.alive && 
           character.creditState === 'playing' &&  // CREDIT系統整合
           !character.isInvulnerable();
  }
  
  /** 最佳目標選擇 */
  selectBestTarget(): Character | null {
    const validTargets = this.scene.characters.filter(
      c => this.isValidTarget(c)
    );
    
    if (validTargets.length === 0) return null;
    
    // 依據仇恨機制選擇目標
    return this.aggroSystem.resolveTarget(this, validTargets);
  }
}
```

## 🧠 **智能行為特性**

### **群體協調AI**
```typescript
/**
 * 敵人群體智能：
 * - 避免重疊聚集
 * - 協調攻擊時機
 * - 包圍戰術執行
 */
class SwarmIntelligence {
  /** 避免聚集邏輯 */
  avoidCrowding(): void {
    const nearbyEnemies = this.getNearbyEnemies(100);
    if (nearbyEnemies.length > 2) {
      this.adjustPositionToAvoidCrowd(nearbyEnemies);
    }
  }
  
  /** 協調攻擊時機 */
  coordinateAttack(): boolean {
    const attackingNearby = this.countAttackingNearby();
    return attackingNearby < GameConfig.enemy.maxSimultaneousAttackers;
  }
}
```

### **適應性行為**
```typescript
/**
 * AI適應性機制：
 * - 根據玩家行為調整策略
 * - 學習玩家移動模式
 * - 動態難度調整
 */
class AdaptiveAI {
  /** 玩家行為分析 */
  analyzePlayerBehavior(player: Character): BehaviorPattern {
    return {
      movementSpeed: this.calculateAverageSpeed(player),
      preferredDirection: this.getPreferredDirection(player),
      attackFrequency: this.getAttackFrequency(player),
      evasionPattern: this.getEvasionPattern(player)
    };
  }
  
  /** 策略調整 */
  adjustStrategy(pattern: BehaviorPattern): void {
    if (pattern.evasionPattern === 'kiting') {
      this.increasePredictionAccuracy();
    }
    if (pattern.movementSpeed > this.speed) {
      this.improvePositioning();
    }
  }
}
```

## 🔧 **AI系統配置**

### **行為參數調整**
```typescript
// config.ts - 敵人AI配置
const enemyAIConfig = {
  /** 基礎AI參數 */
  baseAI: {
    alertRadius: 200,        // 警戒範圍
    chargeRange: 80,         // 蓄力範圍
    chargeMs: 800,          // 蓄力時間
    attackCooldown: 1200,    // 攻擊冷卻
    patrolRadius: 150,       // 巡邏範圍
    maxCrowdDistance: 100    // 最大聚集距離
  },
  
  /** 投擲兵專用配置 (4ea4419優化) */
  bomber: {
    moveEnabled: true,       // 啟用移動
    chaseRadius: 900,        // 追擊半徑 (新增)
    preferRange: 300,        // 偏好距離
    retreatRange: 200,       // 後退距離  
    throwRange: 480,         // 投擲射程
    bombChargeMs: 1200,      // 蓄力時間
    bombCooldownMs: 2200,    // 冷卻時間
    bombRadius: 90,          // 爆炸範圍
    bombDamage: 30          // 爆炸傷害
  },
  
  /** 群體智能參數 */
  swarm: {
    maxSimultaneousAttackers: 3,  // 同時攻擊者上限
    crowdAvoidanceStrength: 0.5,  // 避免聚集強度
    coordinationRadius: 150       // 協調半徑
  }
};
```

### **性能優化配置**
```typescript
/**
 * AI性能優化設定：
 */
const aiPerformanceConfig = {
  /** 更新頻率控制 */
  updateFrequency: {
    targetSelection: 500,    // 目標選擇間隔(ms)
    pathfinding: 100,       // 尋路更新間隔
    behaviorUpdate: 50,     // 行為更新間隔
    groupIntelligence: 200  // 群體智能間隔
  },
  
  /** LOD系統 */
  levelOfDetail: {
    highDetail: 300,        // 高精度範圍(px)
    mediumDetail: 600,      // 中精度範圍
    lowDetail: 1200,        // 低精度範圍
    cullingDistance: 2000   // 剔除距離
  }
};
```

## 🚀 **AI系統演進記錄**

### **基礎AI系統** (持續演進)
```typescript
/**
 * 敵人AI基礎架構：
 * - 多類型敵人行為系統
 * - 狀態機驅動的行為控制
 * - 目標選擇和仇恨機制整合
 * - 群體協調和避免聚集
 */
interface AIFoundation {
  enemyTypes: ['normal', 'tank', 'bomber'],
  stateMachine: AIStateMachine,
  targetSelection: AggroIntegrated,
  swarmIntelligence: GroupCoordination
}
```

### **無目標行為優化** (4ea4419)
```typescript
/**
 * commit 4ea4419: 無目標狀態AI改善
 * - 修復自我攻擊問題：改為附近巡邏
 * - 投擲兵發呆修復：900px追擊半徑無活動限制
 * - 代碼重構：拆出runPreamble、patrolStep、cancelCharge
 * - 實測效果：近戰怪0次蓄力，投擲怪發呆率0%
 */
interface NoTargetOptimization {
  /** 巡邏行為 */
  idleBehavior: 'patrol_instead_of_self_attack',
  
  /** 投擲兵改善 */
  bomberFix: 'chase_radius_900px_active_engagement',
  
  /** 代碼品質 */
  codeRefactoring: 'extracted_common_ai_methods',
  
  /** 測試結果 */
  effectiveness: 'zero_idle_attacks_confirmed'
}
```

### **智能追擊系統** (4ea4419)
```typescript
/**
 * 投擲兵智能追擊優化：
 * - 問題解決：70%發呆率→0%
 * - 新機制：chaseRadius內忽略活動範圍
 * - 戰術提升：積極參戰，合理走位
 * - 平衡保持：遠距離時回巡邏區域
 */
interface IntelligentChase {
  problemSolved: '70%_idle_rate_eliminated',
  newMechanic: '900px_chase_radius_boundary_ignore',
  tacticalImprovement: 'active_engagement_positioning',
  balanceMaintained: 'fallback_to_patrol_when_far'
}
```

## 🔍 **除錯與監控**

### **AI行為監控**
```typescript
/**
 * F9除錯面板AI資訊顯示：
 */
function getAIDebugInfo(): string[] {
  return this.enemies.children.entries.map(enemy => {
    const e = enemy as Enemy;
    return `${e.name}: State=${e.aiState}, Target=${e.targetSeat}, Charge=${e.chargeUntil > 0}`;
  });
}

/**
 * AI行為統計監控：
 */
interface AIBehaviorStats {
  /** 狀態分布統計 */
  stateDistribution: Map<AIState, number>;
  
  /** 攻擊成功率 */
  attackSuccessRate: number;
  
  /** 發呆時間統計 */
  idleTimePercentage: number;
  
  /** 投擲兵參戰率 */
  bomberEngagementRate: number;
}
```

### **性能監控指標**
```typescript
/**
 * AI系統性能監控：
 */
interface AIPerformanceMetrics {
  /** CPU使用率 */
  cpuUsage: {
    aiUpdate: number,         // AI更新CPU佔用
    pathfinding: number,      // 尋路計算佔用
    targetSelection: number   // 目標選擇佔用
  },
  
  /** 行為效率 */
  behaviorEfficiency: {
    averageResponseTime: number,    // 平均反應時間
    decisionAccuracy: number,       // 決策準確度
    movementEfficiency: number      // 移動效率
  }
}
```

## 參考檔案

- `objects/Enemy.ts` - 敵人AI核心實現 (updateIdle, runPreamble, patrolStep)
- `config.ts:698-730` - 投擲兵AI配置 (chaseRadius: 900px)
- `scenes/GameScene.ts` - AI系統整合和目標選擇邏輯
- `controllers/EnemyController.ts` - 敵人生成和管理控制
- `wiki/systems/aggro-system.md` - 仇恨機制與AI目標選擇整合
- `wiki/systems/credit-system.md` - CREDIT系統對AI目標判定影響

**敵人AI系統提供智能化、多樣化的戰鬥體驗！**
