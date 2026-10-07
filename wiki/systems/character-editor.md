# 角色編輯器系統 (Character Editor)

> 🕒 最後更新：2026-10-07 21:15 (commit: 5740cfc)
> 📋 維護者：威騎

## 概述

角色編輯器是主選單新增的功能，允許玩家自訂慢速模式下的角色參數。系統提供4項核心參數調整：攻擊間隔、移動速度、衝刺速度、衝刺距離，設定會永久保存至瀏覽器localStorage，對P1玩家和BOT都生效。

## 📊 系統架構

### 核心檔案
```typescript
// systems/characterParams.ts - 參數定義與存讀檔
export type CharacterParamKey = 'attackCooldownMs' | 'moveSpeed' | 'dashSpeed' | 'dashDistance';
export type CharacterParams = Record<CharacterParamKey, number>;

// objects/CharacterEditorPanel.ts - 編輯面板UI
export class CharacterEditorPanel {
  private container: Phaser.GameObjects.Container | null = null;
  private rows: ParamRow[] = [];                   // 4個參數滑桿
  private values: CharacterParams;                 // 當前參數值
  private selected = 0;                           // 鍵盤選中的參數
}

// scenes/TitleScene.ts - 主選單入口
private characterEditorBtn?: Phaser.GameObjects.Text;
private characterEditor?: CharacterEditorPanel;
```

## 🎯 參數定義系統

### 可調整參數
```typescript
// systems/characterParams.ts:29-46 - 參數範圍定義
export const CHARACTER_PARAM_DEFS: ReadonlyArray<CharacterParamDef> = [
  {
    key: 'attackCooldownMs', 
    label: '普攻攻擊間隔', 
    unit: 'ms', 
    hint: '越小越快',
    min: 100, max: 800, step: 20, 
    defaultValue: GameConfig.player.attackCooldownMs    // 預設400ms
  },
  {
    key: 'moveSpeed', 
    label: '移動速度', 
    unit: '', 
    hint: '',
    min: 100, max: 500, step: 10, 
    defaultValue: GameConfig.slow.moveSpeed             // 預設200
  },
  {
    key: 'dashSpeed', 
    label: '衝刺速度', 
    unit: '', 
    hint: '',
    min: 200, max: 1500, step: 20, 
    defaultValue: GameConfig.slow.dashSpeed             // 預設800
  },
  {
    key: 'dashDistance', 
    label: '衝刺距離', 
    unit: 'px', 
    hint: '',
    min: 60, max: 400, step: 10, 
    defaultValue: GameConfig.slow.dashDistance          // 預設110
  }
];
```

### 資料管理
```typescript
// systems/characterParams.ts:60-89 - localStorage操作
const STORAGE_KEY = 'douqi.characterParams.v1';

export function loadCharacterParams(): CharacterParams {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultCharacterParams();
    
    const parsed = JSON.parse(stored);
    const result: CharacterParams = {};
    
    // 逐一檢查並夾在合法範圍內
    for (const def of CHARACTER_PARAM_DEFS) {
      const value = parsed[def.key];
      result[def.key] = typeof value === 'number' 
        ? Math.max(def.min, Math.min(def.max, value))
        : def.defaultValue;
    }
    return result;
  } catch {
    return defaultCharacterParams();                    // 資料損壞回預設
  }
}

export function saveCharacterParams(params: CharacterParams): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // 儲存失敗靜默處理（無障礙降級）
  }
}
```

## 🎨 編輯器界面

### 主選單入口
```typescript
// scenes/TitleScene.ts - 角色編輯按鈕 (取代原Zoom按鈕位置)
private createCharacterEditorButton(): void {
  this.characterEditorBtn = this.add.text(cx - 200, cy + 80, '🛠 角色編輯 (C)', {
    fontSize: '24px',
    fill: '#ffffff',
    backgroundColor: '#374151',
    padding: { x: 16, y: 8 }
  }).setOrigin(0.5).setInteractive();
  
  this.characterEditorBtn.on('pointerdown', () => this.openCharacterEditor());
}

// 防誤觸保護：編輯時暫停主選單其他功能
get isCharacterEditorOpen(): boolean {
  return this.characterEditor?.isOpen ?? false;
}
```

### 編輯面板設計
```typescript
// objects/CharacterEditorPanel.ts:70-120 - 面板開啟
open(): void {
  if (this.isOpen) return;
  this.values = loadCharacterParams();                 // 載入已保存參數
  this.selected = 0;                                  // 預選第一個參數
  
  const cx = this.scene.scale.width / 2;
  const cy = this.scene.scale.height / 2;
  
  // 背景遮罩（壓暗+攔截點擊）
  this.dim = this.scene.add.rectangle(cx, cy, this.scene.scale.width, this.scene.scale.height, 0x000000, 0.7)
    .setInteractive()
    .on('pointerdown', (e: Phaser.Input.Pointer) => e.stopPropagation());
  
  // 主面板容器
  this.container = this.scene.add.container(cx, cy);
  
  // 面板背景
  const panel = this.scene.add.rectangle(0, 0, LAYOUT.PANEL_WIDTH, LAYOUT.PANEL_HEIGHT, COLORS.PANEL_BG)
    .setStrokeStyle(2, COLORS.PANEL_BORDER);
  
  // 標題
  const title = this.scene.add.text(0, -LAYOUT.PANEL_HEIGHT/2 + 30, '角色參數編輯', {
    fontSize: '28px', fill: '#ffffff', fontFamily: 'Arial'
  }).setOrigin(0.5);
  
  this.container.add([panel, title]);
  this.createParamRows();                             // 建立4個參數滑桿
  this.createButtons();                               // 建立功能按鈕
  this.updateDisplay();                               // 更新顯示
  
  document.addEventListener('keydown', this.onKeyDown);
}
```

### 滑桿操作系統
```typescript
// objects/CharacterEditorPanel.ts:150-200 - 參數列建立
private createParamRows(): void {
  this.rows = [];
  
  CHARACTER_PARAM_DEFS.forEach((def, i) => {
    const y = LAYOUT.FIRST_ROW_Y + i * LAYOUT.ROW_SPACING;
    
    // 參數名稱標籤
    const label = this.scene.add.text(-180, y, `${def.label} ${def.hint}`, {
      fontSize: '18px', fill: '#ffffff'
    });
    
    // 高亮背景（鍵盤選中時顯示）
    const highlight = this.scene.add.rectangle(0, y, LAYOUT.PANEL_WIDTH - 40, 35, COLORS.ROW_HIGHLIGHT, 0);
    
    // 滑桿軌道
    const track = this.scene.add.rectangle(0, y, LAYOUT.SLIDER_WIDTH, LAYOUT.SLIDER_HEIGHT, COLORS.TRACK);
    
    // 滑桿填充
    const fill = this.scene.add.rectangle(-LAYOUT.SLIDER_WIDTH/2, y, 0, LAYOUT.SLIDER_HEIGHT, COLORS.TRACK_FILL)
      .setOrigin(0, 0.5);
    
    // 滑桿把手
    const handle = this.scene.add.rectangle(0, y, 16, 24, COLORS.HANDLE)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.selectParam(i));
    
    // 數值顯示
    const valueText = this.scene.add.text(120, y, '', {
      fontSize: '16px', fill: '#ffffff'
    });
    
    // 微調按鈕 −/+
    const minusBtn = this.scene.add.text(-200, y, '−', {
      fontSize: '24px', fill: COLORS.STEP_BUTTON, backgroundColor: '#1f2937', padding: { x: 8, y: 4 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.selectParam(i); this.adjustValue(-def.step); });
    
    const plusBtn = this.scene.add.text(200, y, '+', {
      fontSize: '24px', fill: COLORS.STEP_BUTTON, backgroundColor: '#1f2937', padding: { x: 8, y: 4 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.selectParam(i); this.adjustValue(def.step); });
    
    // 滑桿點擊跳轉
    track.setInteractive().on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.selectParam(i);
      const localX = pointer.x - (this.scene.scale.width/2 - LAYOUT.SLIDER_WIDTH/2);
      const ratio = Phaser.Math.Clamp(localX / LAYOUT.SLIDER_WIDTH, 0, 1);
      const newValue = def.min + ratio * (def.max - def.min);
      this.setValue(def.key, Math.round(newValue / def.step) * def.step);
    });
    
    this.container.add([label, highlight, track, fill, handle, valueText, minusBtn, plusBtn]);
    this.rows.push({ def, highlight, fill, handle, valueText });
  });
}
```

## ⌨️ 操作系統

### 滑鼠操作
- **滑桿點擊**: 直接跳轉到點擊位置的數值
- **把手拖拽**: 拖動滑桿把手調整數值  
- **微調按鈕**: 點擊 −/+ 按鈕進行單步調整
- **功能按鈕**: 儲存/恢復預設/取消操作

### 鍵盤操作
```typescript
// objects/CharacterEditorPanel.ts:250-280 - 鍵盤控制
private handleKey(e: KeyboardEvent): void {
  e.preventDefault();
  
  switch (e.key) {
    case 'ArrowUp':
      this.selected = Math.max(0, this.selected - 1);  // 上一個參數
      break;
    case 'ArrowDown':
      this.selected = Math.min(this.rows.length - 1, this.selected + 1); // 下一個參數
      break;
    case 'ArrowLeft':
      this.adjustValue(-this.rows[this.selected].def.step);              // 減少
      break;
    case 'ArrowRight':
      this.adjustValue(this.rows[this.selected].def.step);               // 增加
      break;
    case 'Enter':
      this.save();                                                       // 儲存並關閉
      break;
    case 'Escape':
      this.cancel();                                                     // 取消並關閉
      break;
  }
  this.updateDisplay();
}
```

### 功能按鈕
```typescript
// objects/CharacterEditorPanel.ts:300-330 - 功能按鈕
private createButtons(): void {
  const buttonY = LAYOUT.PANEL_HEIGHT/2 - 40;
  
  // 儲存按鈕
  const saveBtn = this.scene.add.text(-80, buttonY, '儲存', {
    fontSize: '20px', fill: '#ffffff', backgroundColor: '#15803d', padding: { x: 12, y: 6 }
  }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    .on('pointerdown', () => this.save());
  
  // 恢復預設按鈕  
  const resetBtn = this.scene.add.text(0, buttonY, '恢復預設', {
    fontSize: '20px', fill: '#ffffff', backgroundColor: '#92400e', padding: { x: 12, y: 6 }
  }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    .on('pointerdown', () => this.resetToDefaults());
  
  // 取消按鈕
  const cancelBtn = this.scene.add.text(80, buttonY, '取消', {
    fontSize: '20px', fill: '#ffffff', backgroundColor: '#374151', padding: { x: 12, y: 6 }
  }).setOrigin(0.5).setInteractive({ useHandCursor: true })
    .on('pointerdown', () => this.cancel());
  
  this.container.add([saveBtn, resetBtn, cancelBtn]);
}

// 操作處理
private save(): void {
  saveCharacterParams(this.values);                   // 寫入localStorage
  this.close();
}

private resetToDefaults(): void {
  this.values = defaultCharacterParams();            // 重置為預設值（需再按儲存）
  this.updateDisplay();
}

private cancel(): void {
  this.close();                                      // 不儲存直接關閉
}
```

## 🎮 遊戲整合

### 參數套用機制
```typescript
// scenes/GameScene.ts - 遊戲開始時載入參數
create(data: { mode: 'fast' | 'slow' }): void {
  this.mode = data.mode;
  
  if (this.mode === 'slow') {
    // 載入自訂參數
    this.characterParams = loadCharacterParams();
    
    // 套用到慢速調校
    this.slowTuning = {
      ...GameConfig.slow,
      moveSpeed: this.characterParams.moveSpeed,
      dashSpeed: this.characterParams.dashSpeed,
      dashDistance: this.characterParams.dashDistance
    };
  }
}

// 攻擊冷卻時間動態讀取
private attackCooldownMs(): number {
  return this.mode === 'slow' 
    ? this.characterParams.attackCooldownMs 
    : GameConfig.player.attackCooldownMs;
}
```

### P1與BOT統一套用
```typescript
// scenes/GameScene.ts:280-300 - 慢速模式角色參數統一
private setupSlowMode(): void {
  // P1 和 BOT 都使用相同的自訂參數
  this.characters.forEach(char => {
    if (this.mode === 'slow') {
      char.moveSpeed = this.characterParams.moveSpeed;
      char.dashSpeed = this.characterParams.dashSpeed;
      char.dashDistance = this.characterParams.dashDistance;
      char.attackCooldown = this.characterParams.attackCooldownMs;
    }
  });
}

// 原本慢速衝刺僅P1套用，現在P1與BOT統一
private updateCharacterDash(char: Character): void {
  if (this.mode === 'slow') {
    // 統一套用自訂參數
    char.dashSpeed = this.slowTuning.dashSpeed;
    char.dashDistance = this.slowTuning.dashDistance;
  } else {
    // 快速模式不變
    char.dashSpeed = GameConfig.fast.dashSpeed;
    char.dashDistance = GameConfig.fast.dashDistance;
  }
}
```

## 🔧 UI設計系統

### 視覺配色
```typescript
// objects/CharacterEditorPanel.ts:20-35 - 色彩主題
const COLORS = {
  PANEL_BG: 0x1f2937,                                // 面板背景(深灰)
  PANEL_BORDER: 0x6b7280,                           // 面板邊框(中灰)
  TRACK: 0x374151,                                  // 滑桿軌道(灰)
  TRACK_FILL: 0x3b82f6,                            // 滑桿填充(藍)
  HANDLE: 0xf8fafc,                                 // 滑桿把手(白)
  ROW_HIGHLIGHT: 0x1e3a8a,                         // 選中高亮(深藍)
  STEP_BUTTON: '#93c5fd',                          // 微調按鈕(淺藍)
  SAVE: 0x15803d,                                   // 儲存按鈕(綠)
  RESET: 0x92400e,                                  // 重置按鈕(橙)
  CANCEL: 0x374151                                  // 取消按鈕(灰)
} as const;
```

### 佈局配置
```typescript
// objects/CharacterEditorPanel.ts:10-20 - 佈局常數
const LAYOUT = {
  PANEL_WIDTH: 600,                                 // 面板寬度
  PANEL_HEIGHT: 400,                                // 面板高度
  SLIDER_WIDTH: 250,                                // 滑桿寬度
  SLIDER_HEIGHT: 8,                                 // 滑桿高度
  FIRST_ROW_Y: -80,                                // 第一個參數Y位置
  ROW_SPACING: 50                                   // 參數間距
} as const;
```

## 📈 系統整合與升級

### 移除Zoom系統 (c4882c3)
```typescript
// 移除項目清單
- TitleScene.ts: Zoom按鈕、Z鍵綁定、編輯面板、狀態欄位 (-352行)
- GameScene.ts: zoom設定應用、重置代碼 (-7行)  
- config.ts: showZoomEditor、zoomEditor配置區塊 (-43行)
- 總淨減少: 401行代碼
```

### 角色編輯器新增 (5740cfc)
```typescript
// 新增項目清單
+ systems/characterParams.ts: 參數定義與存讀檔系統 (+116行)
+ objects/CharacterEditorPanel.ts: 完整編輯面板UI (+275行)
+ TitleScene.ts: 按鈕入口與整合邏輯 (+46行)
+ GameScene.ts: 參數載入與套用機制 (+28行)
+ 總淨增加: 454行代碼
```

## 🏗 文檔交叉參考

- [UI/UX設計](../design/ui-ux-decisions.md) - 主選單介面設計演進
- [UI實作](./ui-implementation.md) - 主選單UI實作細節
- [遊戲功能演進](../design/gameplay-evolution.md) - 慢速模式設計理念
- [效能配置](./performance-config.md) - 角色參數預設值定義
- [術語表](../glossary.md) - characterParams、CharacterEditorPanel等核心術語
