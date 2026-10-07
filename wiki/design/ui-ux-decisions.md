# UI/UX設計決策

## 視覺設計原則

### 解析度與縮放
```typescript
// GameConfig - 顯示設定
const displayConfig = {
  width: 1920,              // 16:9橫向解析度
  height: 1080,
  
  scale: {
    mode: Phaser.Scale.FIT,           // 等比縮放
    autoCenter: Phaser.Scale.CENTER_BOTH  // 居中顯示
  },
  
  // 像素藝術優化
  pixelArt: true,                     // 像素風格
  roundPixels: true,                  // 像素對齊
  backgroundColor: '#12131a'          // 暗色背景
};
```

### 場地設計
```typescript
// 場地邊界設定
arena: {
  padding: 72,                // 場地內縮 (原48按比例調整)
  borderThickness: 6,         // 圍欄粗細
  borderColor: 0x3a4668,     // 圍欄顏色
  bounceRestitution: 0.6     // 邊界反彈係數
}
```

## HUD系統設計

### 角色狀態顯示
```typescript
// UIScene - 角色狀態追蹤
interface CharStat {
  label: string;              // 角色標籤
  color: number;              // 代表顏色
  hp: number;                 // 當前血量
  maxHp: number;              // 最大血量
  spirit: number;             // 連段計數
  maxSpirit: number;          // 連段上限
  kills: number;              // 擊殺數
  alive: boolean;             // 存活狀態
  isPlayer: boolean;          // 是否玩家
  
  // 世界座標(頭上UI)
  x: number; y: number;
  
  // 階段二：貨幣系統
  credit: number;
  
  // 階段三：COMBO系統
  combo: ComboState;
}
```

### COMBO獎勵UI系統
```typescript
// COMBO狀態追蹤
interface ComboState {
  currentStreak: number;      // 當前連擊數
  lastKillTime: number;       // 上次擊殺時間戳
  ticketsEarned: number;      // 獲得票券總數
  isWarning: boolean;         // 警告狀態(1.5-2秒間)
  nextMilestone: number;      // 下個獎勵里程碑
}

// COMBO視覺反饋
const comboVisuals = {
  streakDisplay: '連擊數字放大顯示',
  warningEffect: '1.5-2秒間警告閃爍',
  milestoneReached: '里程碑達成特效',
  ticketAnimation: '票券獲得動畫'
};
```

### 統計面板
```typescript
// 遊戲統計顯示
interface StatsPayload {
  chars: CharStat[];          // 角色狀態陣列
  teamKills: number;          // 團隊總擊殺
  survivalMs: number;         // 生存時間
  playerBurstReady: boolean;  // 爆發準備狀態
  count: number;              // 當前計數
  maxCount: number;           // 最大計數
  
  // 等級系統
  level: number;              // 當前等級
  levelCap: number;           // 等級上限
  levelExpInto: number;       // 當前等級經驗
}
```

## 操作反饋設計

### 模式選擇界面
```typescript
// TitleScene - 雙模式選擇
class TitleScene {
  private selected: 'fast' | 'slow' = 'fast';
  private highlightRect?: Phaser.GameObjects.Rectangle;  // 黃色選擇框
  private hlPos: { fast: number; slow: number };         // 按鈕位置

  // 模式切換
  private selectMode(mode: 'fast' | 'slow'): void {
    this.selected = mode;
    if (this.highlightRect) {
      this.highlightRect.x = this.hlPos[mode];  // 移動高亮框
    }
  }
}
```

### 鏡頭跟隨系統 (7975cc9更新)
```typescript
// 鏡頭跟隨配置
const cameraConfig = {
  followTarget: 'player',           // 跟隨玩家
  lerpX: 0.08,                     // 水平跟隨速度
  lerpY: 0.04,                     // 垂直跟隨速度
  deadzone: {
    width: 320,                     // 死區寬度 (原540→320)
    height: 180                     // 死區高度 (原600→180)
  },
  bounds: 'currentSlot'             // 鏡頭範圍限制在當前slot
};

// zoom編輯器 (保留)
zoomEditor: {
  defaultZoom: 1.0,
  minZoom: 0.3, maxZoom: 3.0,
  fineStep: 0.05,      // 微調步進
  coarseStep: 0.1,     // 粗調步進
  keyboardStep: 0.2    // 鍵盤步進
}
```

## 小遊戲UI設計

### 收集競賽界面
```typescript
// CollectRaceScene - 遊戲階段UI
class CollectRaceScene {
  private phase: 'intro' | 'playing' | 'ended' = 'intro';
  
  // 目標指示系統
  private targetShape: ShapeKey;        // 當前目標形狀
  private nextSignAt: number;           // 告示牌切換時間
  
  // 物件攜帶狀態
  interface CollectItem {
    shape: ShapeKey;
    carried: boolean;                   // 被攜帶狀態
    vx: number; vy: number;            // 推動速度
  }
}
```

### 推人生存界面
```typescript
// PushSurvivalScene - 危險指示
class PushSurvivalScene {
  // 危險圈警告系統
  private rings: DangerRing[];
  private ringChaseChance = 0.5;        // 追蹤機率顯示
  
  // 推撞反饋
  private dashDistance = 110;           // 短衝距離預覽
  private pushDistance = 220;           // 推飛距離顯示
}
```

## 除錯與開發界面

### 角色編輯器系統 (5740cfc取代Zoom)
```typescript
// TitleScene - 角色編輯器入口 (取代原Zoom按鈕位置)
private characterEditorBtn?: Phaser.GameObjects.Text;
private characterEditor?: CharacterEditorPanel;

private createCharacterEditorButton(): void {
  this.characterEditorBtn = this.add.text(cx - 200, cy + 80, '🛠 角色編輯 (C)', {
    fontSize: '24px',
    fill: '#ffffff',
    backgroundColor: '#374151',
    padding: { x: 16, y: 8 }
  }).setOrigin(0.5).setInteractive();
}

// 防誤觸保護：編輯時暫停主選單其他功能
get isCharacterEditorOpen(): boolean {
  return this.characterEditor?.isOpen ?? false;
}
```

### 慢速模式參數系統 (5740cfc升級)
```typescript
// systems/characterParams.ts - 動態參數載入
export type CharacterParamKey = 'attackCooldownMs' | 'moveSpeed' | 'dashSpeed' | 'dashDistance';

const CHARACTER_PARAM_DEFS = [
  { key: 'attackCooldownMs', min: 100, max: 800, step: 20 },  // 攻擊間隔
  { key: 'moveSpeed', min: 100, max: 500, step: 10 },         // 移動速度  
  { key: 'dashSpeed', min: 200, max: 1500, step: 20 },        // 衝刺速度
  { key: 'dashDistance', min: 60, max: 400, step: 10 }        // 衝刺距離
];

// localStorage永久保存 (douqi.characterParams.v1)
export function saveCharacterParams(params: CharacterParams): void;
export function loadCharacterParams(): CharacterParams;
```

### ~~Zoom編輯器系統~~ (c4882c3已移除)
```typescript
// ❌ 已移除的Zoom系統 (c4882c3)
// - TitleScene Zoom按鈕和Z鍵綁定
// - openZoomEditor、createZoomEditorPanel方法
// - zoomEditorActive、zoomSliders狀態  
// - GameScene zoom設定應用
// - config.showZoomEditor、zoomEditor配置區塊
// 總移除: 401行代碼，為角色編輯器騰出UI位置

// debug配置 (更新)
debug: {
  showSlowTuningPanel: false,     // 慢速模式調參面板 (保留)
  // showZoomEditor: false        // ❌ 已移除
}
```
  }
}
```

### 快捷鍵系統
```typescript
// 快捷鍵配置
shortcuts: {
  zoomIn: ['PLUS', 'NUMPAD_ADD'],        // 放大
  zoomOut: ['MINUS', 'NUMPAD_SUBTRACT'],  // 縮小
  reset: ['R'],                           // 重置
  
  // F4複合功能
  toggleVisual: ['F4'],                   // 場景+敵人外觀切換
  
  // 開發除錯
  debugMode: ['F12'],                     // 除錯模式
  showStats: ['TAB']                      // 顯示統計
}
```

## 可用性設計

### 輸入系統設計
```typescript
// 操作方式統一
const inputMethods = {
  keyboard: {
    movement: 'WASD + 方向鍵',
    actions: '空白攻擊 + 數字技能',
    interface: '方向鍵選擇 + 空白確認'
  },
  
  mouse: {
    targeting: '滑鼠瞄準',
    actions: '點擊攻擊',
    interface: '點擊按鈕'
  }
};
```

### 防護機制
```typescript
// 使用者體驗保護
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();  // 防止右鍵選單
}, false);

console.log('🛡️ 瀏覽器右鍵防護已啟用（參數編輯器改用UI按鈕）');
```

## 視覺場景系統

### 場景切換設計
```typescript
// F4場景背景切換
class GameScene {
  private sceneBackgrounds: Phaser.GameObjects.Image[] = [];
  private isNewSceneActive = false;      // 場景狀態切換
  
  // 角色皮膚系統
  private characterSkin: Phaser.GameObjects.Image | null = null;
  private characterUIOverlay: Phaser.GameObjects.Image | null = null;
  
  // 敵人外觀切換 (66e51cb更新：預設false)
  private useSkeletonWarrior = false;    // false=紅圓形, true=骷髏戰士
}
}
```

### 場景背景系統 (7975cc9更新)
```typescript
// F4場景背景切換 - 新架構
class GameScene {
  /**
   * F4 場景背景圖陣列。關卡制為 [B-左, A-中, B-右] 三個 slot 各一張;
   * 經典模式只有一張。由 createCoverImage 建立，貼在世界上隨鏡頭捲動。
   */
  private sceneBackgrounds: Phaser.GameObjects.Image[] = [];
  private isNewSceneActive = false;      // 場景狀態切換
  
  // createCoverImage(): cover等比放大 + setCrop置中裁切
  createCoverImage(key: string, x: number, y: number, targetW: number, targetH: number) {
    const image = this.add.image(x, y, key);
    const scaleX = targetW / image.width;
    const scaleY = targetH / image.height;
    const scale = Math.max(scaleX, scaleY); // 取較大倍率確保覆蓋
    
    image.setScale(scale);
    image.setDepth(SCENE_BG_DEPTH); // 0.5: 地面0 < 背景0.5 < 圍欄1 < 粒子2
    
    // 裁切多餘部分
    const cropW = targetW / scale;
    const cropH = targetH / scale;
    image.setCrop(
      (image.width - cropW) / 2,
      (image.height - cropH) / 2,
      cropW, cropH
    );
    
    return image;
  }
}
```

## 響應式與適配

### 螢幕適配
```typescript
// 等比縮放保持比例
scale: {
  mode: Phaser.Scale.FIT,              // 適應螢幕
  autoCenter: Phaser.Scale.CENTER_BOTH  // 居中對齊
}

// 觸控設備適配
canvas { 
  touch-action: none;                   // 防止滑動干擾
}
```

### 效能考量
```typescript
// UI更新效能優化
const maxActiveFx = 40;                 // 特效數量限制
const timestopSettlePerFrame = 10;      // 分幀結算

// 條件式UI元素
if (GameConfig.debug.showSlowTuningPanel) {
  this.createTuningPanel();             // 僅開發模式顯示
}
```

**參考檔案**: `scenes/UIScene.ts`, `scenes/TitleScene.ts`, `config.ts`, `main.ts`
