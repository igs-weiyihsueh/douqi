# 遊戲功能設計演進

## 核心玩法設計

### 遊戲類型定位
- **類型**: 實驗性H5割草遊戲MVP
- **視角**: 俯視2D像素風格
- **操作**: 雙操作模式 (fast/slow)
- **目標**: 無盡刷分生存

### 雙操作模式設計
```typescript
// TitleScene - 模式選擇系統
private selected: 'fast' | 'slow' = 'fast';

// 快速模式特色
const fastMode = {
  操作: '滑鼠瞄準 + 按鍵攻擊',
  節奏: '快節奏動作',
  目標玩家: '喜歡動作遊戲的玩家'
};

// 慢速模式特色  
const slowMode = {
  操作: '鍵盤移動 + 黏著鎖定',
  節奏: '策略思考',
  目標玩家: '偏好策略的玩家'
};
```

## 角色成長系統

### 多角色協作設計
```typescript
// Character系統 - 最多4人本地協作
class GameScene {
  private characters: Character[] = [];  // P1 + 3 BOT

  // P1玩家控制
  private get player(): Character {
    return this.characters[0];
  }
}

// 角色狀態獨立管理
class Character {
  hp: number;              // 個別血量
  spirit: number;          // 個別連段
  energy: number;          // 個別能量 
  credit: number;          // 個別貨幣
  kills: number;           // 個別擊殺
  alive: boolean;          // 個別存活狀態
}
```

### COMBO獎勵系統
```typescript
// 階段三：COMBO獎勵機制
comboState = {
  currentStreak: 0,        // 當前連殺數
  lastKillTime: 0,         // 上次擊殺時間
  ticketsEarned: 0,        // 獲得彩票數
  isWarning: false,        // 警告狀態
  nextMilestone: number,   // 下個里程碑
  
  // 待處理獎勵狀態
  pendingRewardIndex?: number,
  pendingRewardTickets?: number, 
  pendingRewardMilestone?: number
};
```

## 敵人系統設計

### 敵人類型體系
```typescript
// 基於程式碼的敵人分類
type EnemyType = 'normal' | 'tank' | 'shielder' | 'shooter' | 'charger';

// 敵人AI黏著機制
enemySticky: {
  stickyBreakRadius: 800,   // 解綁距離
  stickyBreakSec: 1        // 解綁時間
}

// 敵人分離系統
enemySeparation: {
  enabled: true,
  radiusPx: 44,            // 影響半徑
  weight: 1.1,             // 分離權重
  iterations: 2,           // 解重疊迭代
  maxStepPx: 9            // 單幀推移限制
}
```

### 視覺切換系統
```typescript
// F4敵人外觀切換
class GameScene {
  private useSkeletonWarrior = true;  // true=骷髏戰士, false=紅圓形
  
  // F4複合功能：場景背景 + 敵人外觀同時切換
  toggleVisualMode() {
    this.isNewSceneActive = !this.isNewSceneActive;    // 背景切換
    this.useSkeletonWarrior = !this.useSkeletonWarrior; // 敵人切換
  }
}
```

## 小遊戲系統設計

### 可擴充框架
```typescript
// 小遊戲註冊系統
export interface MinigameEntry {
  key: string;           // 唯一識別碼
  name: string;          // 顯示名稱
  sceneKey: string;      // 場景鍵值
  desc: string;          // 遊戲描述
  icon: string;          // 顯示圖示
}

export const MINIGAMES: MinigameEntry[] = [
  { key: 'collect-race', name: '收集競賽', icon: '💎' },
  { key: 'push-survival', name: '推人生存', icon: '💥' },
  { key: 'bomb-arena', name: '炸彈人對戰', icon: '💣' },
  { key: 'peach-lottery', name: '桃樹彩票', icon: '🍑' }
];
```

### 統一遊戲模式
所有小遊戲採用 **1P + 3BOT** 格式：
- 統一的對戰體驗
- 一致的AI難度調校
- 簡化開發複雜度

### 小遊戲一：收集競賽
```typescript
// 收集競賽核心機制
class CollectRaceScene {
  // 物件類型
  type ShapeKey = 'diamond' | 'star' | 'heart' | 'gem';
  
  // 遊戲階段
  private phase: 'intro' | 'playing' | 'ended' = 'intro';
  
  // 動態目標系統
  private targetShape: ShapeKey;    // 告示牌指定形狀
  private nextSignAt: number;       // 下次切換時間
  
  // 物理互動
  vx: number; vy: number;          // 物件推動速度
  carried: boolean;                // 攜帶狀態
}
```

### 小遊戲二：推人生存  
```typescript
// 推人生存危險區域系統
class PushSurvivalScene {
  // 危險圈機制
  private rings: DangerRing[];           // 危險圈陣列
  private ringChaseChance = 0.5;         // 追蹤玩家機率
  
  // 推撞系統
  private dashDistance = 110;            // 短衝距離
  private pushDistance = 220;            // 推飛距離
  private stunMs = 400;                  // 暈眩時間
}
```

### 小遊戲三：炸彈人對戰
```typescript
// 炸彈對戰爆炸系統
class BombArenaScene {
  // 炸彈機制
  private throwSpeed = 460;              // 投擲速度
  private throwMaxDist = 340;            // 最大距離
  private fuseMs = 1500;                 // 引信時間
  private explodeRadius = 78;            // 爆炸範圍
  
  // 連鎖系統
  private chainMaxDepth = 6;             // 最大連鎖深度
}
```

### 小遊戲四：桃樹彩票
```typescript
// 桃樹彩票抽獎系統  
class PeachLotteryScene {
  // 四區域設計
  private zones: LotteryZone[];          // 四個彩票區
  private timeLimit = 10000;             // 10秒選擇時限
  
  // 淘汰機制
  private eliminationRound = 0;          // 當前淘汰輪
  private survivors: Player[];           // 倖存者列表
}
```

## 關卡系統設計

### 關卡制架構
```typescript
// 關卡系統骨架
class GameScene {
  private levelMode = false;                    // 關卡制開關
  private currentLevel = 1;                     // 當前關卡
  private currentSub: 'A' | 'B' = 'A';         // 子區域
  
  // 進程狀態機
  private progressPhase: 'playing' | 'choosing' | 'panning' | 'exiting' | 'transition';
  
  // 跨區域系統
  private crossPhase: 'walk' | 'panning' | 'enter';
  private crossSide: 'L' | 'R' | null;
  
  // 事件系統
  private eventBag: string[] = [];             // tower/guard/capture輪流
}
```

### 鏡頭系統 (7975cc9更新)
```typescript
// 鏡頭跟隨玩家系統
setupCamera() {
  // 啟用鏡頭跟隨
  this.cameras.main.startFollow(this.player, true, 0.08, 0.04);
  
  // 死區配置: 320×180 (原540×600→320×180)
  this.cameras.main.setDeadzone(320, 180);
  
  // 鏡頭邊界: 限制在當前slot內
  const slot = GameScene.stageSlotSize(); // 2520×1680
  this.cameras.main.setBounds(slotX, slotY, slot.width, slot.height);
}

// slot與deadzone設計理念
const cameraDesign = {
  slot: '2520×1680 - 比畫面大，鏡頭可在slot內捲動',
  deadzone: '320×180 - 縮小死區讓鏡頭更即時跟隨',
  bounds: '鏡頭鎖在當前slot，防止看到其他區域'
};
```

### 關卡制架構 (2decdde更新)
```typescript
// 地圖邊界重新定義
class GameScene {
  // 可移動區: 2520×840 (左右貼齊背景圖)
  private arenaW = 2520;  // 原1920→2520
  private arenaH = 840;   // 原1080→840
  
  // 禁區配置 (對應背景圖地形)
  private sceneMarginX = 0;      // 左右無邊距
  private sceneMarginTop = 504;  // 上方熔岩斷崖
  private sceneMarginBottom = 336; // 下方岩石帶
  
  // 統一slot計算
  static stageSlotSize() {
    return { width: 2520, height: 1680 };
  }
}
```

## 可破壞物系統

### 環境互動設計
```typescript
// Breakable物件系統
class Breakable extends Phaser.GameObjects.Sprite {
  kind: 'crate' | 'barrel';        // 木箱 | 爆炸桶
  hp: number;                       // 耐久度
  dead: boolean;                    // 已破壞
  vx: number; vy: number;          // 推動速度
  fusing: boolean;                  // 桶引爆倒數
}

// 推動物理
updateBreakables(delta) {
  // 速度整合 + 摩擦停止 + 邊界限制
  breakable.x += breakable.vx * delta;
  breakable.vx *= (1 - friction);
  
  // 物件間分離避免重疊
  this.separateBreakables();
}
```

### 策略性設計
- **木箱**: 阻擋 + 道具來源 + 可推動
- **爆炸桶**: 策略工具 + 連鎖爆炸 + 引信延遲

**參考檔案**: `scenes/TitleScene.ts`, `scenes/CollectRaceScene.ts`, `objects/Character.ts`, `minigames/registry.ts`
