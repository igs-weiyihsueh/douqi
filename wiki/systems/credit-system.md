# CREDIT投幣系統 (Credit Coin System)

**系統概述**：街機風格的投幣續關機制，取代傳統HP系統，每位玩家獨立計算CREDIT點數，通過C鍵投幣進場和續關，實現精準的攻擊成本控制和公平的多人遊戲體驗。

## 🔧 **最新系統優化** (4ea4419)

### **用戶回饋修正** (2026-10-12)
基於真實用戶試玩回饋，完成6項核心問題修正：

#### **1. UI顯示優化**
```typescript
// 投幣提示文字切割問題修復
const textOptimization = {
  /** 問題：粗體中文+黑邊描邊時字形上緣被切 */
  issue: 'text_clipping',
  
  /** 解決：上下留8px padding避免切割 */
  solution: 'vertical_padding_8px',
  
  /** 效果：「投幣開始」文字完整顯示 */
  result: 'complete_text_display'
};
```

#### **2. 攝影機跟隨邏輯**
```typescript
/**
 * 攝影機跟隨優化：
 * - 原問題：投幣前無目標，鏡頭停在原位
 * - 新邏輯：改跟未投幣/等待續關角色
 * - 開局效果：對準P1而不是停在原位
 */
interface CameraFollowOptimization {
  beforeFix: 'static_position_when_no_players',
  afterFix: 'follow_waiting_characters',
  startupBehavior: 'focus_on_p1_immediately'
}
```

#### **3. X鍵免費攻擊功能**
```typescript
/**
 * 免費攻擊模式：
 * - X鍵切換開關：攻擊不扣CREDIT
 * - 橫幅提示：「免費攻擊：開/關」
 * - 測試友好：便於體驗CREDIT機制
 */
class FreePlayMode {
  private freePlay: boolean = false;
  
  /** 切換免費攻擊模式 */
  toggleFreePlay(): boolean {
    this.freePlay = !this.freePlay;
    return this.freePlay;
  }
  
  /** 命中時根據模式決定是否扣CREDIT */
  onEnemyHit(character: Character): void {
    if (!this.freePlay && this.enabled) {
      character.credit = Math.max(0, character.credit - 1);
    }
  }
}
```

## 🪙 **核心投幣機制**

### **投幣進場流程**
角色從「尚未進場」到「遊玩中」的完整流程：

```typescript
/**
 * CREDIT系統三種狀態轉換：
 * absent(尚未進場) → 投幣 → playing(遊玩中) → CREDIT用完 → waiting(等待續關) → 投幣 → playing
 */
type CreditState = 'absent' | 'playing' | 'waiting';

interface CreditFlow {
  /** 初始狀態：角色隱藏，CREDIT=0 */
  setupCharacter(): void;
  
  /** C鍵投幣：+10 CREDIT，立刻進場+短暫無敵 */
  insertCoin(): void;
  
  /** CREDIT用完：停在原地+無敵+頭上顯示「投幣續關」 */
  enterWaiting(): void;
}
```

### **攻擊扣點機制**
精準的「一招一點」扣費系統：

```typescript
/**
 * 攻擊窗口機制：防止連續攻擊重複扣點
 * - 出手時開始1.5秒窗口期
 * - 窗口內第一次命中扣1點
 * - 空揮不扣點、一招打多怪也只扣1點
 */
class AttackCharge {
  /** 出手：開始扣點期限 */
  openAttackWindow(character: Character, time: number): void {
    character.chargeWindowUntil = time + GameConfig.credit.attackWindowMs; // 1500ms
  }
  
  /** 命中敵人：在窗口內且未扣過就扣1點 */
  onEnemyHit(character: Character, time: number): void {
    if (time >= character.chargeWindowUntil) return; // 窗口已過
    character.chargeWindowUntil = 0; // 標記已扣點
    character.credit = Math.max(0, character.credit - 1);
  }
}
```

### **多人獨立計算**
每個角色擁有獨立的CREDIT計數和狀態：

```typescript
// Character.ts 擴展屬性
interface Character {
  /** 當前CREDIT點數 */
  credit: number;
  
  /** 投幣狀態：absent/playing/waiting */
  creditState: CreditState;
  
  /** 攻擊窗口結束時間(0=已扣點或無窗口) */
  chargeWindowUntil: number;
  
  /** 啟用CREDIT時無血量損失 */
  noHpLoss: boolean;
}
```

## ⚙️ **技術實作架構**

### **CreditController核心邏輯**
```typescript
// controllers/CreditController.ts - 主控制器
export class CreditController {
  /** 新角色設置：CREDIT歸0，BOT自動投幣，玩家等待 */
  setupCharacter(c: Character): void {
    c.credit = 0;
    c.noHpLoss = true; // 無血量損失
    if (c.isBot) {
      this.insertCoin(c);
    } else {
      c.creditState = 'absent';
      c.leavePlay(); // 離開戰局
      this.host.setCharacterVisible(c, false); // 隱藏角色
    }
  }
  
  /** C鍵投幣：+10點，立即恢復戰鬥 */
  insertCoin(c: Character): void {
    c.credit += GameConfig.credit.coinValue; // +10
    if (c.creditState !== 'playing') {
      c.creditState = 'playing';
      this.host.prepareResume(c); // 回到場地
      c.resumePlay(); // 恢復戰鬥能力
      c.invulnUntil = time + GameConfig.credit.resumeInvulnMs; // 短暫無敵
    }
  }
  
  /** 每幀更新：處理待暫停角色+更新頭上提示 */
  update(): void {
    // CREDIT用完的角色進入等待狀態
    for (const c of this.pendingPause) {
      if (c.credit === 0 && c.creditState === 'playing') {
        c.creditState = 'waiting';
        c.leavePlay(); // 離開戰局但保持可見
      }
    }
    this.updatePrompts(); // 更新頭上投幣提示
  }
}
```

### **戰鬥系統整合**
```typescript
// scenes/GameScene.ts - 戰鬥整合
class GameScene {
  /** 角色攻擊時開始扣點窗口 */
  onCharacterAttack(character: Character): void {
    this.creditCtl.openAttackWindow(character, this.time.now);
  }
  
  /** 攻擊命中敵人時扣點 */
  onEnemyHit(character: Character, enemy: Enemy): void {
    this.creditCtl.onEnemyHit(character, this.time.now);
  }
  
  /** 變身BOSS攻擊不扣點 */
  onBossTransformAttack(character: Character): void {
    this.creditCtl.cancelAttackWindow(character);
  }
}
```

## 🎮 **遊戲體驗設計**

### **視覺回饋系統**
```typescript
// 頭上投幣提示配置 (最新優化 4ea4419)
const creditPromptConfig = {
  offsetY: -200,        // 角色頭上200px (eb9592c優化位置)
  fontSize: 30,         // 30px字體
  color: '#ffe066',     // 金黃色
  stroke: '#000000',    // 黑色描邊
  strokeThickness: 6,   // 6px描邊厚度
  blinkMs: 900,         // 0.9秒閃爍週期
  depth: 60,            // 顯示層級
  
  /** 4ea4419文字切割修復：上下留8px padding */
  verticalPadding: 8    // 避免粗體中文+描邊被切
};

// UI位置優化記錄
// eb9592c: 位置調整 -150px → -200px (避免與頭頂UI重疊)
// 4ea4419: 文字切割修復 (粗體中文+黑邊描邊上緣被切)

// 提示文字
const promptText = {
  joinText: '投幣開始',      // 尚未進場時顯示 (含padding修復)
  continueText: '投幣續關'   // CREDIT用完時顯示 (含padding修復)
};

// X鍵免費攻擊提示 (4ea4419新增)
const freePlayBanner = {
  text: '免費攻擊：開/關',   // 切換狀態橫幅提示
  toggleKey: 'X',          // 切換按鍵
  position: 'top_banner'   // 顯示位置
};
```

### **攝影機系統整合**
```typescript
/**
 * 攝影機跟隨邏輯優化 (4ea4419):
 * - 原問題：投幣前無玩家在場，鏡頭停在原位
 * - 新邏輯：改跟未投幣/等待續關的角色
 * - 開局體驗：立即對準P1，而不是停在地圖中心
 */
interface CameraIntegration {
  /** 跟隨目標優先級 */
  followPriority: {
    first: 'playing_characters',    // 優先跟隨遊玩中角色
    fallback: 'waiting_characters', // 回退跟隨等待角色  
    startup: 'focus_p1_immediately' // 開局立即對準P1
  },
  
  /** 無玩家狀態處理 */
  noPlayersBehavior: {
    before: 'static_camera_position', // 原本停在原位
    after: 'follow_waiting_players'   // 跟隨等待投幣角色
  }
}
```

### **免費攻擊測試模式**
```typescript
/**
 * X鍵免費攻擊功能 (4ea4419):
 * - 開發測試友好功能
 * - 便於體驗CREDIT機制而不消耗點數
 * - 橫幅提示清楚顯示開關狀態
 */
class FreeAttackMode {
  private freePlay: boolean = false;
  
  /** X鍵切換免費攻擊 */
  toggleFreePlay(): boolean {
    this.freePlay = !this.freePlay;
    this.showBanner(`免費攻擊：${this.freePlay ? '開' : '關'}`);
    return this.freePlay;
  }
  
  /** 命中敵人時的扣點邏輯 */
  onEnemyHit(character: Character, time: number): void {
    if (!this.enabled || character.creditState !== 'playing') return;
    if (time >= character.chargeWindowUntil) return;
    
    character.chargeWindowUntil = 0;
    
    // 免費攻擊模式下不扣CREDIT
    if (!this.freePlay) {
      character.credit = Math.max(0, character.credit - 1);
      if (character.credit === 0) {
        if (character.isBot) this.insertCoin(character);
        else this.pendingPause.add(character);
      }
    }
    
    this.host.onCreditChanged();
  }
}
```

## ⚡ **系統配置參數**

### **CREDIT核心配置**
```typescript
// config.ts - credit配置
const creditConfig = {
  /** 系統開關：true=CREDIT模式, false=傳統HP模式 */
  enabled: true,
  
  /** 投一次幣獲得的CREDIT點數 */
  coinValue: 10,
  
  /** 攻擊窗口時長：出手後1.5秒內命中算同一招 */
  attackWindowMs: 1500,
  
  /** 投幣恢復後無敵時長 */
  resumeInvulnMs: 1000,
  
  /** 頭上投幣提示配置 (eb9592c優化) */
  prompt: {
    offsetY: -200,           // 垂直偏移 (優化：避免與頭頂UI重疊)
    fontSize: 30,            // 字體大小  
    color: '#ffe066',        // 金黃色
    stroke: '#000000',       // 黑色描邊
    strokeThickness: 6,      // 描邊厚度
    blinkMs: 900,           // 閃爍週期
    depth: 60               // 顯示層級
  },
  
  /** 提示文字內容 */
  joinText: '投幣開始',        // 尚未進場
  continueText: '投幣續關'     // 等待續關
};
```

### **角色狀態擴展**
```typescript
// objects/Character.ts - CREDIT相關屬性
interface CharacterCreditProps {
  /** 當前CREDIT點數 */
  credit: number;
  
  /** 投幣狀態：absent(未進場)/playing(遊玩中)/waiting(等待續關) */
  creditState: 'absent' | 'playing' | 'waiting';
  
  /** 攻擊扣點窗口結束時間(0=已扣點) */
  chargeWindowUntil: number;
  
  /** 啟用CREDIT時無血量損失 */
  noHpLoss: boolean;
}
```

## 🤖 **BOT自動化機制**

### **BOT投幣邏輯**
```typescript
/**
 * BOT自動投幣系統：
 * - 加入時自動投幣進場
 * - CREDIT用完立即自動投幣
 * - 無需手動操作，提供連續遊戲體驗
 */
class BotCreditSystem {
  setupBot(bot: Character): void {
    bot.credit = 0;
    this.insertCoin(bot); // 立即投幣進場
  }
  
  onBotCreditEmpty(bot: Character): void {
    this.insertCoin(bot); // 自動投幣續關
  }
}
```

### **玩家操作控制**
```typescript
/**
 * P1玩家投幣控制：
 * - C鍵觸發投幣
 * - 必須手動投幣進場和續關
 * - 提供戰略思考時間
 */
class PlayerCreditControl {
  handleInput(keys: InputKeys): void {
    if (keys.C.justDown) {
      this.creditController.insertCoin(this.player1);
    }
  }
}
```

## 🔄 **系統整合影響**

### **HP系統移除**
CREDIT系統啟用時完全取代HP機制：

```typescript
/**
 * HP系統移除影響：
 * - 角色被攻擊不扣血量
 * - 不會因血量歸零而陣亡  
 * - 死亡判定完全由CREDIT控制
 * - noHpLoss標記控制此行為
 */
interface HpSystemRemoval {
  /** 被打時不扣血 */
  onTakeDamage(): void; // return early if noHpLoss
  
  /** 不會血量歸零死亡 */
  checkDeath(): boolean; // return false if noHpLoss
}
```

### **彩票系統分離**
COMBO和寶箱獎勵改為下方面板顯示：

```typescript
/**
 * 彩票獎勵顯示分離：
 * - CREDIT顯示：角色頭上
 * - COMBO/寶箱獎勵：下方面板
 * - 避免頭上資訊過於擁擠
 */
interface RewardDisplaySeparation {
  /** 頭上顯示：CREDIT點數 */
  overheadDisplay: ['credit', 'energyBar'];
  
  /** 下方面板：COMBO和寶箱獎勵 */
  bottomPanel: ['combo', 'treasureReward'];
}
```

### **敵人仇恨系統整合**
```typescript
/**
 * 仇恨系統整合：
 * - 離開戰局的角色(leavePlay)敵人不鎖定
 * - 等待續關時敵人忽略該角色
 * - 投幣恢復後重新進入仇恨計算
 */
interface AggroSystemIntegration {
  /** 檢查角色是否可被鎖定 */
  canTargetCharacter(character: Character): boolean {
    return character.alive && character.creditState === 'playing';
  }
}
```

## 📊 **性能與平衡**

### **攻擊成本平衡**
```typescript
/**
 * 攻擊成本設計：
 * - 投幣成本：10 CREDIT
 * - 攻擊成本：1 CREDIT/招(命中時)
 * - 理論遊戲時長：10招有效攻擊
 * - 空揮懲罰：無(鼓勵大膽攻擊)
 */
const attackCostBalance = {
  coinValue: 10,        // 一次投幣10點
  hitCost: 1,          // 每次命中1點
  missCost: 0,         // 空揮免費
  maxPlaysPerCoin: 10  // 每次投幣最多10次有效攻擊
};
```

### **多人公平性**
```typescript
/**
 * 多人遊戲公平性：
 * - 各角色獨立CREDIT計算
 * - BOT自動投幣避免中斷遊戲
 * - 玩家可選擇投幣時機
 * - 等待續關時不影響其他玩家
 */
interface MultiplayerFairness {
  /** 獨立CREDIT池 */
  independentCredit: Map<Character, number>;
  
  /** 角色狀態不互相影響 */
  isolatedStates: boolean;
  
  /** 遊戲可持續進行 */
  continuousGameplay: boolean;
}
```

## 🔧 **除錯與監控**

### **CREDIT狀態監控**
```typescript
/**
 * F9除錯面板CREDIT資訊顯示
 */
function getCreditDebugInfo(): string[] {
  return this.characters.map(char => 
    `${char.name}: CREDIT=${char.credit}, State=${char.creditState}, Window=${char.chargeWindowUntil}`
  );
}

/**
 * CREDIT系統狀態檢查
 */
interface CreditSystemDebug {
  /** 系統啟用狀態 */
  systemEnabled: boolean;
  
  /** 各角色CREDIT和狀態 */
  characterStates: CharacterCreditState[];
  
  /** 投幣提示顯示狀況 */
  promptsActive: Map<Character, boolean>;
  
  /** 攻擊窗口計時 */
  attackWindows: Map<Character, number>;
}
```

### **配置驗證**
```typescript
/**
 * CREDIT配置合理性檢查
 */
function validateCreditConfig(): ValidationResult {
  const cfg = GameConfig.credit;
  return {
    coinValueValid: cfg.coinValue > 0,
    windowTimeValid: cfg.attackWindowMs > 0,
    invulnTimeValid: cfg.resumeInvulnMs >= 0,
    promptConfigValid: cfg.prompt.fontSize > 0 && cfg.prompt.blinkMs > 0
  };
}
```

## 🚀 **系統演進記錄**

### **CREDIT系統優化記錄** (4ea4419)
```typescript
/**
 * commit 4ea4419: 用戶回饋驅動的6項修正
 * - UI文字切割修復: 投幣提示上下留8px padding
 * - 攝影機跟隨邏輯: 無玩家時跟隨等待角色，開局對準P1  
 * - X鍵免費攻擊: 測試模式，攻擊不扣CREDIT+橫幅提示
 * - 敵人AI優化: 無目標時巡邏而非攻擊自己
 * - 投擲怪改善: 900px內無活動範圍限制，發呆率降至0
 * - 代碼重構: Enemy類拆出runPreamble、patrolStep、cancelCharge
 */
interface CreditSystemRefinement {
  /** UI優化 */
  uiImprovements: {
    textClipping: 'fixed_with_vertical_padding',
    cameraFollow: 'improved_startup_behavior',
    freeAttackMode: 'added_x_key_toggle'
  },
  
  /** AI行為改善 */
  aiEnhancements: {
    noTargetBehavior: 'patrol_instead_of_self_attack', 
    bomberStuck: 'chase_radius_900px_no_limit',
    codeRefactoring: 'extracted_common_methods'
  },
  
  /** 品質評估 */
  qualityMetrics: {
    codeQuality: '99/100',      // 銳騎評分 (100→99輕微回退)
    userExperience: 'excellent', // 用戶體驗顯著提升
    deploymentStatus: 'success'  // 部署成功 (Bundle: index-DlsxwFQt.js)
  }
}
```

### **彩票系統分離** (39ff9ac)
```typescript
/**
 * 彩票與CREDIT顯示分離：
 * - CREDIT: 頭上顯示系統(OverheadManager)  
 * - COMBO/寶箱: 下方面板顯示(BottomPanel)
 * - 避免頭上資訊擁擠問題
 * - 各自獨立的更新和顯示邏輯
 */
interface RewardSystemSeparation {
  overheadRewards: ['credit'],
  bottomPanelRewards: ['combo', 'treasure'],
  displaySeparation: true
}
```

### **戰鬥平衡調整** (39ff9ac)  
```typescript
/**
 * 戰鬥體驗優化：
 * - 攻擊成本降低: 只有命中才扣點
 * - 操作流暢度: 1.5秒窗口防止重複扣點
 * - 風險降低: 空揮不扣點鼓勵攻擊
 * - 多人體驗: BOT自動投幣保持遊戲連續性
 */
interface CombatBalanceImprovement {
  riskReduction: 'miss_no_cost',
  flowImprovement: 'attack_window_1500ms', 
  multiplayerContinuity: 'bot_auto_coin'
}
```

## 參考檔案

- `controllers/CreditController.ts` - CREDIT投幣系統主控制器 (196行)
- `config.ts:183-201` - CREDIT系統配置參數 
- `objects/Character.ts` - 角色CREDIT屬性擴展 (credit, creditState, chargeWindowUntil)
- `scenes/GameScene.ts` - 戰鬥系統整合邏輯 (攻擊窗口、命中扣點)
- `controllers/OverheadManager.ts` - 頭上CREDIT顯示系統
- `ui/BottomPanel.ts` - 下方面板COMBO顯示系統

**CREDIT投幣系統實現完整的街機風格遊戲體驗！**
