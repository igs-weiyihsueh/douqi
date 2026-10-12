# COMBO連擊系統 (Combo & Hit Streak System)

**系統概述**：HIT連擊計數和COMBO獎勵系統，追蹤玩家連續命中敵人的表現，提供即時回饋和彩票獎勵機制，增強遊戲的節奏感和成就感，鼓勵持續攻擊和技巧提升。

## 🎯 **HIT連擊核心機制**

### **連擊計數系統**
```typescript
/**
 * HIT連擊計算邏輯：
 * - 連續命中：每次攻擊命中敵人 +1 HIT
 * - 中斷機制：連續2秒沒命中重置為0
 * - 警告系統：1.5秒沒命中開始閃爍警告
 * - 彩票獎勵：特定HIT數觸發彩票獎勵
 */
interface HitStreakSystem {
  /** 連擊狀態 */
  currentStreak: number;        // 當前連擊數
  lastHitTime: number;         // 最後命中時間
  isWarning: boolean;          // 是否處於警告狀態
  
  /** 時間閾值配置 */
  STREAK_TIMEOUT_MS: 2000;     // 2秒沒命中中斷連擊
  WARNING_START_MS: 1500;      // 1.5秒沒命中開始警告
  
  /** 連擊更新邏輯 */
  onEnemyHit(time: number): void {
    this.currentStreak++;
    this.lastHitTime = time;
    this.isWarning = false;
    this.checkLotteryTrigger();
  }
  
  /** 每幀更新檢查 */
  update(time: number): void {
    const timeSinceHit = time - this.lastHitTime;
    
    if (timeSinceHit >= this.STREAK_TIMEOUT_MS) {
      // 超時中斷連擊
      this.currentStreak = 0;
      this.isWarning = false;
    } else if (timeSinceHit >= this.WARNING_START_MS) {
      // 進入警告狀態
      this.isWarning = true;
    }
  }
}
```

### **彩票獎勵觸發**
```typescript
/**
 * HIT數彩票獎勵系統：
 * - 5 HIT: 1張彩票
 * - 10 HIT: 3張彩票  
 * - 20 HIT: 10張彩票
 * - 50 HIT: 50張彩票
 * - 100 HIT: 100張彩票
 */
class LotteryRewardSystem {
  /** 獎勵階梯配置 */
  private readonly REWARD_THRESHOLDS = [
    { hits: 5, tickets: 1 },
    { hits: 10, tickets: 3 },
    { hits: 20, tickets: 10 },
    { hits: 50, tickets: 50 },
    { hits: 100, tickets: 100 }
  ];
  
  /** 檢查彩票觸發 */
  checkLotteryTrigger(currentHits: number, previousHits: number): number {
    let ticketsEarned = 0;
    
    for (const threshold of this.REWARD_THRESHOLDS) {
      // 檢查是否剛好達到獎勵門檻
      if (currentHits >= threshold.hits && previousHits < threshold.hits) {
        ticketsEarned += threshold.tickets;
        this.triggerLotteryReward(threshold);
      }
    }
    
    return ticketsEarned;
  }
  
  /** 觸發彩票獎勵效果 */
  triggerLotteryReward(threshold: RewardThreshold): void {
    // 顯示獎勵動畫
    this.showRewardAnimation(threshold.tickets);
    
    // 播放獎勵音效
    this.playRewardSound(threshold.hits);
    
    // 更新彩票計數
    this.addLotteryTickets(threshold.tickets);
  }
}
```

## 🎨 **視覺回饋系統**

### **HIT數顯示邏輯** (UIScene整合)
```typescript
/**
 * 下方面板HIT數顯示 (與CREDIT系統整合)：
 * - 正常狀態：「HIT x15」白色顯示
 * - 警告狀態：1.5秒無命中橙紅交替閃爍
 * - 未進場時：位置被「投幣加入遊戲」提示佔用
 * - 連擊歸零：隱藏顯示直到下次命中
 */
class HitDisplaySystem {
  /** HIT數UI更新 (來自UIScene.updatePanelCombo) */
  updateHitDisplay(character: Character, index: number): void {
    const text = this.panelComboTexts[index];
    if (!text) return;
    
    // CREDIT系統整合：未進場時顯示投幣提示
    if (character?.creditState === 'absent') {
      this.showJoinPrompt(text);
      return;
    }
    
    const combo = character?.alive ? character.combo : undefined;
    
    // 無連擊或連擊歸零時隱藏
    if (!combo || combo.currentStreak === 0) {
      text.setVisible(false);
      return;
    }
    
    // 正常HIT顯示
    this.displayHitStreak(text, combo);
  }
  
  /** HIT數顏色和閃爍邏輯 */
  displayHitStreak(text: Phaser.GameObjects.Text, combo: ComboState): void {
    const cfg = this.PANEL_COMBO_CONFIG;
    const colors = this.OVERHEAD_UI_CONFIG.COLORS;
    
    let color = colors.COMBO_TEXT_NORMAL; // 預設白色
    
    // 警告狀態閃爍邏輯
    if (combo.isWarning) {
      const blinkOn = this.time.now % cfg.WARNING_BLINK_MS < cfg.WARNING_BLINK_MS / 2;
      color = blinkOn ? colors.COMBO_TEXT_CRITICAL : colors.COMBO_TEXT_WARNING;
    }
    
    // 設置文字和顏色
    this.setTextColor(text.setText(`HIT x${combo.currentStreak}`), color)
        .setVisible(true);
  }
}
```

### **警告閃爍效果**
```typescript
/**
 * HIT警告視覺效果：
 * - 觸發條件：1.5秒沒有命中敵人
 * - 閃爍模式：橙色(WARNING) ↔ 紅色(CRITICAL)交替
 * - 閃爍頻率：300ms週期 (WARNING_BLINK_MS)
 * - 結束條件：命中敵人或連擊中斷
 */
class WarningBlinkEffect {
  /** 計算閃爍顏色 */
  getWarningColor(time: number): string {
    const config = this.PANEL_COMBO_CONFIG;
    const colors = this.OVERHEAD_UI_CONFIG.COLORS;
    
    const blinkPhase = time % config.WARNING_BLINK_MS;
    const isBlinkOn = blinkPhase < (config.WARNING_BLINK_MS / 2);
    
    return isBlinkOn ? 
      colors.COMBO_TEXT_CRITICAL :   // 紅色 (#ff4444)
      colors.COMBO_TEXT_WARNING;     // 橙色 (#ff8c00)
  }
  
  /** 警告狀態判斷 */
  isWarningActive(combo: ComboState, currentTime: number): boolean {
    const timeSinceHit = currentTime - combo.lastHitTime;
    return timeSinceHit >= this.WARNING_START_MS && 
           timeSinceHit < this.STREAK_TIMEOUT_MS;
  }
}
```

## ⏱️ **時間控制系統**

### **連擊中斷機制**
```typescript
/**
 * 連擊中斷時間控制：
 * - 中斷時間：2000ms (STREAK_TIMEOUT_MS)
 * - 警告時間：1500ms (WARNING_START_MS) 
 * - 緩衝時間：500ms 警告期間 (2000-1500)
 */
class ComboTimingSystem {
  /** 時間閾值常數 */
  private readonly TIMING_CONFIG = {
    STREAK_TIMEOUT_MS: 2000,    // 連擊完全中斷時間
    WARNING_START_MS: 1500,     // 警告開始時間
    WARNING_DURATION_MS: 500,   // 警告持續時間 (2000-1500)
    WARNING_BLINK_MS: 300      // 警告閃爍週期
  };
  
  /** 連擊狀態更新 */
  updateComboState(combo: ComboState, currentTime: number): void {
    const timeSinceHit = currentTime - combo.lastHitTime;
    
    if (timeSinceHit >= this.TIMING_CONFIG.STREAK_TIMEOUT_MS) {
      // 超過2秒：完全中斷
      combo.currentStreak = 0;
      combo.isWarning = false;
      combo.lastHitTime = 0;
    } else if (timeSinceHit >= this.TIMING_CONFIG.WARNING_START_MS) {
      // 1.5-2秒：警告狀態
      combo.isWarning = true;
    } else {
      // 0-1.5秒：正常狀態
      combo.isWarning = false;
    }
  }
  
  /** 命中重置邏輯 */
  onEnemyHit(combo: ComboState, currentTime: number): void {
    combo.currentStreak++;
    combo.lastHitTime = currentTime;
    combo.isWarning = false;
    
    // 檢查彩票獎勵觸發
    this.checkRewardTrigger(combo.currentStreak);
  }
}
```

### **性能優化時間管理**
```typescript
/**
 * COMBO系統性能優化：
 * - 更新頻率控制：避免每幀計算
 * - 狀態變化檢測：只在必要時更新UI
 * - 批量處理：多角色狀態統一更新
 */
class ComboPerformanceManager {
  private lastUpdateTime: number = 0;
  private readonly UPDATE_INTERVAL = 50; // 20fps更新頻率
  
  /** 節流更新邏輯 */
  shouldUpdate(currentTime: number): boolean {
    if (currentTime - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
      this.lastUpdateTime = currentTime;
      return true;
    }
    return false;
  }
  
  /** 批量角色COMBO更新 */
  batchUpdateCombos(characters: Character[], currentTime: number): void {
    if (!this.shouldUpdate(currentTime)) return;
    
    characters.forEach(character => {
      if (character.alive && character.combo) {
        this.updateComboState(character.combo, currentTime);
      }
    });
  }
}
```

## 🎮 **遊戲整合機制**

### **戰鬥系統整合**
```typescript
/**
 * COMBO與戰鬥系統的深度整合：
 * - 攻擊命中觸發：每次成功命中敵人更新連擊
 * - 傷害計算影響：高連擊可能影響傷害加成
 * - 技能冷卻影響：連擊數影響特殊技能可用性
 */
interface CombatIntegration {
  /** 攻擊命中處理 */
  onAttackHit(attacker: Character, target: Enemy, damage: number): void {
    // 更新連擊計數
    this.comboSystem.onEnemyHit(attacker.combo, this.time.now);
    
    // 可能的連擊加成計算
    const comboBonus = this.calculateComboBonus(attacker.combo.currentStreak);
    const finalDamage = damage * (1 + comboBonus);
    
    // 應用傷害
    target.takeDamage(finalDamage);
  }
  
  /** 連擊傷害加成計算 */
  calculateComboBonus(streak: number): number {
    if (streak < 10) return 0;          // 10HIT以下無加成
    if (streak < 20) return 0.1;        // 10-19HIT: 10%加成
    if (streak < 50) return 0.2;        // 20-49HIT: 20%加成
    return 0.3;                         // 50HIT以上: 30%加成
  }
}
```

### **CREDIT系統協調**
```typescript
/**
 * COMBO與CREDIT系統的UI協調：
 * - 未進場狀態：HIT位置顯示「投幣加入遊戲」
 * - 遊玩狀態：正常顯示HIT計數
 * - 等待續關：HIT計數暫停，保持最後數值
 * - 重新進場：連擊計數保持或重置(配置決定)
 */
interface CreditComboCoordination {
  /** 狀態感知HIT顯示 */
  updateHitDisplay(character: Character): void {
    switch (character.creditState) {
      case 'absent':
        // 顯示投幣提示，隱藏HIT計數
        this.showJoinPrompt(character);
        break;
        
      case 'playing':
        // 正常顯示HIT計數
        this.showHitCounter(character);
        break;
        
      case 'waiting':
        // 暫停HIT計數更新，保持顯示
        this.pauseHitCounter(character);
        break;
    }
  }
  
  /** 投幣恢復連擊處理 */
  onCoinInsert(character: Character): void {
    if (GameConfig.combo.resetOnCoin) {
      // 投幣重置連擊
      character.combo.currentStreak = 0;
      character.combo.isWarning = false;
    }
    // 恢復連擊計數更新
    this.resumeHitCounter(character);
  }
}
```

## 🏆 **獎勵與成就系統**

### **彩票獎勵細節**
```typescript
/**
 * 彩票獎勵發放機制：
 */
class LotteryTicketRewards {
  /** 獎勵階梯詳細配置 */
  private readonly REWARD_SCHEDULE = [
    { 
      hits: 5, 
      tickets: 1, 
      rarity: 'common',
      message: '初級連擊！獲得 1 張彩票',
      color: '#ffffff'
    },
    { 
      hits: 10, 
      tickets: 3, 
      rarity: 'uncommon',
      message: '良好連擊！獲得 3 張彩票',
      color: '#00ff00'
    },
    { 
      hits: 20, 
      tickets: 10, 
      rarity: 'rare',
      message: '優秀連擊！獲得 10 張彩票',
      color: '#0080ff'
    },
    { 
      hits: 50, 
      tickets: 50, 
      rarity: 'epic',
      message: '史詩連擊！獲得 50 張彩票',
      color: '#8000ff'
    },
    { 
      hits: 100, 
      tickets: 100, 
      rarity: 'legendary',
      message: '傳奇連擊！獲得 100 張彩票',
      color: '#ff8000'
    }
  ];
  
  /** 獎勵動畫效果 */
  showRewardAnimation(reward: RewardConfig): void {
    // 創建獎勵文字動畫
    const rewardText = this.scene.add.text(
      this.character.x, 
      this.character.y - 100, 
      reward.message
    ).setStyle({
      fontSize: '32px',
      fontWeight: 'bold',
      color: reward.color,
      stroke: '#000000',
      strokeThickness: 4
    });
    
    // 彈出動畫效果
    this.scene.tweens.add({
      targets: rewardText,
      y: rewardText.y - 50,
      alpha: { from: 1, to: 0 },
      scale: { from: 1, to: 1.5 },
      duration: 2000,
      ease: 'Power2',
      onComplete: () => rewardText.destroy()
    });
  }
}
```

### **連擊統計與成就**
```typescript
/**
 * 連擊統計追蹤：
 */
interface ComboStatistics {
  /** 單局統計 */
  sessionStats: {
    maxStreak: number;           // 最高連擊
    totalHits: number;          // 總命中數
    averageStreak: number;      // 平均連擊長度
    lotteryTicketsEarned: number; // 獲得彩票數
  };
  
  /** 歷史統計 */
  historicalStats: {
    allTimeMaxStreak: number;    // 歷史最高連擊
    totalSessions: number;       // 總遊戲局數
    totalLotteryTickets: number; // 總彩票獲得
    averagePerformance: number   // 平均表現
  };
  
  /** 成就解鎖 */
  achievements: {
    firstBlood: boolean;         // 首次命中
    streak10: boolean;           // 10連擊
    streak50: boolean;           // 50連擊  
    streak100: boolean;          // 100連擊
    lotteryMaster: boolean;      // 彩票大師
  };
}
```

## ⚙️ **COMBO系統配置**

### **核心參數配置**
```typescript
// config.ts - COMBO系統配置
const comboConfig = {
  /** 時間控制參數 */
  timing: {
    streakTimeoutMs: 2000,      // 連擊中斷時間
    warningStartMs: 1500,       // 警告開始時間
    warningBlinkMs: 300,        // 警告閃爍週期
    updateIntervalMs: 50        // UI更新間隔
  },
  
  /** 彩票獎勵配置 */
  lotteryRewards: [
    { hits: 5, tickets: 1 },
    { hits: 10, tickets: 3 },
    { hits: 20, tickets: 10 },
    { hits: 50, tickets: 50 },
    { hits: 100, tickets: 100 }
  ],
  
  /** 視覺效果配置 */
  visual: {
    normalColor: '#ffffff',      // 正常HIT顏色
    warningColor: '#ff8c00',     // 警告顏色
    criticalColor: '#ff4444',    // 緊急顏色
    fontSize: 24,               // 字體大小
    strokeThickness: 3          // 描邊厚度
  },
  
  /** 遊戲性配置 */
  gameplay: {
    resetOnCoin: false,         // 投幣是否重置連擊
    resetOnDeath: true,         // 死亡是否重置連擊
    damageBonus: true,          // 是否啟用連擊傷害加成
    maxBonusPercent: 30         // 最大傷害加成百分比
  }
};
```

## 🚀 **系統演進記錄**

### **COMBO基礎系統** (持續演進)
```typescript
/**
 * COMBO連擊系統基礎：
 * - HIT計數邏輯：連續命中累加，超時重置
 * - 警告機制：1.5秒無命中視覺警告
 * - 彩票獎勵：多階段HIT數獎勵系統
 * - UI整合：下方面板顯示和狀態管理
 */
interface ComboFoundation {
  hitCounting: 'continuous_enemy_hit_tracking',
  warningSystem: '1.5s_visual_warning_mechanism',  
  lotteryRewards: 'multi_tier_ticket_rewards',
  uiIntegration: 'bottom_panel_display_system'
}
```

### **CREDIT系統整合** (df5cfde)
```typescript
/**
 * commit df5cfde: COMBO與CREDIT UI協調
 * - 位置共享：未進場時HIT位置顯示投幣提示
 * - 狀態感知：creditState驅動的智能UI切換
 * - 視覺層次：頭上倒數+下方HIT/提示的清晰分離
 * - 用戶體驗：直觀的狀態指示和操作引導
 */
interface CreditComboIntegration {
  positionSharing: 'hit_position_for_join_prompt',
  stateAware: 'creditState_driven_ui_switching',
  visualHierarchy: 'clear_overhead_panel_separation',
  userExperience: 'intuitive_state_indication'
}
```

## 🔍 **除錯與監控**

### **COMBO狀態監控**
```typescript
/**
 * F9除錯面板COMBO資訊：
 */
function getComboDebugInfo(): string[] {
  return this.characters.map(char => 
    `${char.name}: HIT=${char.combo.currentStreak}, Warning=${char.combo.isWarning}, Last=${char.combo.lastHitTime}`
  );
}

/**
 * COMBO性能監控：
 */
interface ComboPerformanceMetrics {
  updateFrequency: number,      // 更新頻率
  hitAccuracy: number,         // 命中準確度  
  averageStreak: number,       // 平均連擊長度
  warningRate: number         // 警告觸發率
}
```

## 參考檔案

- `scenes/UIScene.ts:1814-1840` - HIT數顯示邏輯 (updatePanelCombo)
- `objects/Character.ts` - COMBO狀態定義 (combo屬性)
- `controllers/CreditController.ts` - CREDIT與COMBO UI協調
- `config.ts` - COMBO時間參數配置 (STREAK_TIMEOUT_MS, WARNING_START_MS)
- `wiki/systems/credit-system.md` - CREDIT系統與COMBO整合
- `wiki/systems/ui-system.md` - UI系統COMBO顯示邏輯

**COMBO連擊系統提供即時回饋和持續激勵的遊戲體驗！**
