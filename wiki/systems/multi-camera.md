# 多人攝影機系統 (Multi-Camera System)

**系統概述**：多人遊戲攝影機跟隨系統，確保所有玩家都在畫面範圍內，實現全隊協作的視覺體驗和遊戲平衡。

## 🎯 **核心功能**

### **全隊外框中心跟隨**
攝影機智能計算所有玩家的邊界框，並跟隨整體中心：
```typescript
class MultiCameraController {
  /** 計算所有存活玩家的邊界框 */
  private calculateTeamBounds(): Rectangle {
    const alivePlayers = this.players.filter(p => p.isAlive());
    if (alivePlayers.length === 0) return null;
    
    let minX = Math.min(...alivePlayers.map(p => p.x));
    let maxX = Math.max(...alivePlayers.map(p => p.x));
    let minY = Math.min(...alivePlayers.map(p => p.y));
    let maxY = Math.max(...alivePlayers.map(p => p.y));
    
    return new Rectangle(minX, minY, maxX - minX, maxY - minY);
  }
  
  /** 攝影機跟隨團隊中心 */
  private followTeamCenter(): void {
    const bounds = this.calculateTeamBounds();
    if (!bounds) return;
    
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    
    this.camera.setLerp(0.08, 0.04); // 平滑跟隨
    this.camera.centerOn(centerX, centerY);
  }
}
```

### **邊界約束系統**
多人模式時，角色不可走出攝影機畫面：
```typescript
interface CameraBoundary {
  /** 檢查玩家是否即將走出畫面 */
  checkPlayerBounds(player: Character): boolean;
  
  /** 將玩家位置約束在畫面內 */
  constrainPlayerMovement(player: Character, targetX: number, targetY: number): Point;
}

class PlayerMovementConstraint {
  private isOutOfCameraBounds(x: number, y: number): boolean {
    const camera = this.scene.cameras.main;
    const margin = 50; // 邊界緩衝區
    
    return x < camera.worldView.left + margin ||
           x > camera.worldView.right - margin ||
           y < camera.worldView.top + margin ||
           y > camera.worldView.bottom - margin;
  }
}
```

## 🔧 **技術實作**

### **第一階段實作** (5b4b2cd上線)
當前已實現的基礎功能：
- ✅ **全隊外框中心跟隨**: 攝影機動態跟隨所有玩家的幾何中心
- ✅ **多人邊界約束**: 角色無法走出攝影機畫面範圍
- ✅ **平滑過渡**: 使用lerp實現自然的攝影機移動

### **攝影機跟隨邏輯**
```typescript
// 多人攝影機更新邏輯
function updateMultiCamera() {
  if (playerCount === 1) {
    // 單人模式：正常角色跟隨
    camera.startFollow(player1, true, 0.08, 0.04);
  } else {
    // 多人模式：全隊中心跟隨
    const teamCenter = calculateTeamCenter();
    camera.centerOn(teamCenter.x, teamCenter.y);
    
    // 約束所有玩家在畫面內
    players.forEach(player => {
      constrainPlayerToCamera(player);
    });
  }
}
```

### **邊界檢測與約束**
```typescript
function constrainPlayerToCamera(player: Character) {
  const camera = this.scene.cameras.main;
  const bounds = camera.worldView;
  const margin = 50;
  
  // 計算安全區域
  const safeArea = {
    left: bounds.left + margin,
    right: bounds.right - margin,
    top: bounds.top + margin,
    bottom: bounds.bottom - margin
  };
  
  // 約束玩家位置
  if (player.x < safeArea.left) player.x = safeArea.left;
  if (player.x > safeArea.right) player.x = safeArea.right;
  if (player.y < safeArea.top) player.y = safeArea.top;
  if (player.y > safeArea.bottom) player.y = safeArea.bottom;
}
```

## 🎮 **多人體驗設計**

### **協作導向**
- **視野共享**: 所有玩家共享同一攝影機視野
- **團隊協調**: 攝影機跟隨鼓勵玩家保持隊形
- **戰略位置**: 玩家需要考慮整體隊伍的位置策略

### **平衡機制**
- **邊界限制**: 防止玩家過度分散導致攝影機混亂
- **中心權重**: 攝影機優先考慮玩家聚集區域
- **平滑調整**: 避免攝影機快速跳躍造成視覺不適

## 🔄 **動態適應**

### **玩家數量適應**
```typescript
function getCameraSettings(playerCount: number): CameraConfig {
  switch (playerCount) {
    case 1:
      return {
        followMode: 'single-player',
        lerpX: 0.08,
        lerpY: 0.04,
        deadzone: { width: 320, height: 180 }
      };
    case 2:
      return {
        followMode: 'team-center',
        lerpX: 0.06,
        lerpY: 0.03,
        margin: 80
      };
    case 3:
    case 4:
      return {
        followMode: 'team-bounds',
        lerpX: 0.05,
        lerpY: 0.025,
        margin: 100
      };
  }
}
```

### **場景適應**
- **關卡邊界**: 攝影機不能超出關卡地圖邊界
- **障礙物處理**: 考慮場景中的不可通行區域
- **特殊事件**: BOSS戰時的特殊攝影機行為

## 📊 **性能考量**

### **計算優化**
- **批量更新**: 所有玩家位置一次性計算
- **幀率控制**: 攝影機更新頻率與遊戲幀率同步
- **邊界緩存**: 快取邊界計算結果避免重複運算

### **記憶體管理**
- **物件池**: 重用邊界檢測物件
- **事件清理**: 及時清理攝影機事件監聽器
- **資源釋放**: 場景切換時正確釋放攝影機資源

## 🔮 **未來擴展** (規劃中)

### **第二階段計劃**
- **智能縮放**: 根據玩家分散程度動態調整攝影機縮放
- **焦點權重**: 不同玩家根據血量/狀態影響攝影機焦點
- **場景感知**: 攝影機考慮重要遊戲物件(BOSS、寶箱)的位置

### **高級功能**
```typescript
// 規劃中的智能縮放
interface AdaptiveZoom {
  minZoom: number;           // 最小縮放比例
  maxZoom: number;           // 最大縮放比例
  zoomSpeed: number;         // 縮放調整速度
  playerSpreadThreshold: number; // 觸發縮放的分散閾值
}

// 規劃中的焦點權重
interface FocusWeight {
  healthWeight: number;      // 血量影響權重
  actionWeight: number;      // 行動狀態權重
  positionWeight: number;    // 位置重要性權重
}
```

## ⚙️ **配置系統**

### **基礎配置**
```typescript
const multiCameraConfig = {
  enabled: true,                    // 啟用多人攝影機
  boundaryMargin: 50,              // 邊界緩衝區大小
  followLerp: { x: 0.06, y: 0.03 }, // 跟隨平滑度
  constraintStrength: 1.0,         // 約束強度
  updateInterval: 16               // 更新間隔(ms)
};
```

### **除錯設定**
```typescript
const debugMultiCamera = {
  showBounds: false,               // 顯示團隊邊界框
  showCenter: false,               // 顯示中心點
  showConstraints: false,          // 顯示約束區域
  logCameraMovement: false         // 記錄攝影機移動
};
```

## 🔍 **除錯與測試**

### **視覺除錯**
```typescript
// F9除錯面板顯示
private multiCameraDebugInfo(): string[] {
  const teamBounds = this.calculateTeamBounds();
  return [
    `Multi-Camera: ${this.isMultiPlayerMode ? 'Active' : 'Disabled'}`,
    `Team Center: (${teamBounds?.centerX || 0}, ${teamBounds?.centerY || 0})`,
    `Players In Bounds: ${this.playersInBounds}/${this.totalPlayers}`,
    `Camera Position: (${this.camera.scrollX}, ${this.camera.scrollY})`
  ];
}
```

### **測試案例**
- **2人分離**: 測試玩家分散到最大距離時的攝影機行為
- **4人聚集**: 測試所有玩家聚集時的攝影機穩定性
- **邊界測試**: 測試玩家嘗試走出邊界時的約束效果

## 🚀 **上線記錄**

### **第一階段** (5b4b2cd)
- **功能**: 全隊外框中心跟隨 + 多人時角色不可走出畫面
- **實現**: 基礎的團隊攝影機跟隨和邊界約束
- **測試**: 2-4人模式下的基本功能驗證

### **清場輔助整合提及** (log.md)
- **下次提醒**: 功能已完成，可討論多人攝影機系統整合方案
- **整合方向**: 清場輔助箭頭與多人攝影機的協調顯示

## 參考檔案

- `scenes/GameScene.ts` - 多人攝影機邏輯整合
- `controllers/` - 待建立專用CameraController
- `config.ts` - 攝影機相關配置
- commit 5b4b2cd - 多人攝影機第一階段實作

**多人攝影機系統確保團隊協作的視覺連貫性！**
