# 戰鬥平衡系統 (Combat Balance System)

**系統概述**：遊戲戰鬥節奏、敵人數值、玩家能力的綜合平衡設計，確保挑戰性與可玩性的最佳平衡點，通過數據驅動的調整方法持續優化遊戲體驗。

## ⚡ **最新平衡調整** (eb9592c)

### **怪物移動速度提升** (2026-10-12)
基於戰鬥節奏優化需求，怪物移動速度全面提升約+22%：

```typescript
// config.ts - 敵人移動速度調整 (eb9592c)
const enemySpeedBalance = {
  /** 一般近戰怪：90 → 110 (+22%) */
  normal: {
    speed: 110,           // 原90，提升20點
    maxHp: 90,           // 血量不變
    radius: 14           // 體型不變
  },
  
  /** 肉盾坦克：52 → 64 (+23%) */  
  tank: {
    speed: 64,            // 原52，提升12點
    maxHp: 200,          // 血量不變
    radius: 22           // 體型不變
  },
  
  /** 投擲兵：72 → 88 (+22%) */
  bomber: {
    speed: 88,            // 原72，提升16點
    maxHp: 60,           // 血量不變
    radius: 15           // 體型不變
  }
};
```

### **速度比例平衡分析**
```typescript
/**
 * 玩家vs敵人速度比例計算：
 * - 玩家移動速度：400px/幀
 * - 最快敵人(一般怪)：110px/幀  
 * - 速度比例：400/110 ≈ 3.6:1
 * - 平衡結果：玩家仍有明顯速度優勢，可風箏走位
 */
interface SpeedRatioAnalysis {
  playerSpeed: 400,
  enemySpeedMax: 110,
  speedRatio: 3.64,      // 玩家速度是最快敵人的3.6倍
  tacticalAdvantage: 'significant'  // 玩家保持顯著速度優勢
}
```

## 📊 **歷史平衡演進**

### **怪物速度調整歷程**
```typescript
/**
 * 怪物移動速度演進記錄：
 * 
 * Phase 1 (初始版本):
 * - 一般怪: 70px/幀
 * - 坦克: ~45px/幀 (估算)
 * - 投擲兵: ~58px/幀 (估算)
 * 
 * Phase 2 (8a7f14b提升):  
 * - 一般怪: 70 → 90 (+28%)
 * - 坦克: 45 → 52 (+16%)
 * - 投擲兵: 58 → 72 (+24%)
 * 
 * Phase 3 (eb9592c再提升):
 * - 一般怪: 90 → 110 (+22%)
 * - 坦克: 52 → 64 (+23%) 
 * - 投擲兵: 72 → 88 (+22%)
 * 
 * 累計變化 (原始→最新):
 * - 一般怪: +57% (70→110)
 * - 坦克: +42% (45→64)
 * - 投擲兵: +52% (58→88)
 */
interface SpeedEvolutionHistory {
  phase1: { normal: 70, tank: 45, bomber: 58 },    // 初始版本
  phase2: { normal: 90, tank: 52, bomber: 72 },    // 8a7f14b
  phase3: { normal: 110, tank: 64, bomber: 88 },   // eb9592c (current)
  
  totalIncrease: {
    normal: '+57%',
    tank: '+42%',
    bomber: '+52%'
  }
}
```

## ⚖️ **平衡設計原則**

### **速度階層設計**
```typescript
/**
 * 敵人速度階層邏輯：
 * - 投擲兵(88) > 一般怪(110) > 坦克(64)
 * - 錯誤：投擲兵應該是最慢的(保持距離型)
 * - 設計意圖：一般怪最快(近戰追擊)，坦克最慢(肉盾)
 */
interface SpeedHierarchyDesign {
  /** 理想階層 (需要調整) */
  intended: {
    fastest: 'normal',     // 一般怪最快追擊
    medium: 'bomber',      // 投擲兵中速
    slowest: 'tank'        // 坦克最慢
  },
  
  /** 當前實際 (存在問題) */
  current: {
    fastest: 'normal: 110',   // ✅ 正確
    medium: 'bomber: 88',     // ❌ 應該更慢
    slowest: 'tank: 64'       // ✅ 正確
  }
}
```

### **戰鬥節奏平衡**
```typescript
/**
 * 戰鬥節奏目標：
 * - 提升敵人威脅感
 * - 縮短追逐時間  
 * - 增加戰鬥密度
 * - 保持玩家操作空間
 */
interface CombatPaceBalance {
  /** 威脅感提升 */
  threatIncrease: {
    chaseTime: '-22%',        // 追擊時間縮短
    escapeWindow: 'reduced',  // 逃脫窗口減少
    engagement: 'faster'      // 接敵速度提升
  },
  
  /** 操作空間保持 */
  playerAdvantage: {
    speedRatio: '3.6:1',      // 仍有3.6倍速度優勢
    kiting: 'viable',         // 風箏戰術可行
    positioning: 'critical'   // 走位更重要
  }
}
```

## 🎮 **難度曲線設計**

### **敵人類型角色定位**
```typescript
/**
 * 各敵人類型在戰鬥中的角色和平衡點：
 */
interface EnemyRoleBalance {
  /** 一般近戰怪 - 主要威脅 */
  normal: {
    role: 'primary_threat',
    speed: 110,              // 最快追擊
    hp: 90,                  // 中等血量
    spawnWeight: 75,         // 主要數量
    tactics: 'rush_player'   // 直衝玩家
  },
  
  /** 坦克 - 肉盾阻擋 */
  tank: {
    role: 'blocker',
    speed: 64,               // 慢速移動
    hp: 200,                 // 高血量
    spawnWeight: 12,         // 少量出現
    tactics: 'block_escape'  // 阻擋逃跑路線
  },
  
  /** 投擲兵 - 遠程騷擾 */
  bomber: {
    role: 'ranged_harass',
    speed: 88,               // 中速保距
    hp: 60,                  // 低血量
    spawnWeight: 8,          // 最少數量
    tactics: 'keep_distance' // 保持距離投擲
  }
}
```

### **生成權重平衡**
```typescript
/**
 * 敵人生成權重設計：
 * - 一般怪75% : 主要戰鬥對象
 * - 坦克12% : 偶爾出現增加變化
 * - 投擲兵8% : 少量遠程威脅
 * 總計95% (其他5%為特殊敵人或BOSS)
 */
const spawnWeightBalance = {
  normal: 75,    // 主力軍團
  tank: 12,      // 偶爾阻擋
  bomber: 8,     // 遠程騷擾
  total: 95,     // 常規敵人總權重
  special: 5     // 特殊敵人預留
};
```

## 📈 **性能與體驗影響**

### **戰鬥節奏提升效果**
```typescript
/**
 * 速度提升對遊戲體驗的影響：
 */
interface PaceImpactAnalysis {
  /** 正面影響 */
  positiveEffects: {
    engagementSpeed: '+22%',    // 接戰速度提升
    combatDensity: 'increased', // 戰鬥密度增加
    threatLevel: 'enhanced',    // 威脅感增強
    gameplayTempo: 'faster'     // 整體節奏加快
  },
  
  /** 需要監控的風險 */
  potentialRisks: {
    difficultySpike: 'possible',     // 可能難度突增
    newPlayerBarrier: 'higher',      // 新手門檻提高
    fatigueFactor: 'increased',      // 疲勞度增加
    balanceStability: 'uncertain'    // 平衡穩定性待觀察
  }
}
```

### **多人遊戲影響**
```typescript
/**
 * 速度調整對多人協作的影響：
 */
interface MultiplayerImpact {
  /** 協作需求變化 */
  cooperationChanges: {
    teamwork: 'more_critical',    // 團隊配合更重要
    positioning: 'tighter',       // 站位要求更嚴格
    communication: 'faster',      // 溝通節奏加快
    rescue: 'more_difficult'      // 救援難度增加
  },
  
  /** CREDIT系統整合 */
  creditSystemSynergy: {
    coinValue: 'unchanged',       // 投幣價值不變
    attackCost: 'unchanged',      // 攻擊成本不變  
    survivalTime: 'decreased',    // 生存時間可能縮短
    tacticalDepth: 'increased'    // 戰術深度增加
  }
}
```

## 🔧 **調試與監控**

### **平衡數據監控**
```typescript
/**
 * 戰鬥平衡監控指標：
 */
interface BalanceMetrics {
  /** 核心KPI */
  coreMetrics: {
    playerSurvivalTime: number,      // 玩家平均存活時間
    enemyEngagementRate: number,     // 敵人接戰成功率
    combatDuration: number,          // 戰鬥持續時間
    difficultyRating: number         // 主觀難度評級
  },
  
  /** 速度相關指標 */
  speedMetrics: {
    chaseSuccessRate: number,        // 追擊成功率
    escapeSuccessRate: number,       // 逃脫成功率
    averageChaseTime: number,        // 平均追擊時間
    kitingEffectiveness: number      // 風箏戰術有效性
  }
}
```

### **平衡驗證工具**
```typescript
/**
 * F9除錯面板平衡資訊顯示：
 */
function getBalanceDebugInfo(): string[] {
  return [
    `Enemy Speed: Normal=${GameConfig.enemy.types.normal.speed}, Tank=${GameConfig.enemy.types.tank.speed}, Bomber=${GameConfig.enemy.types.bomber.speed}`,
    `Player Speed: ${GameConfig.player.speed} (Ratio vs fastest enemy: ${(GameConfig.player.speed / Math.max(...enemySpeeds)).toFixed(2)}:1)`,
    `Combat Pace: ${this.calculateCombatPace()}`,
    `Difficulty Index: ${this.calculateDifficultyIndex()}`
  ];
}
```

## 🚀 **未來平衡規劃**

### **後續調整方向**
```typescript
/**
 * 基於eb9592c調整結果的後續優化計劃：
 */
interface FutureBalancePlan {
  /** 短期監控 (1-2週) */
  shortTerm: {
    playerFeedback: 'collect',       // 收集玩家反饋
    difficultyAnalysis: 'analyze',   // 分析難度變化
    survivalRate: 'monitor',         // 監控存活率
    balanceStability: 'assess'       // 評估平衡穩定性
  },
  
  /** 中期調整 (1個月) */
  mediumTerm: {
    finetuning: 'possible',          // 可能的微調
    roleBalance: 'redefine',         // 重新定義角色平衡
    newMechanics: 'consider',        // 考慮新機制
    dataValidation: 'comprehensive'   // 全面數據驗證
  },
  
  /** 長期規劃 (3個月+) */
  longTerm: {
    adaptiveBalance: 'implement',     // 實現自適應平衡
    playerSkill: 'segment',          // 玩家技能分層
    dynamicDifficulty: 'design',     // 動態難度設計
    competitiveBalance: 'establish'   // 建立競技平衡
  }
}
```

### **平衡實驗框架**
```typescript
/**
 * 系統化的平衡調整實驗框架：
 */
interface BalanceExperimentFramework {
  /** A/B測試支援 */
  abTesting: {
    configToggle: boolean,           // 配置切換支援
    playerSegmentation: string[],    // 玩家分組
    metricTracking: string[],        // 指標追蹤
    resultAnalysis: 'automated'      // 自動化結果分析
  },
  
  /** 數據驅動決策 */
  datadriven: {
    telemetryCollection: 'realtime', // 實時遙測收集
    statisticalAnalysis: 'advanced', // 高級統計分析
    predictionModel: 'ml_based',     // ML預測模型
    optimizationLoop: 'continuous'   // 持續優化循環
  }
}
```

## 參考檔案

- `config.ts:600-630` - 敵人基礎數值配置 (speed, hp, radius)
- `config.ts:775-779` - 怪物生成權重和階段配置
- `scenes/GameScene.ts` - 戰鬥邏輯實現和平衡應用
- `controllers/EnemyController.ts` - 敵人行為控制邏輯
- `wiki/systems/combat-system.md` - 戰鬥系統技術文檔
- `wiki/systems/credit-system.md` - CREDIT系統與戰鬥平衡整合

**戰鬥平衡系統確保持續優化的遊戲體驗！**
