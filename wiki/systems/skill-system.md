# 招式系統

## 系統架構升級 (P2-3重構 7bd6845)

### **完整控制器化**
招式系統已從GameScene完整抽取到獨立SkillController，實現一次性招式的模組化管理。

```typescript
// controllers/SkillController.ts - 招式控制器 (547行)
export class SkillController {
  constructor(private readonly host: SkillHost) {}
  
  // 6種一次性招式完整實作
  castSkill(caster: Character, skillType: SkillType, time: number): void
}

// SkillHost介面 - GameScene能力開放
export interface SkillHost {
  readonly scene: Phaser.Scene;
  readonly enemies: Phaser.Physics.Arcade.Group;
  damageEnemy(actor: Character, enemy: Enemy, ...): void;
  beginTimeStop(owner: Character, time: number, durationMs: number): void;
  // ...招式執行必要能力
}
```

## 六大招式系統

### **A - 旋風場 (Tornado)**
```typescript
// 角色周圍360度旋轉傷害場
private castTornado(caster: Character, time: number): void {
  const tornado = this.scene.add.graphics();
  const radius = GameConfig.skills.tornado.radius; // 120px
  
  // 旋轉動畫 + 持續傷害判定
  this.scene.tweens.add({
    targets: tornado,
    rotation: Math.PI * 4, // 2圈旋轉
    duration: GameConfig.skills.tornado.durationMs,
    onUpdate: () => this.updateTornadoHitcheck(caster, radius, time)
  });
}
```

**技能特色**:
- 🌪️ **範圍傷害**: 半徑120px圓形範圍
- ⏱️ **持續效果**: 2秒持續旋轉傷害
- 🎯 **跟隨移動**: 傷害場跟隨角色移動
- 💥 **擊退效果**: 命中敵人產生擊退

### **B - 環繞落雷 (Lightning)**
```typescript
// 角色周圍8方向閃電攻擊
private castLightning(caster: Character, time: number): void {
  const directions = 8;
  const radius = GameConfig.skills.lightning.radius; // 150px
  
  for (let i = 0; i < directions; i++) {
    const angle = (i * Math.PI * 2) / directions;
    const x = caster.x + Math.cos(angle) * radius;
    const y = caster.y + Math.sin(angle) * radius;
    
    this.createLightningStrike(x, y, time);
  }
}
```

**技能特色**:
- ⚡ **8方向攻擊**: 角色周圍均勻分布8道閃電
- 📍 **固定位置**: 施放瞬間確定攻擊位置
- 🔥 **範圍判定**: 每道閃電50px範圍傷害
- ✨ **視覺特效**: 閃電圖形+爆炸環形特效

### **C - 居合來回斬 (Slash)**
```typescript
// 直線穿刺攻擊，來回2段
private castSlash(caster: Character, time: number): void {
  const facingAngle = this.getFacingAngle(caster);
  const slashDistance = GameConfig.skills.slash.distance; // 200px
  
  // 第一段：向前穿刺
  this.performSlashSegment(caster, facingAngle, slashDistance, time, () => {
    // 第二段：原路返回
    this.performSlashSegment(caster, facingAngle + Math.PI, slashDistance, time);
  });
}
```

**技能特色**:
- ⚔️ **來回攻擊**: 前進+返回2段連續攻擊
- 📏 **直線判定**: 矩形範圍直線傷害判定
- 🎯 **朝向攻擊**: 依據角色面向方向執行
- 🏃 **位移技能**: 角色實際移動執行攻擊

### **E - 跳砸震爆 (Earthquake)**
```typescript
// 跳躍砸地範圍攻擊
private castEarthquake(caster: Character, time: number): void {
  // 跳躍階段
  this.scene.tweens.add({
    targets: caster,
    scaleY: 1.5, // 視覺拉伸效果
    duration: 300,
    yoyo: true,
    onComplete: () => {
      // 落地震爆
      this.performEarthquakeBlast(caster, time);
    }
  });
}
```

**技能特色**:
- 🦘 **跳躍動作**: 角色跳躍拉伸視覺效果
- 💥 **範圍爆炸**: 落地後大範圍圓形傷害
- 📱 **震動反饋**: 螢幕震動增強打擊感
- 🌊 **擴散特效**: 衝擊波視覺擴散效果

### **F - 十字噴火 (Fire)**
```typescript
// 十字方向火焰攻擊 + 持續燒灼
private castFire(caster: Character, time: number): void {
  const fireDirections = [0, Math.PI/2, Math.PI, Math.PI*3/2]; // 上下左右
  
  fireDirections.forEach(angle => {
    this.createFireBeam(caster, angle, time);
  });
  
  // 燒灼地面效果
  this.createBurningGround(caster.x, caster.y, time);
}
```

**技能特色**:
- 🔥 **十字攻擊**: 上下左右4方向同時攻擊
- 🌡️ **燒灼效果**: 地面持續燒灼傷害
- 📐 **矩形判定**: 每個方向矩形範圍判定
- ⏰ **持續傷害**: 燒灼區域持續3秒傷害

### **T - 時停連斬 (Time Stop)**
```typescript
// 全場時停 + 連續攻擊
private castTimeStop(caster: Character, time: number): void {
  const duration = GameConfig.skills.timeStop.durationMs; // 3000ms
  
  // 啟動全場時停
  this.host.beginTimeStop(caster, time, duration);
  
  // 時停期間連續攻擊
  for (let i = 0; i < 6; i++) {
    this.scene.time.delayedCall(i * 500, () => {
      this.performTimeStopSlash(caster, time + i * 500);
    });
  }
}
```

**技能特色**:
- ⏸️ **時停機制**: 除施法者外全場凍結3秒
- ⚔️ **連續攻擊**: 時停期間6次連續攻擊
- 🎯 **自動瞄準**: 每次攻擊自動選擇最近敵人
- ✨ **特殊視效**: 時停期間畫面特效處理

## 幾何判定系統整合

### **共用幾何函式** (systems/geometry.ts)
```typescript
// P2-3抽取的共用幾何判定
export function pointInOrientedRect(
  px: number, py: number,           // 點座標
  ox: number, oy: number,           // 矩形起點
  dir: number,                      // 方向角度
  nearOffset: number,               // 近端偏移
  length: number, width: number     // 長寬
): boolean {
  // 旋轉矩形點判定實作
}
```

**應用場景**:
- 🗡️ **居合斬判定**: 直線矩形攻擊範圍
- 🔥 **火焰射線**: 十字方向矩形判定
- 👊 **BOSS攻擊**: 各種方向性攻擊判定
- 🏗️ **建築碰撞**: 結構物件矩形判定

## 招式配置參數

### **技能數值配置**
```typescript
// config.ts - 招式參數設定
skills: {
  tornado: {
    radius: 120,              // 旋風半徑
    durationMs: 2000,         // 持續時間
    damage: 25,               // 基礎傷害
    tickMs: 200               // 傷害間隔
  },
  
  lightning: {
    radius: 150,              // 攻擊半徑
    strikeRadius: 50,         // 單發範圍
    damage: 40,               // 單發傷害
    count: 8                  // 攻擊方向數
  },
  
  slash: {
    distance: 200,            // 穿刺距離
    width: 60,                // 攻擊寬度
    damage: 35,               // 單段傷害
    speed: 800                // 移動速度
  },
  
  earthquake: {
    radius: 180,              // 爆炸半徑
    damage: 50,               // 爆炸傷害
    shakeMs: 500              // 震動時長
  },
  
  fire: {
    beamLength: 250,          // 火焰射程
    beamWidth: 40,            // 火焰寬度
    damage: 20,               // 直接傷害
    burnDamage: 10,           // 燒灼傷害
    burnDurationMs: 3000      // 燒灼持續
  },
  
  timeStop: {
    durationMs: 3000,         // 時停時長
    slashCount: 6,            // 攻擊次數
    slashDamage: 30,          // 單次傷害
    slashInterval: 500        // 攻擊間隔
  }
}
```

## 技術架構優勢

### **Controller模式效益**
- ✅ **模組化**: 547行招式邏輯完整獨立
- ✅ **可測試**: SkillController可單獨單元測試
- ✅ **可擴展**: 新招式可輕鬆加入系統
- ✅ **介面清晰**: SkillHost明確定義依賴能力

### **Host介面設計**
- 🔒 **封裝保護**: 不直接存取GameScene內部狀態
- 🎯 **能力導向**: 只開放招式執行必要的場景能力
- 📋 **契約明確**: 介面定義清楚招式與場景的協作
- 🧪 **依賴注入**: 便於測試與模擬場景環境

### **共用系統整合**
- ♻️ **代碼重用**: 幾何判定函式與BOSS系統共用
- 🎯 **標準化**: 統一的矩形判定邏輯
- 🔧 **維護性**: 判定邏輯集中維護，避免重複
- 📐 **精確性**: 數學正確的幾何判定實作

## P2-3重構技術成果

### **代碼抽取統計**
- **SkillController.ts**: +547行 (招式系統完整抽取)  
- **systems/geometry.ts**: +36行 (幾何判定共用)
- **GameScene.ts**: -510行 (招式相關代碼移除)
- **行為保證**: 固定種子回歸測試確認功能不變

### **架構模式建立**
- 🏗️ **Host介面標準**: 為Controller定義場景能力介面
- 📦 **系統封裝**: 相關功能完整封裝在單一Controller
- 🔗 **依賴注入**: Controller通過介面獲得場景能力
- 🧩 **模組組合**: GameScene變為Controller的組合與協調

**參考檔案**:
- `controllers/SkillController.ts` (主控制器 547行)
- `systems/geometry.ts` (共用幾何判定)
- `scenes/GameScene.ts` (SkillHost介面實作)  
- commit 7bd6845 (P2-3重構記錄)
