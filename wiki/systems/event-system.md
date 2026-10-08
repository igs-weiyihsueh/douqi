# 事件系統

## 系統架構升級 (方案B B-1重構 7bb93c4)

### **完整控制器化**
事件系統已從GameScene完整抽取到獨立EventController，實現限時事件的模組化管理。

```typescript
// controllers/EventController.ts - 事件控制器 (879行)
export class EventController {
  constructor(private readonly host: EventHost) {}
  
  // 三種限時事件完整管理
  startEvent(kind: EventKind, ...args): void
  private handleEventProgress(): void
  private completeEvent(success: boolean): void
}

// EventHost介面 - GameScene能力開放
export interface EventHost {
  readonly scene: Phaser.Scene;
  readonly enemies: Phaser.Physics.Arcade.Group;
  arena(): Phaser.Geom.Rectangle;
  currentSlot(): Phaser.Geom.Rectangle;
  showEventBanner(text: string): void;
  onEventEnded(): void;
  // ...事件執行必要能力
}
```

## 三大限時事件系統

### **塔事件 (Tower)**
```typescript
// 摧毀尖塔限時事件
interface TowerEvent {
  target: Enemy;           // 尖塔敵人物件
  maxHp: number;          // 基礎血量 + 波次成長
  attackInterval: number; // 扇形攻擊間隔
  attackRange: number;    // 扇形攻擊範圍
}

// 塔生成位置：移動區中央
private spawnTower(): Enemy {
  const arena = this.host.arena();
  const centerX = arena.centerX;
  const centerY = arena.centerY;
  
  const tower = this.host.enemies.create(centerX, centerY, 'tower');
  tower.enemyType = 'tower';
  tower.isBoss = false;
  tower.hp = this.calculateTowerHp(); // 波次成長血量
  
  return tower;
}
```

**塔攻擊系統**:
- 🏰 **扇形攻擊**: 120度扇形範圍，自動瞄準最近角色
- ⚡ **攻擊間隔**: 3秒固定間隔，可被時停延遲
- 📐 **傷害判定**: 使用geometry.ts共用判定函式
- 🎯 **血量成長**: 基礎100HP + 波次×20HP

### **守護事件 (Guard)**
```typescript
// 守護NPC限時事件
interface GuardEvent {
  target: Enemy;           // 守護目標NPC
  maxHp: number;          // NPC血量
  currentHp: number;      // 當前血量
  guardRadius: number;    // 守護範圍半徑
  spawnInterval: number;  // 敵人生成間隔
}

// 統一守護目標命中處理
private hitGuardNpc(damage: number, fromX: number, fromY: number): void {
  if (!this.guardTarget || this.guardTarget.hp <= 0) return;
  
  // 扣血與視覺反饋
  this.guardTarget.hp -= damage;
  this.host.flashEnemy(this.guardTarget);
  
  // 失敗檢查
  if (this.guardTarget.hp <= 0) {
    this.completeEvent(false); // 守護失敗
  }
}
```

**守護機制**:
- 🛡️ **NPC保護**: 血量管理，受傷反饋，失敗檢測
- 👥 **敵人生成**: 定期在守護範圍外生成攻擊者
- 💔 **失敗條件**: NPC血量歸零即守護失敗
- 🔥 **傷害來源**: 近戰、~~雷射~~、炸彈、~~子彈~~等攻擊統一處理 (ad47c9c簡化為近戰+炸彈)

### **佔領事件 (Capture)**
```typescript
// 佔領據點限時事件
interface CaptureEvent {
  captureCenter: { x: number; y: number }; // 佔領圓心
  captureRadius: number;                   // 佔領半徑
  progress: number;                        // 佔領進度 (0-100)
  progressRate: number;                    // 進度增加速率
  requiredProgress: number;                // 完成所需進度
}

// 佔領進度計算 (只看P1)
private updateCaptureProgress(): void {
  const player = this.host.player();
  const inCircle = this.isInCaptureCircle(player);
  
  if (inCircle && !this.host.isGameOver()) {
    this.captureProgress += this.captureProgressRate;
    
    if (this.captureProgress >= 100) {
      this.completeEvent(true); // 佔領成功
    }
  }
}
```

**佔領機制**:
- ⭕ **圓形區域**: 視覺圓圈標示佔領範圍
- 👤 **P1專屬**: 只有P1角色進入圓圈才計算進度
- 📈 **進度累積**: 持續停留累積進度，離開停止
- ✅ **完成條件**: 進度達到100%即佔領成功

## 開場演出系統

### **四階段開場流程**
```typescript
// 開場演出完整流程
type IntroStage = 'introMove' | 'unified' | 'perEvent' | 'done';

class IntroSequence {
  // 階段1: 角色走位 (1.5秒)
  private startIntroMove(): void {
    this.host.characters().forEach(char => {
      const targetPos = this.calculateIntroPosition(char);
      this.moveCharacterTo(char, targetPos, 1500);
    });
  }
  
  // 階段2: 統一大字顯示 (2秒)
  private showUnifiedMessage(): void {
    const messages = {
      tower: '摧毀尖塔！',
      guard: '守護目標！', 
      capture: '佔領據點！'
    };
    
    this.host.showEventBanner(messages[this.eventKind]);
  }
  
  // 階段3: 事件聚焦 (1.5秒)
  private focusOnEvent(): void {
    const focusTarget = this.getEventTarget();
    this.smoothCameraFocus(focusTarget, 1500);
  }
  
  // 階段4: 開場結束
  private completeIntro(): void {
    this.introStage = 'done';
    this.host.enableFollow(this.host.currentSlot());
  }
}
```

**開場特色**:
- 🎬 **角色走位**: 所有角色移動到事件區域
- 📢 **統一提示**: 大字橫幅說明事件目標
- 🎥 **鏡頭聚焦**: 平滑聚焦到事件目標物件
- 🔄 **跟隨恢復**: 聚焦完成後恢復跟隨P1

## 鏡頭聚焦系統

### **智能聚焦機制**
```typescript
// 鏡頭聚焦與跟隨系統
class CameraSystem {
  // 平滑聚焦到目標
  private focusCamera(target: { x: number; y: number }, duration: number): void {
    const camera = this.host.scene.cameras.main;
    
    camera.stopFollow(); // 停止跟隨P1
    
    // 平滑移動到目標
    this.host.scene.tweens.add({
      targets: camera,
      scrollX: target.x - camera.width / 2,
      scrollY: target.y - camera.height / 2,
      duration: duration,
      ease: 'Power2',
      onComplete: () => {
        this.onFocusComplete();
      }
    });
  }
  
  // 恢復跟隨P1 (限制在當前slot內)
  enableFollow(slot: Phaser.Geom.Rectangle): void {
    const camera = this.host.scene.cameras.main;
    const player = this.host.player();
    
    // 設定跟隨邊界
    camera.setBounds(slot.x, slot.y, slot.width, slot.height);
    camera.startFollow(player);
  }
}
```

**鏡頭特色**:
- 🎯 **事件聚焦**: 開場時自動聚焦事件目標
- 🏃 **跟隨恢復**: 聚焦完成後恢復跟隨P1
- 📏 **邊界限制**: 跟隨限制在當前slot範圍內
- 🌊 **平滑過渡**: 聚焦和恢復都有平滑動畫

## 事件配置參數

### **事件數值配置**
```typescript
// config.ts - 事件參數設定
events: {
  tower: {
    baseHp: 100,              // 基礎血量
    hpPerWave: 20,            // 每波次血量增長
    attackInterval: 3000,     // 攻擊間隔(ms)
    attackRange: 120,         // 扇形攻擊角度
    attackDamage: 25          // 攻擊傷害
  },
  
  guard: {
    npcHp: 80,               // NPC血量
    spawnInterval: 2000,     // 敵人生成間隔
    guardRadius: 100,        // 守護範圍
    spawnDistance: 150       // 敵人生成距離
  },
  
  capture: {
    radius: 80,              // 佔領圓圈半徑
    progressRate: 2,         // 進度增長速率(/秒)
    requiredProgress: 100,   // 完成所需進度
    circleColor: 0x00FF00    // 圓圈顏色(綠色)
  }
}
```

### **開場演出配置**
```typescript
// 開場演出時間配置
intro: {
  moveDuration: 1500,        // 角色走位時長
  unifiedDuration: 2000,     // 統一大字顯示時長
  focusDuration: 1500,       // 鏡頭聚焦時長
  messageColor: '#FFD700',   // 提示文字顏色
  focusEase: 'Power2'        // 聚焦動畫緩動
}
```

## 技術架構優勢

### **Controller模式效益**
- ✅ **模組化**: 879行事件邏輯完整獨立
- ✅ **可測試**: EventController可單獨單元測試
- ✅ **可擴展**: 新事件類型可輕鬆加入系統
- ✅ **生命週期**: create()時重建，比resetState更徹底

### **EventHost介面設計**
- 🔒 **封裝保護**: 不直接存取GameScene內部狀態
- 🎯 **能力導向**: 只開放事件執行必要的場景能力
- 📋 **契約明確**: 介面定義清楚事件與場景的協作
- 🧪 **依賴注入**: 便於測試與模擬場景環境

### **代碼優化成果**
- ♻️ **重複合併**: 四段hitGuardNpc邏輯統一為單一實作
- 🔄 **回調標準**: onTowerDestroyed()、onTimeStopEnd()統一
- 🧹 **代碼清理**: 移除未使用eventPlayerCount，數值常數化
- 📝 **註解更新**: 過時註解修正，新增清晰說明

## 方案B B-1重構技術成果

### **代碼抽取統計**
- **EventController.ts**: +879行 (事件系統完整抽取)
- **GameScene.ts**: -865行 (事件相關代碼移除)
- **淨變化**: +972行新增，-772行重構
- **核心瘦身**: GameScene從6,301行降到5,621行 (-680行)

### **零行為變更保證**
```typescript
// 完整測試驗證
const testScenarios = [
  '三種事件 × 成功/失敗模式',
  '時停順延正確處理',
  '快速模式兼容測試',
  '開場途中重開測試'
];

// 決定性比對：新舊build完全一致
// 銳騎審查通過，部署成功 index-C5t0t0Q8.js
```

### **架構模式建立**
- 🏗️ **Host介面標準**: 第四個Controller+Host組合
- 📦 **系統封裝**: 相關功能完整封裝在單一Controller
- 🔗 **依賴注入**: Controller通過介面獲得場景能力
- 🧩 **模組組合**: GameScene變為四Controller的組合協調

**方案B B-1事件系統拆分成功，為GameScene極致瘦身計劃奠定重要基礎！**

**參考檔案**:
- `controllers/EventController.ts` (主控制器 879行)
- `scenes/GameScene.ts` (EventHost介面實作)
- commit 7bb93c4 (B-1事件系統拆分完成)
- 方案B進度: B-2 slot世界、B-3攻擊AI、B-4除錯API (進行中)
