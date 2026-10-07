# BOSS戰鬥系統

## 系統架構重大升級 (P2-1重構 9782518)

### **完整控制器化** 
BOSS系統已從GameScene完整抽取到獨立Controller，實現模組化管理。

```typescript
// controllers/BossController.ts - 獨立BOSS控制器 (651行)
export class BossController {
  constructor(private host: BossHost) {}
  
  // BOSS完整生命週期管理
  spawnBoss(type: BossKind, isRandomIntru: boolean): void
  private handleBossAttack(boss: Enemy): void
  private handleBossDefeat(boss: Enemy): void
}

// BossHost介面 - GameScene能力開放
export interface BossHost {
  readonly scene: Phaser.Scene;
  readonly enemies: Phaser.Physics.Arcade.Group;
  arena(): Phaser.Geom.Rectangle;
  damageCharacter(c: Character, amount: number, ...): void;
  // ...更多場景能力
}
```

## 核心系統機制

### **BOSS登場系統**
```typescript
// BossController.ts - 登場位置計算
private calculateBossSpawnPosition(): { x: number, y: number } {
  const arena = this.host.arena();
  const margin = 100;
  
  // 在移動區邊緣隨機選擇登場點
  const sides = ['top', 'bottom', 'left', 'right'];
  const side = Phaser.Utils.Array.GetRandom(sides);
  
  return this.getPositionForSide(side, arena, margin);
}
```

**登場特效**:
- 🎭 **出場動畫**: 縮放+透明度漸現效果
- 🎵 **音效提示**: 專屬BOSS登場音效
- 📢 **事件橫幅**: "BOSS出現！"文字提示

### **三招攻擊系統**
```typescript
// BossController.ts - 攻擊技能循環
private selectBossSkill(boss: Enemy): BossSkillKind {
  const skills: BossSkillKind[] = ['dash', 'shoot', 'laser'];
  return Phaser.Utils.Array.GetRandom(skills);
}
```

#### **1. 衝刺攻擊 (Dash)**
```typescript
// 直線衝刺，命中角色造成傷害
private executeDashAttack(boss: Enemy): void {
  const target = this.selectDashTarget();
  const angle = Phaser.Math.Angle.Between(boss.x, boss.y, target.x, target.y);
  
  // 高速衝刺移動
  boss.setVelocity(
    Math.cos(angle) * GameConfig.enemy.boss.dashSpeed,
    Math.sin(angle) * GameConfig.enemy.boss.dashSpeed
  );
}
```

#### **2. 射擊攻擊 (Shoot)**
```typescript
// 發射多發子彈，扇形覆蓋
private executeShootAttack(boss: Enemy): void {
  const bulletCount = 5;
  const spreadAngle = Math.PI / 3; // 60度扇形
  
  for (let i = 0; i < bulletCount; i++) {
    const angle = baseAngle + (i - 2) * spreadAngle / 4;
    this.fireBossBullet(boss.x, boss.y, angle);
  }
}
```

#### **3. 雷射攻擊 (Laser)**
```typescript
// 蓄力雷射，附帶預警特效
private executeLaserAttack(boss: Enemy): void {
  // 建立預警特效
  const telegraph = this.createLaserTelegraph(boss);
  this.host.addTelegraph(telegraph);
  
  // 延遲發射雷射
  this.host.scene.time.delayedCall(1000, () => {
    this.fireLaser(boss, targetAngle);
    this.host.removeTelegraph(telegraph);
  });
}
```

### **亂入系統機制**
```typescript
// BossController.ts - 隨機亂入邏輯
private scheduleRandomIntrusion(): void {
  const delay = Phaser.Utils.Array.GetRandom([15000, 20000, 25000]); // 15-25秒
  
  this.host.scene.time.delayedCall(delay, () => {
    if (!this.host.isGameOver() && this.shouldSpawnIntruBoss()) {
      this.spawnBoss('random', true); // isRandomIntru = true
    }
    this.scheduleRandomIntrusion(); // 遞迴排程下次亂入
  });
}
```

**亂入特色**:
- ⏱️ **隨機時機**: 15-25秒間隔不定時出現
- 🎲 **隨機類型**: 從可用BOSS類型中隨機選擇
- 🏃 **快速離場**: 存活30秒後自動離場
- 💀 **屍體掉落**: 擊殺後留屍體(慢速模式)

### **命中與掉票系統**
```typescript
// BossController.ts - BOSS命中處理
private onBossHit(boss: Enemy, damage: number): void {
  // COMBO獎勵累積
  this.host.triggerComboHit(actor);
  
  // 傷害計算
  boss.hp -= damage;
  
  // 隨機掉票 (30%機率)
  if (Math.random() < 0.3) {
    this.host.dropItemAt(boss.x, boss.y, this.host.scene.time.now);
  }
  
  // 擊殺判定
  if (boss.hp <= 0) {
    this.handleBossDefeat(boss);
  }
}
```

### **屍體與變身系統** (慢速模式)
```typescript
// BossController.ts - 屍體管理
interface BossCorpse {
  img: Phaser.GameObjects.Image;
  hint: Phaser.GameObjects.Text;
  expireAt: number;
}

private spawnBossCorpse(x: number, y: number): void {
  const corpse: BossCorpse = {
    img: this.host.scene.add.image(x, y, 'boss_corpse'),
    hint: this.host.scene.add.text(x, y + 40, '按 Z 變身', {...}),
    expireAt: this.host.scene.time.now + 10000 // 10秒後消失
  };
  
  this.bossCorpses.push(corpse);
}
```

**變身機制**:
- ⏱️ **時效性**: 屍體存在10秒鐘
- 📍 **接近檢測**: P1距離屍體<50px時顯示提示
- ⌨️ **按鍵觸發**: 按Z鍵啟動變身
- 🎭 **視覺變身**: P1外觀切換為BOSS造型

## 預警特效系統

### **TelegraphFx統一管理**
```typescript
// systems/telegraphFx.ts - 預警特效型別
export interface TelegraphFx {
  owner: 'tower' | 'boss';           // 特效擁有者
  gfx: Phaser.GameObjects.Graphics;  // 圖形物件
  tween?: Phaser.Tweens.Tween;       // 填滿動畫
  fired: boolean;                    // 已發射標記
}
```

**應用場景**:
- 🔴 **BOSS雷射預警**: 蓄力期間紅色扇形填滿
- 🏰 **塔防攻擊預警**: 塔射擊前的瞄準指示
- ⏸️ **時停兼容**: 時停時暫停tween，解除時續播

### **預警生命週期**
```typescript
// BossController.ts - 預警特效管理
private createLaserTelegraph(boss: Enemy): TelegraphFx {
  const gfx = this.host.scene.add.graphics();
  const tween = this.host.scene.tweens.add({
    targets: { progress: 0 },
    progress: 1,
    duration: 1000,
    onUpdate: (tween) => {
      this.updateTelegraphGraphics(gfx, tween.getValue());
    }
  });
  
  return { owner: 'boss', gfx, tween, fired: false };
}
```

## 技術架構優勢

### **Controller模式效益**
- ✅ **職責分離**: GameScene專注場景管理，BossController專注BOSS邏輯
- ✅ **代碼簡化**: GameScene從8,059行降到7,682行 (-4.7%)
- ✅ **可測試性**: BossController可獨立單元測試
- ✅ **可擴展性**: 其他大型系統可比照抽取

### **介面驅動設計**
- 🔒 **封裝保護**: BossController不直接存取GameScene私有成員
- 🎯 **能力開放**: 透過BossHost介面獲得必要的場景功能
- 📋 **契約明確**: 介面定義清楚雙方的責任與依賴

### **狀態管理**
- 📦 **內聚性**: BOSS相關狀態完全封裝在Controller內
- 🔄 **生命週期**: 完整管理BOSS從登場到離場/擊殺的全過程
- 🧼 **內存安全**: 妥善清理圖形物件和計時器，防止內存洩漏

## 配置參數

### **BOSS基礎屬性**
```typescript
// config.ts - BOSS配置參數
boss: {
  hp: 100,                    // 基礎血量
  moveSpeed: 200,             // 移動速度
  dashSpeed: 800,             // 衝刺速度
  attackInterval: 3000,       // 攻擊間隔(ms)
  intruInterval: [15, 25],    // 亂入間隔範圍(秒)
  corpseLifetime: 10000       // 屍體存在時間(ms)
}
```

### **攻擊技能參數**
```typescript
// 衝刺攻擊
dash: {
  damage: 30,
  speed: 800,
  duration: 1000
},

// 射擊攻擊  
shoot: {
  bulletCount: 5,
  spreadAngle: 60,      // 度
  bulletSpeed: 400
},

// 雷射攻擊
laser: {
  damage: 50,
  chargeTime: 1000,     // 蓄力時間
  beamWidth: 80,
  range: 1000
}
```

**參考檔案**: 
- `controllers/BossController.ts` (主控制器 651行)
- `systems/telegraphFx.ts` (預警特效型別)
- `scenes/GameScene.ts` (BossHost介面實作)
- commit 9782518 (完整重構記錄)
