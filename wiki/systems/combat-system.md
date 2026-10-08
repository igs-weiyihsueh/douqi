# 戰鬥系統技術文檔

## 戰鬥核心架構

### 多角色系統
```typescript
// GameScene - 4角色本地協作
class GameScene {
  private characters: Character[] = [];    // 最多4個角色
  
  // P1玩家控制
  private get player(): Character {
    return this.characters[0];             // 索引0固定為玩家
  }
  
  // 角色管理
  addBot(): void {
    if (this.characters.length < 4) {
      const bot = new Character(this, x, y, this.characters.length, true);
      this.characters.push(bot);
    }
  }
}
```

### Character核心狀態
```typescript
// Character - 角色基類 (P1 + BOT共用)
class Character extends Phaser.Physics.Arcade.Sprite {
  // 基礎屬性
  readonly index: number;           // 角色索引 (0-3)
  readonly isBot: boolean;          // AI標記
  
  // 生命系統
  hp: number;                       // 當前血量
  alive: boolean;                   // 存活狀態
  invulnUntil: number;             // 無敵時間戳
  
  // 戰鬥狀態
  spirit: number;                   // 連段計數
  energy: number;                   // 能量值(v55新增)
  kills: number;                    // 擊殺數
  credit: number;                   // 貨幣點數
  
  // 技能系統
  skillLockUntil: number;          // 技能鎖定時間戳
  isDashing: boolean;               // 衝刺狀態
  isBursting: boolean;              // 爆發狀態
  empowerUntil: number;            // 快速模式強化時間戳
  empowered: boolean;               // 慢速模式強化標記
}
```

## 敵人系統架構

### 敵人類型體系
```typescript
// Enemy類型定義
export type EnemyType = 'normal' | 'tank' | 'bomber' | 'boss' | 'tower' | 'npc' | 'treasure';

// 基於配置的敵人屬性
const enemyConfig = {
  normal: { hp: 90, moveSpeed: 45, damage: 15 },
  tank: { hp: 320, moveSpeed: 30, damage: 20 },
  shielder: { hp: 150, shield: 50, moveSpeed: 40 }
  // ... 其他類型
};
```

### 敵人AI系統
```typescript
// 黏著目標機制
enemySticky: {
  stickyBreakRadius: 800,    // 解綁距離閾值
  stickyBreakSec: 1         // 解綁持續時間(防抖)
}

// AI狀態機
enum AIState {
  PATROL = 'patrol',         // 巡邏
  ALERT = 'alert',          // 警戒追擊
  CHARGE = 'charge',        // 蓄力攻擊
  ATTACK = 'attack',        // 執行攻擊
  COOLDOWN = 'cooldown'     // 攻擊冷卻
}
```

### 敵人分離系統
```typescript
// config.ts - 敵人碰撞分離
enemySeparation: {
  enabled: true,
  radiusPx: 44,              // 影響半徑(像素)
  weight: 1.1,               // 分離力權重
  iterations: 2,             // 硬解重疊迭代次數
  maxStepPx: 9              // 單幀最大推移(防瞬移)
}

// 分離算法：軟steering + 硬de-overlap
finalDirection = normalize(
  normalize(targetDirection) + 
  separationForce * weight
);
```

## 波次系統核心

### WaveSpawnState狀態機
```typescript
// systems/waveMath.ts - 波次進度數學
export interface WaveSpawnState {
  progress: number;          // 本波已累積進度
  targetProgress: number;    // 本波目標進度
  alive: number;             // 場上活怪數
  pending: number;           // 登場預警中的怪數
  maxAlive: number;          // 同時存在上限
  spawnThreshold: number;    // 補生觸發閾值
  refilling: boolean;        // 補生栓狀態
}
```

### 生成控制邏輯
```typescript
// 聰明停生算法
export function shouldSpawnMore(s: WaveSpawnState): boolean {
  const occupancy = s.alive + s.pending;
  
  // ① 生產總量封頂
  if (s.progress + occupancy >= s.targetProgress) return false;
  
  // ② 場上數量上限
  if (occupancy >= s.maxAlive) return false;
  
  // ③ 補生中才生成
  return s.refilling;
}

// 補生栓機制(防抖)
export function updateRefillLatch(
  occupancy: number, 
  maxAlive: number, 
  spawnThreshold: number, 
  refilling: boolean
): boolean {
  if (!refilling && occupancy < spawnThreshold) return true;   // 跌破→開啟
  if (refilling && occupancy >= maxAlive) return false;        // 補滿→關閉
  return refilling;                                            // 維持狀態
}
```

### 波次推進判定
```typescript
// 過波條件
export function shouldAdvanceSpawn(
  progress: number,
  targetProgress: number,
  alive: number,
  pending: number,
  nextSegmentSpawns: boolean
): boolean {
  if (progress < targetProgress) return false;
  
  if (nextSegmentSpawns) {
    return true;                    // 下段還刷怪→直接推進
  } else {
    return alive <= 0 && pending <= 0;  // 下段非刷怪→清空才推
  }
}
```

## 技能系統設計

### 技能鎖定機制
```typescript
// 技能演出鎖定 (v13+)
class Character {
  skillLockUntil: number = 0;      // 鎖定結束時間戳
  
  // 鎖定期間：無敵 + 定身 + 不可操控
  isSkillLocked(): boolean {
    return this.scene.time.now < this.skillLockUntil;
  }
}

// 進入技能演出
enterPerformance(character: Character, lockMs: number) {
  character.skillLockUntil = Math.max(
    character.skillLockUntil,
    this.time.now + lockMs
  );
}
```

### 雙模式技能系統
```typescript
// Fast模式：時間戳強化
class FastModeSkills {
  empowerUntil: number;            // 強化結束時間戳
  
  autoEmpower(character: Character) {
    character.empowerUntil = this.time.now + durationMs;
    character.spirit = 0;          // 歸零重新累積
  }
}

// Slow模式：消耗式強化
class SlowModeSkills {
  empowered: boolean;              // 強化狀態標記
  energy: number;                  // 0-10能量值
  
  updateEmpowered(character: Character, delta: number) {
    if (character.empowered && character.energy > 0) {
      character.energy -= drainPerSec * (delta / 1000);
      if (character.energy <= 0) {
        character.empowered = false;  // 能量耗盡解除
      }
    }
  }
}
```

## 碰撞檢測系統

### 多層碰撞架構
```typescript
// 物理群組管理
class GameScene {
  private enemies: Phaser.Physics.Arcade.Group;     // 敵人物理群組
  private items: Phaser.Physics.Arcade.Group;       // 道具群組
  private bullets: Phaser.Physics.Arcade.Group;     // ~~子彈群組~~ (ad47c9c已移除)
  private breakables: Phaser.GameObjects.Group;     // 可破壞物(非物理)
  
  // 碰撞關係設定
  setupCollisions() {
    this.physics.add.overlap(this.characters, this.enemies, this.handleCharacterEnemyCollision);
    this.physics.add.overlap(this.characters, this.items, this.handleItemPickup);
    this.physics.add.overlap(this.bullets, this.enemies, this.handleBulletHit);
  }
}
```

### 自定義距離檢測
```typescript
// 高精度命中判定(避免高速穿透)
function checkCircleCollision(a: GameObject, b: GameObject): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const effectiveRadius = a.radius + b.getBodyRadius();
  return distance <= effectiveRadius;
}

// 衝刺命中檢測修正
findFirstEnemyInRangeOf(x: number, y: number, radius: number) {
  return enemies.find(enemy => {
    const distance = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
    return distance <= (radius + enemy.getBodyRadius()); // 加上敵人半徑
  });
}
```

## 視覺切換系統

### F4複合功能 (7975cc9更新)
```typescript
// F4複合切換：場景背景 + 敵人外觀
// 實際實作：F4 listener依序呼叫兩個函數
this.input.keyboard.on('keydown-F4', () => {
  this.toggleSceneBackground();        // 切換場景背景
  this.toggleNormalEnemyAppearance();  // 切換敵人外觀
});

// F6: 僅切換背景
this.input.keyboard.on('keydown-F6', () => {
  this.toggleSceneBackground();
});

// F2: 強制重載背景 (同一紋理key重載)
this.input.keyboard.on('keydown-F2', () => {
  this.forceReloadSceneBackground();
});
```
```

### 角色皮膚系統
```typescript
// 角色視覺覆蓋系統
class GameScene {
  private characterSkin: Phaser.GameObjects.Image | null = null;
  private characterUIOverlay: Phaser.GameObjects.Image | null = null;
  
  // 皮膚覆蓋P1角色
  updateCharacterSkin() {
    if (this.characterSkin) {
      this.characterSkin.setPosition(this.player.x, this.player.y);
      this.characterSkin.setRotation(this.player.rotation);
    }
  }
}
```

## COMBO獎勵系統

### 階段三COMBO機制
```typescript
// Character - COMBO狀態追蹤
comboState = {
  currentStreak: 0,          // 當前連殺數
  lastKillTime: 0,           // 上次擊殺時間戳
  ticketsEarned: 0,          // 獲得彩票數
  isWarning: boolean,        // 警告狀態(1.5-2秒間)
  nextMilestone: number,     // 下個里程碑
  
  // 待處理獎勵狀態
  pendingRewardIndex?: number,
  pendingRewardTickets?: number,
  pendingRewardMilestone?: number
};

// COMBO時間窗口檢查
updateComboStreak(character: Character) {
  const timeSinceLastKill = this.time.now - character.comboState.lastKillTime;
  const comboWindow = GameConfig.comboReward.COMBO_WINDOW_MS;
  
  if (timeSinceLastKill > comboWindow) {
    character.comboState.currentStreak = 0;  // 重置連擊
  }
}
```

**參考檔案**: `scenes/GameScene.ts`, `objects/Character.ts`, `objects/Enemy.ts`, `systems/waveMath.ts`, `config.ts`
