# 小遊戲系統設計

## 統一框架架構

### 可擴充註冊系統
```typescript
// minigames/registry.ts - 小遊戲框架
export interface MinigameEntry {
  key: string;           // 唯一識別碼
  name: string;          // 顯示名稱
  sceneKey: string;      // Phaser場景KEY
  desc: string;          // 遊戲說明
  icon: string;          // 圖示(emoji)
}

export const MINIGAMES: MinigameEntry[] = [
  {
    key: 'collect-race', 
    name: '收集競賽',
    sceneKey: 'CollectRaceScene',
    desc: '60 秒內收集告示指定的形狀丟進自己的箱子，比誰分數高！(1 人 vs 3 BOT)',
    icon: '💎'
  },
  // ... 其他小遊戲
];
```

### 動態選單生成
```typescript
// MinigameMenuScene - 自動生成界面
create() {
  MINIGAMES.forEach((game, index) => {
    this.createGameCard(game, index);  // 動態建立卡片
  });
}
```

## 1P+3BOT 統一模式

### 角色管理架構
所有小遊戲採用相同的角色管理模式：
- **1個真人玩家** (鍵盤控制)
- **3個BOT** (AI自動)
- **統一輸入系統** (八方向移動 + 空白行動)

```typescript
// 統一的角色介面
interface GameCharacter {
  index: number;          // 0=P1, 1-3=BOT
  isBot: boolean;         // AI標記
  sprite: Phaser.GameObjects.Image;
  x: number; y: number;   // 位置
  alive: boolean;         // 存活狀態
  nextDecideAt: number;   // BOT決策時間
}
```

### 通用遊戲階段
```typescript
// 標準遊戲流程
type GamePhase = 'intro' | 'ready' | 'playing' | 'ended';

// intro → ready(倒數) → playing → ended(結算)
class MinigameBase {
  private phase: GamePhase = 'intro';
  private readyCountdown: number;    // 3-2-1倒數
  private gameTimer: number;         // 遊戲時間
  private finishing: boolean;        // 結束演出
}
```

## 遊戲一：收集競賽

### 核心機制設計
```typescript
// CollectRaceScene - 收集競賽
type ShapeKey = 'diamond' | 'star' | 'heart' | 'gem';

interface CollectItem extends Phaser.GameObjects.Image {
  shape: ShapeKey;       // 形狀類型
  carried: boolean;      // 被攜帶狀態
  vx: number; vy: number; // 推動物理
}

interface Racer extends GameCharacter {
  score: number;                    // 得分
  carrying: CollectItem | null;     // 手上物品
  bin: Bin;                        // 專屬箱子
  
  // BOT AI
  target: CollectItem | null;      // 目標物品
  wrongPickThisTrip: boolean;      // 故意撿錯(增加難度)
}
```

### 動態目標系統
```typescript
// 告示牌系統
class CollectRaceScene {
  private targetShape: ShapeKey;     // 當前指定形狀
  private nextSignAt: number;        // 下次切換時間
  
  // 9-12秒隨機切換
  updateSign() {
    if (this.time.now >= this.nextSignAt) {
      this.targetShape = this.randomShape();
      this.nextSignAt = this.time.now + 
        Phaser.Math.Between(9000, 12000);
    }
  }
}
```

### 物理互動系統
```typescript
// 物件推動機制
const itemPhysics = {
  maxPushSpeed: 70,        // 最大推動速度
  friction: 15,            // 摩擦係數
  pushDragMax: 1.2        // 拖行限制(防卡牆)
};

// 微推設計：可推但阻力大，接近時幾乎不動便於撿拾
updateItemPhysics(item: CollectItem, delta: number) {
  item.x += item.vx * delta;
  item.y += item.vy * delta;
  item.vx *= (1 - friction);   // 摩擦衰減
  item.vy *= (1 - friction);
}
```

## 遊戲二：推人生存

### 危險區域系統
```typescript
// PushSurvivalScene - 推人生存
interface WarnRing {
  x: number; y: number;         // 圓心位置
  radius: number;               // 半徑
  startAt: number;              // 開始時間
  fillMs: number;               // 填滿時長
  exploded: boolean;            // 已爆炸
  gfx: Phaser.GameObjects.Graphics; // 視覺物件
}

interface Fighter extends GameCharacter {
  stunUntil: number;            // 被推暈眩時間
  vx: number; vy: number;       // 被推速度
  nextPushAt: number;           // 推人冷卻
  
  // 面向系統
  faceX: number; faceY: number; // 面向單位向量
  
  // 短衝撞人系統
  dashUntil: number;            // 衝刺結束時間
  dashVx: number; dashVy: number; // 衝刺速度
  dashHit: Set<number>;         // 已撞到的對象
}
```

### 推撞機制
```typescript
// 短衝撞人系統
const dashConfig = {
  dashDistance: 110,        // 衝刺距離
  dashDuration: 160,        // 衝刺時長(ms)
  pushDistance: 220,        // 推飛距離
  stunMs: 400              // 暈眩時間
};

// 空白鍵短衝
startDash(fighter: Fighter) {
  fighter.dashUntil = this.time.now + dashConfig.dashDuration;
  fighter.dashVx = fighter.faceX * dashSpeed;
  fighter.dashVy = fighter.faceY * dashSpeed;
  fighter.dashHit.clear();  // 重置命中記錄
}
```

### 難度遞增設計
```typescript
// 動態難度調整
const difficultyProgression = {
  ringConcurrentStart: 2,   // 開始2個圈
  ringConcurrentEnd: 5,     // 結束5個圈
  ringChaseChance: 0.5,     // 50%機率追蹤玩家
  fillSpeedIncrease: 1.2    // 填滿速度加快係數
};

updateDifficulty() {
  const progress = (this.time.now - this.startedAt) / 60000; // 0~1
  const currentRings = Phaser.Math.Linear(
    difficultyProgression.ringConcurrentStart,
    difficultyProgression.ringConcurrentEnd,
    progress
  );
}
```

## 遊戲三：炸彈人對戰

### 炸彈物理系統
```typescript
// BombArenaScene - 炸彈對戰
interface Bomb {
  x: number; y: number;         // 位置
  vx: number; vy: number;       // 拋射速度
  fuseMs: number;               // 引信時間(1500ms)
  exploded: boolean;            // 已爆炸
  thrower: number;              // 投擲者索引
}

const bombConfig = {
  throwSpeed: 460,              // 投擲初速
  throwMaxDist: 340,            // 最大距離
  fuseMs: 1500,                // 引信時間
  explodeRadius: 78,            // 爆炸範圍
  chainMaxDepth: 6             // 最大連鎖深度
};
```

### 拋射系統
```typescript
// 朝面向拋射
throwBomb(thrower: Fighter) {
  const bomb: Bomb = {
    x: thrower.x,
    y: thrower.y,
    vx: Math.cos(thrower.aimAngle) * bombConfig.throwSpeed,
    vy: Math.sin(thrower.aimAngle) * bombConfig.throwSpeed,
    fuseMs: bombConfig.fuseMs,
    exploded: false,
    thrower: thrower.index
  };
  
  this.bombs.push(bomb);
}
```

### 連鎖爆炸系統
```typescript
// 遞迴連鎖爆炸
explodeBomb(bomb: Bomb, depth: number = 0) {
  if (depth >= bombConfig.chainMaxDepth) return;
  
  // 爆炸效果
  this.createExplosionEffect(bomb.x, bomb.y);
  
  // 檢查範圍內其他炸彈
  this.bombs.forEach(otherBomb => {
    if (!otherBomb.exploded && 
        Phaser.Math.Distance.Between(bomb.x, bomb.y, otherBomb.x, otherBomb.y) 
        <= bombConfig.explodeRadius) {
      
      otherBomb.exploded = true;
      this.explodeBomb(otherBomb, depth + 1); // 遞迴引爆
    }
  });
}
```

## 遊戲四：桃樹彩票

### 四區域彩票系統
```typescript
// PeachLotteryScene - 桃樹彩票
interface LotteryZone {
  id: number;                   // 區域ID (0-3)
  bounds: Phaser.Geom.Rectangle; // 區域邊界
  peaches: Peach[];            // 桃子陣列
  hasTicket: boolean;          // 是否有彩票
  ticketPeachIndex: number;    // 彩票桃子索引
  players: LotteryPlayer[];    // 區域內玩家
}

interface Peach {
  x: number; y: number;        // 位置
  sprite: Phaser.GameObjects.Image;
  hasTicket: boolean;          // 是否含彩票
  picked: boolean;             // 已被摘取
}
```

### 淘汰機制
```typescript
// 淘汰輪次系統
class PeachLotteryScene {
  private eliminationRound = 0;          // 當前輪次
  private survivors: LotteryPlayer[];    // 倖存者
  private timeLimit = 10000;             // 10秒選擇時限
  
  // 淘汰邏輯
  processElimination() {
    const withTickets = this.survivors.filter(p => p.hasTicket);
    const withoutTickets = this.survivors.filter(p => !p.hasTicket);
    
    // 無票者淘汰
    withoutTickets.forEach(player => {
      player.eliminated = true;
    });
    
    this.survivors = withTickets;
    
    if (this.survivors.length <= 1) {
      this.endGame(); // 決出勝者
    } else {
      this.nextRound(); // 進入下一輪
    }
  }
}
```

## 通用設計模式

### 決勝慢動作系統
```typescript
// 剩1人時慢動作決勝
enterSlowMotion() {
  this.slowFactor = 0.35;           // 約1.2秒慢動作
  this.physics.world.timeScale = this.slowFactor;
  this.tweens.timeScale = this.slowFactor;
  
  // 1.2秒後恢復
  this.time.delayedCall(1200, () => {
    this.physics.world.timeScale = 1;
    this.tweens.timeScale = 1;
    this.showResults();
  });
}
```

### BOT AI弱化平衡
```typescript
// 統一的BOT難度調整
const botConfig = {
  moveSpeed: 220,           // 移動速度稍慢
  reactMs: 420,            // 反應延遲
  dangerMargin: 18,        // 危險迴避距離
  mistakeChance: 0.15,     // 犯錯機率
  decisionInterval: 300    // 決策間隔
};

// BOT決策節流
updateBotAI(bot: GameCharacter) {
  if (this.time.now < bot.nextDecideAt) return;
  
  bot.nextDecideAt = this.time.now + botConfig.decisionInterval;
  this.executeBotDecision(bot);
}
```

### 統一結算系統
```typescript
// 通用結算界面
class MinigameResults {
  private endButtons = [
    { text: '再玩一次', action: () => this.restart() },
    { text: '回選單', action: () => this.backToMenu() }
  ];
  
  private endSelected = 0;           // 鍵盤選擇索引
  private endHighlight?: Phaser.GameObjects.Rectangle; // 高亮框
  
  // 鍵盤導航
  navigateResults(direction: 'up' | 'down') {
    this.endSelected = (this.endSelected + offset) % this.endButtons.length;
    this.updateHighlight();
  }
}
```

**參考檔案**: `minigames/registry.ts`, `scenes/CollectRaceScene.ts`, `scenes/PushSurvivalScene.ts`, `scenes/BombArenaScene.ts`, `scenes/PeachLotteryScene.ts`
