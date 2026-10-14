# UI系統 (User Interface System)

**系統概述**：遊戲用戶介面系統，提供完整的遊戲資訊顯示、狀態回饋和互動體驗，包含角色面板、P位面板、狀態提示等多層次介面設計，確保玩家獲得清晰直觀的遊戲體驗。

## 📱 **最新UI邏輯優化** (df5cfde)

### **下方面板提示系統** (2026-10-12)
重新設計CREDIT系統的UI顯示邏輯，實現更清晰的資訊層次：

```typescript
/**
 * 下方面板HIT數位置複用設計：
 * - 正常遊玩：顯示「HIT xN」連擊數
 * - 未進場狀態：顯示「投幣加入遊戲」閃動提示
 * - 位置複用：避免UI元素過多，保持介面簡潔
 * - 狀態感知：根據creditState自動切換顯示內容
 */
class BottomPanelPromptSystem {
  /** HIT數與投幣提示的智能切換 */
  updatePanelCombo(index: number): void {
    const character = this.scene.characters[index];
    const text = this.panelComboTexts[index];
    if (!text) return;
    
    // 未進場狀態：顯示投幣提示
    if (character?.creditState === 'absent') {
      const credit = GameConfig.credit;
      const blinkOn = this.time.now % credit.prompt.blinkMs < credit.prompt.blinkMs / 2;
      
      this.setTextColor(text.setText(credit.joinText), credit.prompt.color)
          .setAlpha(blinkOn ? 1 : 0.45)  // 閃動效果
          .setVisible(true);
      return;
    }
    
    // 正常狀態：顯示HIT連擊
    const combo = character?.alive ? character.combo : undefined;
    if (!combo || combo.currentStreak === 0) {
      text.setVisible(false);
      return;
    }
    
    // HIT數顯示邏輯
    this.displayHitStreak(text, combo);
  }
  
  /** HIT數警告狀態顯示 */
  displayHitStreak(text: Phaser.GameObjects.Text, combo: ComboState): void {
    const cfg = this.PANEL_COMBO_CONFIG;
    let color = this.OVERHEAD_UI_CONFIG.COLORS.COMBO_TEXT_NORMAL;
    
    // 警告狀態：1.5秒沒命中開始閃爍
    if (combo.isWarning) {
      const blinkOn = this.time.now % cfg.WARNING_BLINK_MS < cfg.WARNING_BLINK_MS / 2;
      color = blinkOn ? 
        this.OVERHEAD_UI_CONFIG.COLORS.COMBO_TEXT_CRITICAL : 
        this.OVERHEAD_UI_CONFIG.COLORS.COMBO_TEXT_WARNING;
    }
    
    this.setTextColor(text.setText(`HIT x${combo.currentStreak}`), color)
        .setVisible(true);
  }
}
```

### **頭上倒數顯示系統**
```typescript
/**
 * 投幣續關倒數UI設計：
 * - 顯示位置：角色頭上 (offsetY: -200px)
 * - 倒數格式：「投幣續關 15」→「投幣續關 14」→...→「投幣續關 1」
 * - 更新頻率：每秒更新一次
 * - 超時處理：倒數結束角色消失，UI自動隱藏
 */
class OverheadCountdownDisplay {
  /** 倒數文字動態更新 */
  updateCountdownPrompt(character: Character): string {
    if (character.creditState !== 'waiting') return '';
    
    const controller = this.scene.creditController;
    const remaining = controller.getRemainingSeconds(character);
    
    if (remaining <= 0) {
      // 倒數結束：角色離場
      return '';
    }
    
    // 動態倒數顯示
    return `${GameConfig.credit.continueText} ${remaining}`;
  }
  
  /** 倒數視覺效果 */
  renderCountdownEffect(character: Character, text: string): void {
    const prompt = character.countdownPrompt;
    if (!prompt) return;
    
    // 位置和樣式設定
    const config = GameConfig.credit.prompt;
    prompt.setPosition(character.x, character.y + config.offsetY)
          .setText(text)
          .setStyle({
            fontSize: `${config.fontSize}px`,
            fontStyle: 'bold',
            color: config.color,
            stroke: config.stroke,
            strokeThickness: config.strokeThickness
          })
          .setVisible(true)
          .setDepth(config.depth);
  }
}
```

## 🎨 **UI層次架構設計**

### **多層次UI系統**
```typescript
/**
 * UI顯示層次設計：
 * - 角色面板層：角色狀態、CREDIT、能量條、倒數提示
 * - 下方面板層：HIT數/投幣提示、角色標籤、狀態圖示
 * - 覆蓋層：特殊狀態提示、系統訊息
 * - 背景層：地圖、遊戲世界
 */
enum UILayer {
  BACKGROUND = 0,           // 背景層
  WORLD = 10,              // 遊戲世界
  CHARACTERS = 20,         // 角色層
  OVERHEAD_UI = 60,        // 角色面板
  PANEL_UI = 70,          // 面板UI
  OVERLAY = 80,           // 覆蓋層
  DEBUG = 100             // 除錯層
}

interface UIHierarchy {
  /** 頭上UI元素 */
  overheadElements: {
    creditDisplay: UILayer.OVERHEAD_UI,     // CREDIT顯示
    energyBar: UILayer.OVERHEAD_UI,         // 能量條
    countdownPrompt: UILayer.OVERHEAD_UI,   // 倒數提示
    characterNumber: UILayer.OVERHEAD_UI    // 角色編號
  },
  
  /** 下方面板元素 */
  panelElements: {
    hitCounter: UILayer.PANEL_UI,          // HIT計數器
    joinPrompt: UILayer.PANEL_UI,          // 加入提示
    characterLabel: UILayer.PANEL_UI,      // 角色標籤
    statusIcon: UILayer.PANEL_UI           // 狀態圖示
  }
}
```

### **響應式UI配置**
```typescript
/**
 * UI元素自適應設計：
 * - 支援多角色數量 (1-4人)
 * - 動態位置調整
 * - 螢幕尺寸適應
 */
class ResponsiveUILayout {
  /** 多角色UI位置計算 */
  calculateUIPositions(characterCount: number): UIPosition[] {
    const positions: UIPosition[] = [];
    
    for (let i = 0; i < characterCount; i++) {
      positions.push({
        // 頭上UI位置
        overhead: {
          x: this.getCharacterX(i),
          y: this.getCharacterY(i) + GameConfig.credit.prompt.offsetY
        },
        
        // 下方面板位置
        panel: {
          x: this.getPanelX(i, characterCount),
          y: this.getPanelY()
        }
      });
    }
    
    return positions;
  }
  
  /** 螢幕尺寸適應 */
  adaptToScreenSize(width: number, height: number): void {
    // 調整UI縮放比例
    const scale = Math.min(width / 1920, height / 1080);
    this.uiScale = Math.max(0.5, Math.min(2.0, scale));
    
    // 重新計算所有UI位置
    this.recalculateAllPositions();
  }
}
```

## 💫 **視覺效果系統**

### **閃爍動畫效果**
```typescript
/**
 * 閃爍效果統一管理：
 * - 投幣提示閃爍：未進場狀態下方面板閃動
 * - HIT警告閃爍：1.5秒無命中橙紅交替
 * - 狀態指示閃爍：特殊狀態提示
 */
class BlinkingEffectManager {
  /** 投幣提示閃爍 */
  updateJoinPromptBlink(time: number): number {
    const config = GameConfig.credit.prompt;
    const blinkOn = time % config.blinkMs < config.blinkMs / 2;
    return blinkOn ? 1.0 : 0.45;  // 透明度變化
  }
  
  /** HIT警告閃爍 */
  updateHitWarningBlink(time: number): string {
    const config = this.PANEL_COMBO_CONFIG;
    const colors = this.OVERHEAD_UI_CONFIG.COLORS;
    const blinkOn = time % config.WARNING_BLINK_MS < config.WARNING_BLINK_MS / 2;
    
    return blinkOn ? colors.COMBO_TEXT_CRITICAL : colors.COMBO_TEXT_WARNING;
  }
  
  /** 統一閃爍時機控制 */
  getBlinkState(time: number, period: number, threshold: number = 0.5): boolean {
    return (time % period) < (period * threshold);
  }
}
```

### **文字顏色系統**
```typescript
/**
 * UI文字顏色配置：
 */
const UI_COLOR_SCHEME = {
  /** CREDIT系統顏色 */
  credit: {
    normal: '#ffe066',        // 金黃色 (正常CREDIT)
    warning: '#ff8c00',       // 橙色 (低CREDIT警告)
    critical: '#ff4444',      // 紅色 (CREDIT用完)
    prompt: '#ffe066'         // 投幣提示顏色
  },
  
  /** HIT連擊顏色 */
  combo: {
    normal: '#ffffff',        // 白色 (正常HIT)
    warning: '#ff8c00',       // 橙色 (警告狀態)
    critical: '#ff4444',      // 紅色 (即將中斷)
    background: '#000000'     // 黑色描邊
  },
  
  /** 角色狀態顏色 */
  status: {
    playing: '#00ff00',       // 綠色 (遊玩中)
    waiting: '#ffff00',       // 黃色 (等待續關)
    absent: '#888888',        // 灰色 (未進場)
    dead: '#ff0000'          // 紅色 (陣亡)
  }
};
```

## ⚙️ **UI配置系統**

### **面板配置參數**
```typescript
// UIScene.ts - 下方面板配置
const PANEL_COMBO_CONFIG = {
  /** HIT數警告配置 */
  WARNING_START_MS: 1500,      // 1.5秒沒命中開始警告
  WARNING_BLINK_MS: 300,       // 警告閃爍週期
  STREAK_TIMEOUT_MS: 2000,     // 2秒沒命中中斷連擊
  
  /** 面板位置配置 */
  position: {
    baseX: 100,               // 基礎X座標
    baseY: 50,                // 基礎Y座標  
    spacing: 200,             // 角色間距
    offsetY: -20              // 垂直偏移
  },
  
  /** 文字樣式配置 */
  textStyle: {
    fontSize: 24,             // 字體大小
    fontFamily: 'Arial',      // 字體族
    fontWeight: 'bold',       // 字重
    stroke: '#000000',        // 描邊顏色
    strokeThickness: 3        // 描邊厚度
  }
};
```

### **頭上UI配置**
```typescript
// 頭上UI系統配置
const OVERHEAD_UI_CONFIG = {
  /** CREDIT顯示配置 */
  credit: {
    fontSize: 28,             // CREDIT數字大小
    offsetY: -80,            // 相對角色位置
    color: '#ffe066',        // 金黃色
    format: 'CREDIT: {value}' // 顯示格式
  },
  
  /** 倒數顯示配置 (df5cfde) */
  countdown: {
    fontSize: 30,            // 倒數文字大小
    offsetY: -200,           // 頭上位置 (避免重疊)
    color: '#ffe066',        // 金黃色
    updateInterval: 1000,    // 1秒更新間隔
    format: '{text} {seconds}' // 投幣續關 15
  },
  
  /** 能量條配置 */
  energyBar: {
    width: 60,              // 能量條寬度
    height: 8,              // 能量條高度
    offsetY: -60,           // 相對位置
    backgroundColor: '#333', // 背景色
    fillColor: '#ffdd44'    // 填充色
  }
};
```

## 🔧 **UI狀態管理**

### **狀態驅動UI更新**
```typescript
/**
 * UI狀態同步系統：
 * - 監聽遊戲狀態變化
 * - 自動更新對應UI元素
 * - 確保UI與遊戲狀態一致
 */
class UIStateManager {
  /** CREDIT狀態變化處理 */
  onCreditStateChanged(character: Character, oldState: string, newState: string): void {
    switch (newState) {
      case 'absent':
        this.hideOverheadPrompt(character);
        this.showPanelJoinPrompt(character);
        break;
        
      case 'playing':
        this.hideAllPrompts(character);
        this.showNormalUI(character);
        break;
        
      case 'waiting':
        this.hidePanelPrompt(character);
        this.showCountdownPrompt(character);
        break;
    }
  }
  
  /** HIT連擊狀態更新 */
  onComboStateChanged(character: Character, combo: ComboState): void {
    const panelText = this.panelComboTexts[character.index];
    
    if (combo.currentStreak === 0) {
      panelText.setVisible(false);
    } else {
      this.updateHitDisplay(panelText, combo);
    }
  }
  
  /** 統一UI更新入口 */
  updateAllUI(): void {
    this.scene.characters.forEach((character, index) => {
      this.updateCharacterUI(character, index);
    });
  }
}
```

### **UI元素生命週期**
```typescript
/**
 * UI元素創建和銷毀管理：
 */
interface UIElementLifecycle {
  /** 創建UI元素 */
  createElement(type: UIElementType, config: UIConfig): UIElement;
  
  /** 更新UI元素 */
  updateElement(element: UIElement, data: any): void;
  
  /** 銷毀UI元素 */
  destroyElement(element: UIElement): void;
  
  /** 批量管理 */
  batchUpdate(elements: UIElement[], updateFn: Function): void;
}
```

## 🚀 **UI系統演進記錄**

### **下方面板提示系統** (df5cfde)
```typescript
/**
 * commit df5cfde: 下方面板智能提示實現
 * - HIT數位置複用：未進場時顯示「投幣加入遊戲」
 * - 閃動效果優化：與頭上提示區分，避免視覺混亂
 * - 狀態感知切換：creditState驅動的智能UI切換
 * - 位置層次清晰：頭上倒數+下方提示的層次分離
 */
interface BottomPanelOptimization {
  positionReuse: 'hit_counter_position_for_join_prompt',
  visualSeparation: 'clear_ui_hierarchy_established',
  stateDriven: 'automatic_content_switching',
  userExperience: 'intuitive_prompt_placement'
}
```

### **頭上UI位置優化** (eb9592c)
```typescript
/**
 * commit eb9592c: 頭上UI重疊修復
 * - 投幣提示位置：-150px → -200px避免與F4頭頂UI重疊
 * - 安全間距建立：16px緩衝區確保視覺不衝突
 * - 數學計算精準：實測範圍-181px~-218px完全避開UI區域
 */
interface OverheadUIOptimization {
  positionAdjustment: '-150px_to_-200px_offset',
  collisionAvoidance: '16px_safety_margin',
  visualClarity: 'complete_overlap_elimination'
}
```

## 🔍 **UI除錯與監控**

### **UI狀態除錯**
```typescript
/**
 * F9除錯面板UI資訊：
 */
function getUIDebugInfo(): string[] {
  return [
    `UI Elements: Overhead=${this.overheadElements.size}, Panel=${this.panelElements.size}`,
    `CREDIT States: ${this.getCreditStateDistribution()}`,
    `HIT Counters: ${this.getHitCounterStates()}`,
    `Prompt Visibility: ${this.getPromptVisibilityStates()}`
  ];
}
```

### **效能監控**
```typescript
/**
 * UI性能指標：
 */
interface UIPerformanceMetrics {
  renderTime: number,           // UI渲染時間
  updateFrequency: number,      // 更新頻率
  elementCount: number,         // UI元素數量
  memoryUsage: number          // 記憶體使用量
}
```

## 參考檔案

- `scenes/UIScene.ts` - UI系統核心實現 (下方面板提示、HIT數顯示)
- `config.ts:183-203` - CREDIT UI配置 (continueSeconds、joinText、prompt)
- `controllers/CreditController.ts` - CREDIT狀態與UI同步邏輯
- `wiki/systems/credit-system.md` - CREDIT系統與UI整合說明
- `wiki/systems/camera-system.md` - 攝影機與UI協調邏輯

**UI系統提供直觀清晰的遊戲資訊展示！**
