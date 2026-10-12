# 攝影機系統 (Camera System)

**系統概述**：智能攝影機跟隨和視角控制系統，實現多人遊戲的最佳視角體驗，支援動態跟隨、邊界約束、視角平滑過渡，確保所有玩家都在最佳觀看範圍內。

## 📷 **最新攝影機優化** (4ea4419)

### **無玩家狀態跟隨邏輯** (2026-10-12)
解決CREDIT系統中投幣前鏡頭停滯問題：

```typescript
/**
 * 攝影機跟隨邏輯優化：
 * - 原問題：投幣前無玩家在場上，鏡頭停在原位
 * - 新邏輯：改跟未投幣/等待續關的角色
 * - 開局體驗：立即對準P1，而不是停在地圖中心
 * - CREDIT整合：支援absent/waiting狀態角色跟隨
 */
class CameraFollowOptimization {
  /** 跟隨目標優先級 (4ea4419新邏輯) */
  getFollowTarget(): Character | null {
    const characters = this.scene.characters;
    
    // 優先跟隨遊玩中的角色
    const playingCharacters = characters.filter(c => 
      c.alive && c.creditState === 'playing'
    );
    
    if (playingCharacters.length > 0) {
      return this.calculateCenterTarget(playingCharacters);
    }
    
    // 回退：跟隨等待投幣的角色 (4ea4419新增)
    const waitingCharacters = characters.filter(c => 
      c.alive && (c.creditState === 'absent' || c.creditState === 'waiting')
    );
    
    if (waitingCharacters.length > 0) {
      return waitingCharacters[0]; // 優先P1
    }
    
    return null; // 完全無角色時才無跟隨
  }
  
  /** 開局鏡頭對準P1 */
  initializeCamera(): void {
    const p1 = this.scene.characters[0]; // P1角色
    if (p1) {
      // 立即對準P1位置，而非停在地圖中心
      this.cameras.main.centerOn(p1.x, p1.y);
    }
  }
}
```

### **CREDIT系統整合**
```typescript
/**
 * CREDIT投幣系統與攝影機的深度整合：
 * - absent狀態：角色隱藏但可作為跟隨目標
 * - waiting狀態：等待續關角色仍可見，優先跟隨
 * - playing狀態：正常遊戲角色，主要跟隨目標
 * - 多人模式：智能選擇最佳跟隨組合
 */
interface CreditCameraIntegration {
  /** 狀態感知跟隨 */
  stateAwareFollow: {
    playing: 'primary_follow_targets',      // 主要跟隨目標
    waiting: 'fallback_follow_targets',     // 備用跟隨目標  
    absent: 'startup_follow_only',          // 僅開局跟隨
    mixed: 'intelligent_priority_system'    // 混合狀態智能選擇
  },
  
  /** 視角平滑過渡 */
  smoothTransition: {
    stateChange: 'gradual_camera_shift',    // 狀態變化平滑切換
    coinInsert: 'smooth_focus_transition',  // 投幣後平滑聚焦
    gameStart: 'immediate_p1_centering'     // 開局立即對準P1
  }
}
```

## 📐 **攝影機跟隨系統**

### **多人跟隨演算法**
```typescript
/**
 * 多人攝影機智能跟隨：
 * - 計算所有目標的幾何中心
 * - 動態調整視野範圍確保所有角色可見
 * - 邊界約束防止越界
 * - 平滑移動避免抖動
 */
class MultiPlayerCameraFollow {
  /** 計算最佳跟隨位置 */
  calculateOptimalPosition(targets: Character[]): { x: number, y: number } {
    if (targets.length === 0) return { x: 0, y: 0 };
    
    // 計算幾何中心
    const centerX = targets.reduce((sum, char) => sum + char.x, 0) / targets.length;
    const centerY = targets.reduce((sum, char) => sum + char.y, 0) / targets.length;
    
    // 邊界約束
    const worldBounds = this.scene.physics.world.bounds;
    const camera = this.cameras.main;
    
    const constrainedX = Phaser.Math.Clamp(
      centerX, 
      camera.width / 2, 
      worldBounds.width - camera.width / 2
    );
    
    const constrainedY = Phaser.Math.Clamp(
      centerY,
      camera.height / 2,
      worldBounds.height - camera.height / 2  
    );
    
    return { x: constrainedX, y: constrainedY };
  }
  
  /** 動態縮放調整 */
  adjustZoomForTargets(targets: Character[]): void {
    if (targets.length <= 1) return;
    
    // 計算目標散佈範圍
    const bounds = this.calculateTargetBounds(targets);
    const requiredWidth = bounds.width + this.config.padding;
    const requiredHeight = bounds.height + this.config.padding;
    
    // 計算適合縮放比例
    const camera = this.cameras.main;
    const zoomX = camera.width / requiredWidth;
    const zoomY = camera.height / requiredHeight;
    const optimalZoom = Math.min(zoomX, zoomY, this.config.maxZoom);
    
    // 平滑縮放調整
    if (Math.abs(camera.zoom - optimalZoom) > 0.1) {
      camera.zoom = Phaser.Math.Linear(camera.zoom, optimalZoom, 0.02);
    }
  }
}
```

### **跟隨目標管理**
```typescript
/**
 * 跟隨目標智能選擇：
 */
class FollowTargetManager {
  /** 目標篩選邏輯 */
  filterValidTargets(): Character[] {
    return this.scene.characters.filter(character => {
      // 基礎有效性檢查
      if (!character.alive) return false;
      
      // CREDIT狀態整合 (4ea4419優化)
      if (this.scene.creditController.enabled) {
        // CREDIT模式：playing狀態優先，waiting/absent作為備用
        return character.creditState === 'playing' || 
               character.creditState === 'waiting' ||
               (character.creditState === 'absent' && this.isStartupPhase());
      }
      
      // 傳統模式：存活角色
      return true;
    });
  }
  
  /** 目標權重計算 */
  calculateTargetWeight(character: Character): number {
    let weight = 1.0;
    
    // CREDIT狀態權重
    if (character.creditState === 'playing') weight *= 2.0;    // 遊玩中最重要
    if (character.creditState === 'waiting') weight *= 1.0;    // 等待中中等
    if (character.creditState === 'absent') weight *= 0.5;     // 未進場較低
    
    // 角色類型權重
    if (!character.isBot) weight *= 1.5;  // 玩家權重較高
    
    // 距離權重 (距離中心越近權重越高)
    const distanceFromCenter = this.getDistanceFromCenter(character);
    weight *= Math.max(0.2, 1.0 - distanceFromCenter / 1000);
    
    return weight;
  }
}
```

## 🎮 **攝影機模式系統**

### **跟隨模式配置**
```typescript
/**
 * 多種攝影機跟隨模式：
 */
enum CameraFollowMode {
  /** 單一目標跟隨 (1P專用模式) */
  SINGLE_TARGET = 'single',
  
  /** 多目標中心跟隨 (多人協作模式) */
  MULTI_CENTER = 'center',
  
  /** 智能混合跟隨 (自動適應) */
  SMART_HYBRID = 'hybrid',
  
  /** 自由鏡頭 (除錯模式) */
  FREE_CAMERA = 'free'
}

class CameraFollowModes {
  private currentMode: CameraFollowMode = CameraFollowMode.SMART_HYBRID;
  
  /** 單一目標模式 */
  updateSingleTarget(): void {
    const player = this.scene.characters[0]; // 固定跟P1
    if (player && this.isValidTarget(player)) {
      this.smoothFollowTarget(player);
    }
  }
  
  /** 多人中心模式 */
  updateMultiCenter(): void {
    const validTargets = this.filterValidTargets();
    if (validTargets.length > 0) {
      const center = this.calculateOptimalPosition(validTargets);
      this.smoothFollowPosition(center);
      this.adjustZoomForTargets(validTargets);
    }
  }
  
  /** 智能混合模式 (預設) */
  updateSmartHybrid(): void {
    const validTargets = this.filterValidTargets();
    
    if (validTargets.length === 1) {
      // 單一目標：直接跟隨
      this.smoothFollowTarget(validTargets[0]);
    } else if (validTargets.length > 1) {
      // 多目標：中心跟隨 + 縮放調整
      const center = this.calculateOptimalPosition(validTargets);
      this.smoothFollowPosition(center);
      this.adjustZoomForTargets(validTargets);
    } else {
      // 無目標：保持當前位置或回到預設位置
      this.handleNoTargets();
    }
  }
}
```

### **邊界約束系統**
```typescript
/**
 * 攝影機邊界約束：
 * 確保鏡頭不會移出遊戲世界邊界
 */
class CameraBoundaryConstraint {
  /** 世界邊界約束 */
  constrainToWorldBounds(): void {
    const camera = this.cameras.main;
    const world = this.scene.physics.world.bounds;
    
    // 計算有效移動範圍
    const minX = camera.width / 2;
    const maxX = world.width - camera.width / 2;
    const minY = camera.height / 2; 
    const maxY = world.height - camera.height / 2;
    
    // 約束鏡頭位置
    camera.centerX = Phaser.Math.Clamp(camera.centerX, minX, maxX);
    camera.centerY = Phaser.Math.Clamp(camera.centerY, minY, maxY);
  }
  
  /** 自訂邊界約束 */
  constrainToCustomBounds(bounds: Phaser.Geom.Rectangle): void {
    const camera = this.cameras.main;
    
    const minX = bounds.x + camera.width / 2;
    const maxX = bounds.right - camera.width / 2;
    const minY = bounds.y + camera.height / 2;
    const maxY = bounds.bottom - camera.height / 2;
    
    camera.centerX = Phaser.Math.Clamp(camera.centerX, minX, maxX);
    camera.centerY = Phaser.Math.Clamp(camera.centerY, minY, maxY);
  }
}
```

## 🌊 **平滑移動系統**

### **移動插值演算法**
```typescript
/**
 * 攝影機平滑移動：
 * 使用插值演算法實現自然的鏡頭移動
 */
class SmoothCameraMovement {
  /** 線性插值移動 */
  smoothFollowTarget(target: Character): void {
    const camera = this.cameras.main;
    const lerpFactor = this.config.followSpeed; // 0.02
    
    const targetX = target.x;
    const targetY = target.y;
    
    // 平滑移動到目標位置
    const newX = Phaser.Math.Linear(camera.centerX, targetX, lerpFactor);
    const newY = Phaser.Math.Linear(camera.centerY, targetY, lerpFactor);
    
    camera.centerOn(newX, newY);
  }
  
  /** 預測性跟隨 */
  predictiveFollow(target: Character): void {
    const camera = this.cameras.main;
    
    // 計算目標速度向量
    const velocity = this.calculateTargetVelocity(target);
    
    // 預測未來位置
    const prediction = this.config.predictionTime; // 0.5秒
    const predictedX = target.x + velocity.x * prediction;
    const predictedY = target.y + velocity.y * prediction;
    
    // 平滑跟隨預測位置
    const lerpFactor = this.config.followSpeed;
    const newX = Phaser.Math.Linear(camera.centerX, predictedX, lerpFactor);
    const newY = Phaser.Math.Linear(camera.centerY, predictedY, lerpFactor);
    
    camera.centerOn(newX, newY);
  }
}
```

### **動態參數調整**
```typescript
/**
 * 動態攝影機參數：
 * 根據遊戲狀態動態調整跟隨參數
 */
class DynamicCameraParameters {
  /** 根據戰鬥狀態調整參數 */
  adjustForCombatState(): void {
    const enemyCount = this.scene.enemies.children.size;
    const playerSpeed = this.getAveragePlayerSpeed();
    
    if (enemyCount > 10) {
      // 激烈戰鬥：加快跟隨速度
      this.config.followSpeed = 0.04;
      this.config.predictionTime = 0.3;
    } else if (playerSpeed < 100) {
      // 慢速移動：降低跟隨速度，更穩定
      this.config.followSpeed = 0.01;  
      this.config.predictionTime = 0.7;
    } else {
      // 正常狀態：預設參數
      this.config.followSpeed = 0.02;
      this.config.predictionTime = 0.5;
    }
  }
  
  /** 根據CREDIT狀態調整 (4ea4419) */
  adjustForCreditState(): void {
    const playingCount = this.getPlayingCharacterCount();
    const waitingCount = this.getWaitingCharacterCount();
    
    if (playingCount === 0 && waitingCount > 0) {
      // 全員等待續關：較慢的跟隨，更穩定的視角
      this.config.followSpeed = 0.015;
    } else if (playingCount === 1) {
      // 單人遊戲：較快跟隨，更緊密視角
      this.config.followSpeed = 0.025;
    }
  }
}
```

## ⚙️ **攝影機配置系統**

### **核心配置參數**
```typescript
// config.ts - 攝影機系統配置
const cameraConfig = {
  /** 跟隨行為配置 */
  follow: {
    mode: CameraFollowMode.SMART_HYBRID,  // 預設智能混合模式
    speed: 0.02,                         // 跟隨速度 (線性插值因子)
    predictionTime: 0.5,                 // 預測時間 (秒)
    deadZone: 50,                        // 死區半徑 (像素)
    maxSpeed: 10                         // 最大跟隨速度 (像素/幀)
  },
  
  /** 縮放配置 */
  zoom: {
    default: 1.0,                        // 預設縮放
    min: 0.5,                           // 最小縮放
    max: 2.0,                           // 最大縮放
    speed: 0.02,                        // 縮放速度
    padding: 200                        // 目標周圍留白 (像素)
  },
  
  /** 邊界約束 */
  bounds: {
    enabled: true,                       // 啟用邊界約束
    worldBounds: true,                   // 使用世界邊界
    customBounds: null,                  // 自訂邊界 (可選)
    buffer: 50                          // 邊界緩衝區 (像素)
  },
  
  /** CREDIT系統整合配置 (4ea4419) */
  creditIntegration: {
    followWaitingCharacters: true,       // 跟隨等待角色
    startupFocusP1: true,               // 開局聚焦P1
    stateTransitionSpeed: 0.03,         // 狀態切換速度
    waitingModeSlowdown: 0.75           // 等待模式減速因子
  }
};
```

### **效能優化配置**
```typescript
/**
 * 攝影機效能優化：
 */
const cameraPerformanceConfig = {
  /** 更新頻率控制 */
  updateFrequency: {
    targetSelection: 100,               // 目標選擇間隔 (ms)
    followUpdate: 16,                   // 跟隨更新間隔 (60fps)
    zoomAdjustment: 33,                // 縮放調整間隔 (30fps)
    boundaryCheck: 50                  // 邊界檢查間隔 (20fps)
  },
  
  /** 精度控制 */
  precision: {
    positionThreshold: 1.0,            // 位置更新門檻 (像素)
    zoomThreshold: 0.01,               // 縮放更新門檻
    velocitySmoothing: 0.1             // 速度平滑因子
  }
};
```

## 🚀 **攝影機系統演進**

### **多人攝影機基礎** (5b4b2cd)
```typescript
/**
 * commit 5b4b2cd: 多人攝影機系統建立
 * - 全隊中心跟隨演算法
 * - 動態視野調整和邊界約束
 * - 協作導向的攝影機設計
 * - 智能目標選擇和權重計算
 */
interface MultiCameraFoundation {
  centerFollow: 'team_geometric_center',
  dynamicViewport: 'auto_zoom_adjustment',
  boundaryConstraint: 'world_bounds_respect',
  targetSelection: 'intelligent_weight_based'
}
```

### **CREDIT系統整合** (4ea4419)
```typescript
/**
 * commit 4ea4419: 攝影機與CREDIT系統深度整合
 * - 無玩家狀態跟隨邏輯優化
 * - 開局立即對準P1，避免停在原位
 * - 支援absent/waiting/playing狀態感知
 * - 平滑狀態轉換和視角切換
 */
interface CreditCameraIntegration {
  /** 狀態感知跟隨 */
  stateAwareFollow: {
    noPlayersIssue: 'fixed_follow_waiting_characters',
    startupBehavior: 'immediate_p1_centering',
    stateTransition: 'smooth_camera_shifts'
  },
  
  /** 用戶體驗提升 */
  uxImprovements: {
    startupExperience: 'no_more_static_camera',
    coinInsertFlow: 'smooth_focus_transitions',
    waitingState: 'maintained_visual_continuity'
  }
}
```

## 🔍 **除錯與監控**

### **攝影機狀態監控**
```typescript
/**
 * F9除錯面板攝影機資訊：
 */
function getCameraDebugInfo(): string[] {
  const camera = this.cameras.main;
  const targets = this.filterValidTargets();
  
  return [
    `Camera: Mode=${this.currentMode}, Zoom=${camera.zoom.toFixed(2)}`,
    `Position: (${camera.centerX.toFixed(0)}, ${camera.centerY.toFixed(0)})`,
    `Targets: Count=${targets.length}, Playing=${this.getPlayingCount()}`,
    `Follow Speed: ${this.config.followSpeed}, Prediction: ${this.config.predictionTime}s`
  ];
}
```

### **效能監控指標**
```typescript
/**
 * 攝影機效能監控：
 */
interface CameraPerformanceMetrics {
  /** CPU使用率 */
  cpuUsage: {
    followUpdate: number,              // 跟隨更新CPU佔用
    targetSelection: number,           // 目標選擇CPU佔用
    zoomCalculation: number           // 縮放計算CPU佔用
  },
  
  /** 流暢度指標 */
  smoothness: {
    averageFrameTime: number,         // 平均幀時間
    positionJitter: number,           // 位置抖動程度
    zoomStability: number            // 縮放穩定性
  }
}
```

## 參考檔案

- `scenes/GameScene.ts` - 攝影機系統核心邏輯和跟隨實現
- `controllers/SlotWorldController.ts` - 多人視角管理 (4ea4419修改)
- `config.ts` - 攝影機配置參數 (跟隨速度、縮放範圍)
- `wiki/systems/credit-system.md` - CREDIT系統與攝影機整合
- `wiki/systems/multi-camera.md` - 多人攝影機系統設計

**攝影機系統確保最佳的多人遊戲視角體驗！**
