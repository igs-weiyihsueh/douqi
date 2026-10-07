# 資料流程與系統關係

## 遊戲狀態管理

### 核心狀態機
```typescript
// GameScene 主狀態追蹤
class GameScene {
  // 遊戲進度狀態
  private survivalMs = 0;           // 生存時間
  private gameOver = false;         // 遊戲結束標記
  private currentWave = 1;          // 當前波次
  
  // 波次系統狀態
  private waveState: 'spawning' | 'clearing' | 'intermission' | 'boss' | 'event';
  private waveQuota = 0;            // 本波目標擊殺數
  private waveKilled = 0;           // 本波已擊殺數
  private waveSpawned = 0;          // 本波已生成數
}
```

### 角色狀態系統
```typescript
// Character 複合狀態
class Character {
  // 基礎屬性
  hp: number;                    // 生命值
  spirit: number;                // 連段計數
  energy: number;                // 能量值(v55新增)
  credit: number;                // 貨幣點數
  kills: number;                 // 擊殺數
  alive: boolean;                // 存活狀態
  
  // 戰鬥狀態
  invulnUntil: number;          // 無敵時間戳
  dashShielded: boolean;         // 衝刺護盾
  skillLockUntil: number;        // 技能鎖定時間戳
  isDashing: boolean;            // 衝刺狀態
  isBursting: boolean;           // 爆發狀態
  
  // 強化系統 (雙模式)
  empowerUntil: number;         // 快速模式強化時間戳
  empowered: boolean;           // 慢速模式強化標記
  
  // 位置與目標
  aimAngle: number;             // 瞄準角度
  lockedTarget: GameObject;      // 鎖定目標
}
```

## 物理系統數據流

### 碰撞檢測層級
```typescript
// 物理群組管理
class GameScene {
  private characters: Character[];                    // 角色陣列
  private enemies: Phaser.Physics.Arcade.Group;      // 敵人物理群組
  private items: Phaser.Physics.Arcade.Group;        // 道具群組
  private bullets: Phaser.Physics.Arcade.Group;      // 子彈群組
  private breakables: Phaser.GameObjects.Group;      // 可破壞物(非物理)
}

// 碰撞關係設定
this.physics.add.overlap(characters, enemies, handleCharacterEnemyCollision);
this.physics.add.overlap(characters, items, handleItemPickup);
this.physics.add.overlap(bullets, enemies, handleBulletHit);
```

### 敵人分離系統
```typescript
// config.ts - 敵人碰撞分離配置
enemySeparation: {
  enabled: true,
  radiusPx: 44,              // 影響半徑
  weight: 1.1,               // 分離力權重
  iterations: 2,             // 硬解迭代次數
  maxStepPx: 9              // 單幀最大推移
}

// 軟分離 + 硬解重疊
finalDirection = normalize(
  normalize(toTarget) + separation * weight
);
```

## 敵人AI系統

### 黏著目標機制
```typescript
// config.ts - 黏著目標配置
enemySticky: {
  stickyBreakRadius: 800,     // 解綁距離閾值
  stickyBreakSec: 1          // 解綁持續時間
}

// AI邏輯流程
Enemy.update() {
  // 1. 檢查黏著目標是否需要重綁
  if (distanceToTarget > stickyBreakRadius && 
      breakTimer > stickyBreakSec) {
    this.findNewTarget();
  }
  
  // 2. 執行AI行為
  this.updateAI();
}
```

### 敵人狀態機
```typescript
// Enemy AI狀態轉換
enum AIState {
  PATROL = 'patrol',           // 巡邏
  ALERT = 'alert',            // 警戒追擊
  CHARGE = 'charge',          // 蓄力攻擊
  ATTACK = 'attack',          // 執行攻擊
  COOLDOWN = 'cooldown'       // 攻擊冷卻
}

// 狀態轉換邏輯
updateAI() {
  switch(this.aiState) {
    case 'patrol': 
      if (playerInRange) this.aiState = 'alert';
      break;
    case 'alert':
      if (closeEnoughToAttack) this.startCharge();
      break;
    // ...其他狀態處理
  }
}
```

## 生成系統架構

### 波次管理流程
```typescript
// 波次生命週期
'spawning' → 'clearing' → 'intermission' → ('boss' | next wave)

// 生成控制系統
updateSpawning() {
  // 1. 檢查生成觸發條件
  if (shouldSpawnMore(waveState)) {
    // 2. 執行生成邏輯
    this.spawnFormation();
    this.waveFormations++;
  }
  
  // 3. 檢查波次完成條件
  if (waveKilled >= waveQuota) {
    this.transitionToIntermission();
  }
}
```

### 動態難度調整
```typescript
// config.ts - levelLerp函數
export function levelLerp(lv1Value: number, lv10Value: number, level: number): number {
  const t = (level - 1) / 9;  // 0~1 mapping
  return lv1Value + t * (lv10Value - lv1Value);
}

// 使用範例
const currentDamage = levelLerp(15, 25, teamLevel);  // Lv1:15 → Lv10:25
const spawnRate = levelLerp(1000, 500, teamLevel);   // 生成間隔隨等級縮短
```

## UI狀態同步

### GameScene ↔ UIScene通訊
```typescript
// GameScene 狀態更新
updateCharacters() {
  this.characters.forEach(char => {
    char.update();  // 更新角色狀態
  });
  
  // 通知UI更新
  const uiScene = this.scene.get('UIScene') as UIScene;
  uiScene.updateHealthBars(this.characters);
}

// UIScene 響應狀態變化
updateHealthBars(characters: Character[]) {
  characters.forEach((char, index) => {
    this.healthBars[index].setPercent(char.hp / char.maxHp);
  });
}
```

### 角色腳下UI同步
```typescript
// Character.syncLabel() - 每幀更新
syncLabel() {
  // 位置跟隨
  this.label.setPosition(this.x, this.y + 32);
  
  // 狀態同步
  this.updateHealthBar();     // 血條
  this.updateSpiritBar();     // 連段條
  this.updateBurstMark();     // 爆發標記
  this.updateRootMark();      // 定身標記
}
```

## 事件驅動系統

### 關卡進程管理
```typescript
// 關卡狀態機
private progressPhase: 'playing' | 'choosing' | 'panning' | 'exiting' | 'transition';

// 跨區域系統
private crossPhase: 'walk' | 'panning' | 'enter';
private crossSide: 'L' | 'R' | null;

// 事件洗牌系統
private eventBag: string[] = [];  // tower/guard/capture輪流出現

updateLevelProgress() {
  switch(this.progressPhase) {
    case 'playing':
      if (subWavesDone >= subWavesTarget) {
        this.enterChoosing();
      }
      break;
    case 'choosing':
      if (playerMadeChoice) {
        this.startPanning();
      }
      break;
    // ...其他階段處理
  }
}
```

### 配置驅動的行為
```typescript
// 所有遊戲行為都由配置驅動
const config = GameConfig.enemy.types.normal;
enemy.setMaxHealth(config.hp);
enemy.setMoveSpeed(config.moveSpeed);
enemy.setDamage(config.damage);

// 動態調整
const scaledHP = levelLerp(config.hp * 0.5, config.hp, teamLevel);
```

**參考檔案**: `scenes/GameScene.ts:1-100行`, `objects/Character.ts:50-100行`, `config.ts:100-150行`
