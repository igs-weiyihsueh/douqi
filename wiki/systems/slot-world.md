# slot世界系統

## 系統架構升級 (方案B B-2重構 cc7a433)

### **完整控制器化**
slot世界系統已從GameScene完整抽取到獨立SlotWorldController，實現區域世界管理的模組化。

```typescript
// controllers/SlotWorldController.ts - 世界控制器 (737行)
export class SlotWorldController {
  constructor(private readonly host: SlotWorldHost) {}
  
  // 三格slot佈局完整管理
  // 全出口支援統一處理
  // 轉場系統完整流程
  // 鏡頭跟隨控制機制
}

// SlotWorldHost介面 - GameScene能力開放
export interface SlotWorldHost {
  readonly scene: Phaser.Scene;
  characters(): ReadonlyArray<Character>;
  player(): Character;
  goIndicator(): GoIndicator;
  hiddenGate(): HiddenGateController;
  onAreaLeave(to: AreaTransition): void;
  clearArea(): void;  
  onAreaEnter(to: AreaTransition, side: Side): void;
  // ...世界管理必要能力
}
```

## 三格slot佈局系統

### **空間管理架構**
```typescript
// 三格世界佈局設計
interface SlotLayout {
  leftSlot: Phaser.Geom.Rectangle;    // 左區域 (1920×1080)
  centerSlot: Phaser.Geom.Rectangle;  // 中區域 (當前活動區)
  rightSlot: Phaser.Geom.Rectangle;   // 右區域 (1920×1080)
  
  // 移動區域計算 (扣除邊界)
  arena: Phaser.Geom.Rectangle;       // 當前可活動範圍
  walkBounds: Phaser.Geom.Rectangle;  // 出口開放時統一範圍
}

// 動態slot管理
class SlotManager {
  getCurrentSlot(): Phaser.Geom.Rectangle {
    return this.centerSlot; // 始終回傳中央區域
  }
  
  getArena(): Phaser.Geom.Rectangle {
    const slot = this.getCurrentSlot();
    const margin = GameConfig.world.arenaPadding; // 80px邊界
    
    return new Phaser.Geom.Rectangle(
      slot.x + margin,
      slot.y + margin, 
      slot.width - margin * 2,
      slot.height - margin * 2
    );
  }
}
```

**空間特色**:
- 🏗️ **三格設計**: 左中右1920×1080標準區域
- 📍 **中央活動**: 遊戲始終在中央slot進行
- 🚪 **邊界管理**: 80px邊界，出口開放時使用walkBounds
- 🔄 **動態計算**: arena依據當前slot和邊界動態計算

### **場景繪製系統**
```typescript
// 三格場景渲染管理
class SceneRenderer {
  // 繪製當前三格場景
  drawCurrentArea(variant: AreaVariant): void {
    const slots = [this.leftSlot, this.centerSlot, this.rightSlot];
    const palette = GameConfig.scene.levels[this.currentLevel];
    
    slots.forEach((slot, index) => {
      const sceneLayers = drawZoneScenery(
        this.host.scene, slot, variant, palette
      );
      this.sceneLayers.push(...sceneLayers);
    });
    
    // 繪製左右走廊連接
    this.drawCorridors(this.leftSlot, this.rightSlot);
  }
  
  // 轉場時回收背景
  recycleSlotBackground(side: Side, newSlot: Phaser.Geom.Rectangle): void {
    const oldLayers = this.getSlotLayers(side);
    destroyZoneScenery(oldLayers); // 銷毀舊背景
    
    // 重新繪製新位置
    const newLayers = drawZoneScenery(
      this.host.scene, newSlot, this.variant, this.palette
    );
    this.sceneLayers.push(...newLayers);
  }
}
```

## 全出口支援系統

### **出口類型統一管理**
```typescript
// 四種出口類型統一處理
type ExitType = 'left' | 'right' | 'up' | 'hidden';

interface ExitSystem {
  // 左右出口：同層平移
  leftExit: {
    position: { x: number; y: number };
    trigger: 'edge-touch';        // 碰邊緣觸發
    transition: 'side-panning';   // 平移轉場
  };
  
  // 上方出口：層級切換
  upExit: {
    position: { x: number; y: number };
    trigger: 'collision';         // 碰撞觸發
    transition: 'flash-black';    // 閃黑轉場
  };
  
  // 問號出口：雙重選擇
  questionExit: {
    leftQuestion: { x: number; y: number };   // 問號關
    rightNormal: { x: number; y: number };    // 正常關
    trigger: 'collision';
    transition: 'flash-black';
  };
  
  // 隱藏入口：獎勵關
  hiddenGate: {
    replaces: 'upExit';           // 取代上方出口
    target: 'treasureRoom';       // 目標獎勵關
    transition: 'flash-black';
  };
}
```

### **出口開放與觸發**
```typescript
// 出口開放統一管理
class ExitManager {
  openExits(availableExits: ExitType[]): void {
    availableExits.forEach(exitType => {
      this.createExitMarker(exitType);
      this.showGoIndicator(exitType);
    });
    
    // 開放出口時調整活動範圍
    this.updateWalkBounds(availableExits);
  }
  
  // 觸發檢測
  checkExitTriggers(player: Character): void {
    // 左右出口：邊緣觸發
    if (this.isLeftExitOpen && player.x <= this.leftSlot.left + 10) {
      this.triggerTransition('left');
    }
    
    // 上方出口：碰撞觸發  
    if (this.isUpExitOpen && this.checkCollision(player, this.upExitMarker)) {
      this.triggerTransition('up');
    }
  }
}
```

**出口特色**:
- 🚪 **統一標記**: 發光圓圈標示所有出口位置
- 🎯 **觸發機制**: 邊緣觸發(左右) vs 碰撞觸發(上方)
- 🔄 **動態範圍**: 出口開放時walkBounds調整活動範圍
- 💡 **GO指示**: 與GO指示器系統完整整合

## 轉場系統

### **三種轉場模式**
```typescript
// 轉場類型與流程
export type AreaTransition = 'side' | 'treasureRoom' | 'nextArea';

class TransitionSystem {
  // 模式1: 左右平移轉場
  executeSideTransition(side: Side): void {
    this.crossPhase = 'walk';     // 玩家走向邊緣
    this.startCameraPanning(side); // 鏡頭平移
    this.crossPhase = 'panning';  
    this.moveCharactersToNewArea(side); // 角色自動走位
    this.crossPhase = 'enter';
    this.completeTransition();
  }
  
  // 模式2: 閃黑轉場 (上方出口)
  executeFlashTransition(target: 'nextArea' | 'treasureRoom'): void {
    this.fadeToBlack(() => {
      this.host.clearArea();     // 清理當前區域
      this.setupNewArea(target); // 設置新區域
      this.fadeFromBlack();
    });
  }
  
  // 模式3: 隱藏入口獎勵關
  executeHiddenTransition(): void {
    // 類似閃黑，但目標是獎勵關
    this.executeFlashTransition('treasureRoom');
  }
}
```

### **三階段回呼流程**
```typescript
// 複雜轉場的控制權交接
interface TransitionCallbacks {
  // 階段1: 離開準備
  onAreaLeave(to: AreaTransition): void {
    // GameScene負責：
    // - 收掉不帶到下一區的物品
    // - 停止當前區域特有的系統
    // - 準備轉場數據
  }
  
  // 階段2: 清理階段  
  clearArea(): void {
    // GameScene負責：
    // - 清除敵人和物件
    // - 重置場景狀態
    // - 準備新區域數據
  }
  
  // 階段3: 進入新區
  onAreaEnter(to: AreaTransition, side: Side): void {
    // GameScene負責：
    // - 布置新區域物件
    // - 開始新的戰鬥
    // - 啟動區域特有系統
  }
}
```

**轉場特色**:
- 🎬 **平移動畫**: 左右轉場鏡頭平滑移動2秒
- ⚫ **閃黑效果**: 上方出口瞬間切換區域
- 🏃 **自動走位**: 角色自動移動到新區域指定位置
- 🔄 **狀態管理**: 三階段回呼確保轉場完整性

## 鏡頭跟隨系統

### **視角控制機制**
```typescript
// 鏡頭跟隨與邊界管理
class CameraController {
  // 設定跟隨模式
  setupCameraFollow(): void {
    const camera = this.host.scene.cameras.main;
    const player = this.host.player();
    const currentSlot = this.getCurrentSlot();
    
    // 設定跟隨邊界 (限制在當前slot)
    camera.setBounds(
      currentSlot.x, currentSlot.y,
      currentSlot.width, currentSlot.height
    );
    
    camera.startFollow(player);
  }
  
  // 轉場時鏡頭平移
  panCameraToSide(side: Side, duration: number = 2000): void {
    const camera = this.host.scene.cameras.main;
    const targetSlot = side === 'L' ? this.leftSlot : this.rightSlot;
    
    camera.stopFollow(); // 停止跟隨
    
    // 平移到目標slot
    this.host.scene.tweens.add({
      targets: camera,
      scrollX: targetSlot.centerX - camera.width / 2,
      scrollY: targetSlot.centerY - camera.height / 2,
      duration: duration,
      ease: 'Power2',
      onComplete: () => {
        this.updateSlotLayout(side); // 更新slot佈局
        this.setupCameraFollow();    // 恢復跟隨
      }
    });
  }
}
```

**鏡頭特色**:
- 👁️ **邊界跟隨**: 鏡頭跟隨P1，限制在當前slot範圍
- 🎬 **平移動畫**: 轉場時平滑移動到新區域
- 🔄 **動態邊界**: 轉場完成後更新鏡頭邊界設定
- 🎯 **聚焦控制**: 支援事件聚焦等特殊鏡頭需求

## 系統配置參數

### **世界配置參數**
```typescript
// config.ts - slot世界配置
world: {
  slotWidth: 1920,              // 單格寬度
  slotHeight: 1080,             // 單格高度
  arenaPadding: 80,             // 活動區邊界
  corridorWidth: 200,           // 走廊寬度
  
  transition: {
    panDuration: 2000,          // 平移轉場時長
    fadeInDuration: 500,        // 淡入時長
    fadeOutDuration: 300,       // 淡出時長
    autoWalkSpeed: 300          // 自動走位速度
  },
  
  exits: {
    markerRadius: 30,           // 出口標記半徑
    markerColor: 0x00FF00,      // 出口標記顏色
    triggerDistance: 50,        // 觸發距離
    glowIntensity: 0.8          // 發光強度
  }
}
```

### **轉場參數配置**
```typescript
// 轉場相關參數
transitions: {
  side: {
    walkPhase: 1000,            // 走向邊緣階段時長
    panPhase: 2000,             // 鏡頭平移階段時長  
    enterPhase: 1500            // 進入新區階段時長
  },
  
  flash: {
    fadeOut: 300,               // 淡出黑幕時長
    blackDuration: 200,         // 黑幕持續時長
    fadeIn: 500                 // 淡入新場景時長
  }
}
```

## 技術架構優勢

### **Controller模式效益**
- ✅ **模組化**: 737行世界邏輯完整獨立
- ✅ **職責分離**: 關卡流程留GameScene，世界管理完全分離
- ✅ **可測試**: SlotWorldController可獨立單元測試
- ✅ **可擴展**: 新轉場模式可輕鬆加入系統

### **SlotWorldHost介面設計**
- 🔒 **封裝保護**: 不直接存取GameScene內部狀態
- 🎯 **能力導向**: 只開放世界管理必要的場景能力
- 📋 **回呼機制**: 三階段轉場控制權清晰交接
- 🧪 **系統整合**: GO指示器、隱藏入口等關聯系統統一

### **代碼優化成果**
- 🧹 **廢棄清理**: 移除choosing階段、pendingCamSlot等不執行流程
- 🔄 **統一接口**: arena改為控制器getter，walkBounds統一範圍
- 🐛 **Bug修復**: 解決重開遊戲出口狀態殘留(crossingOpen/crossSide/levelEntering)
- 📝 **規範提升**: 數值常數化、過時註解更新

## 方案B B-2重構技術成果

### **代碼拆分統計**
- **SlotWorldController.ts**: +737行 (世界系統完整抽取)
- **GameScene.ts**: -948行 (世界管理代碼移除)
- **UIScene.ts**: -1行 (未使用型別欄位清理)
- **核心瘦身**: GameScene從5,621行降到4,857行 (-764行)

### **決定性測試驗證**
```typescript
// 嚴格品質保證
const qualityAssurance = {
  testMethod: '三組隨機種子各跑14,000幀自動通關',
  comparison: '新舊版本逐幀比對完全一致',
  coverage: '左右平移/上方閃黑/問號雙出口/隱藏入口+獎勵關',
  bugFix: '順帶修復重開遊戲狀態殘留問題',
  review: '銳騎審查99/100高品質評分',
  deployment: 'index-CeV1vx7q.js'
};
```

### **架構模式建立**
- 🏗️ **Host介面標準**: 第五個Controller+Host組合完成
- 📦 **系統封裝**: 相關功能完整封裝在單一Controller
- 🔗 **回呼設計**: 三階段控制權交接模式標準化
- 🧩 **模組組合**: GameScene變為五Controller的組合協調

**方案B B-2 slot世界系統拆分成功，GameScene極致瘦身計劃加速推進！**

**參考檔案**:
- `controllers/SlotWorldController.ts` (主控制器 737行)
- `scenes/GameScene.ts` (SlotWorldHost介面實作)
- commit cc7a433 (B-2 slot世界系統拆分完成)
- 方案B進度: B-3攻擊AI、B-4除錯API (進行中)
