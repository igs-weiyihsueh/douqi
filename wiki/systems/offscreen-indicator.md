# 清場輔助系統 (Offscreen Enemy Indicator)

**系統概述**：智能8方向清場輔助箭頭系統，專為解決「找不到畫面外剩餘怪物」的清場困擾而設計，提供精確的視覺引導。

## 🎯 **核心功能**

### **智能時機觸發**
清場輔助只在特定時機出現，避免戰鬥中的視覺干擾：
- **清場階段專用**: 只在本波怪全生完，等玩家清完過關時顯示
- **戰鬥排除**: 戰鬥中/轉場/事件/BOSS時不干擾，精準避免誤導
- **動態切換**: 根據遊戲狀態自動開啟/關閉指示器

### **8方向分組指示**
智能將畫面外怪物按方向分組，提供直觀指引：
```typescript
interface OffscreenDirection {
  angle: number;        // 方向角度 (0-360度)
  label: string;        // 方向標籤 ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')
  enemyCount: number;   // 該方向怪物數量
  nearestDistance: number; // 最近怪物距離
}

// 8個基本方向定義
const directions = [
  { angle: 0,   label: 'N' },    // 北
  { angle: 45,  label: 'NE' },   // 東北
  { angle: 90,  label: 'E' },    // 東
  { angle: 135, label: 'SE' },   // 東南
  { angle: 180, label: 'S' },    // 南
  { angle: 225, label: 'SW' },   // 西南
  { angle: 270, label: 'W' },    // 西
  { angle: 315, label: 'NW' }    // 西北
];
```

### **智能對象篩選**
精確篩選需要指示的怪物，避免無關干擾：
- **畫面外限定**: 只計算畫面外存活的一般怪物
- **自動排除**: BOSS/塔/守護NPC/寶箱怪等特殊對象
- **可見排除**: 畫面內可見怪物不重複顯示
- **狀態過濾**: 只統計存活且可攻擊的怪物

## 🔧 **技術實作**

### **核心控制器** (controllers/OffscreenEnemyIndicator.ts)
```typescript
class OffscreenEnemyIndicator {
  private host: OffscreenEnemyIndicatorHost;
  private indicators: OffscreenIndicator[] = [];
  
  /** 更新所有方向的指示器 */
  update(): void {
    if (!this.shouldShowIndicators()) {
      this.hideAllIndicators();
      return;
    }
    
    const offscreenEnemies = this.getOffscreenEnemies();
    const directionGroups = this.groupEnemiesByDirection(offscreenEnemies);
    
    this.updateIndicators(directionGroups);
  }
  
  /** 判斷是否應該顯示指示器 */
  private shouldShowIndicators(): boolean {
    return this.host.isCleanupPhase() && 
           !this.host.isBossActive() && 
           !this.host.isInTransition();
  }
}
```

### **方向分組算法**
```typescript
private groupEnemiesByDirection(enemies: Enemy[]): DirectionGroup[] {
  const camera = this.host.scene.cameras.main;
  const centerX = camera.scrollX + camera.width / 2;
  const centerY = camera.scrollY + camera.height / 2;
  
  const groups: DirectionGroup[] = [];
  
  // 為每個方向初始化分組
  directions.forEach(dir => {
    const enemiesInDirection = enemies.filter(enemy => {
      const angle = this.getAngleToEnemy(centerX, centerY, enemy);
      return this.isInDirectionRange(angle, dir.angle);
    });
    
    if (enemiesInDirection.length > 0) {
      groups.push({
        direction: dir,
        enemies: enemiesInDirection,
        nearestEnemy: this.findNearestEnemy(centerX, centerY, enemiesInDirection)
      });
    }
  });
  
  return groups;
}
```

### **視覺指示器**
```typescript
interface OffscreenIndicator {
  arrow: Phaser.GameObjects.Image;      // 箭頭圖像
  countText: Phaser.GameObjects.Text;   // 數量文字 "×N"
  direction: OffscreenDirection;        // 對應方向
  
  /** 更新指示器位置和內容 */
  update(enemyCount: number, nearestDistance: number): void;
  
  /** 顯示/隱藏指示器 */
  setVisible(visible: boolean): void;
}

// 指示器視覺設定
const indicatorStyle = {
  arrowColor: 0xFF4444,          // 紅橘色箭頭
  arrowSize: 32,                 // 箭頭大小
  flashSpeed: 0.8,               // 閃動速度
  edgeMargin: 40,                // 邊緣距離
  fontSize: 16,                  // 文字大小
  fontColor: '#FFFFFF'           // 文字顏色
};
```

## 🎮 **用戶體驗設計**

### **動態反應**
指示器能即時響應遊戲狀態變化：
- **玩家移動**: 箭頭平滑跟隨轉向，動態更新指向
- **怪物清除**: 怪物被清完箭頭實時消失/更新數量
- **數量顯示**: 同方向多隻顯示「×N」格式

### **智能避位**
指示器智能避開UI元素，確保清晰可見：
- **HUD避讓**: 避開生命值、技能等HUD元素
- **面板避讓**: 避開設定面板、背包等UI面板  
- **GO指示協調**: 與GO指示使用相同的貼邊範圍系統

### **視覺區別**
與其他指示器形成清晰的視覺區分：
- **顏色差異**: 紅橘色 vs 黃色GO指示
- **形狀差異**: 箭頭形狀 vs 圓形指示器
- **閃動模式**: 獨特的閃動節奏和模式

## 📊 **實測驗證**

### **典型場景測試**
```
測試案例：左側3隻+左上1隻怪物
結果：左緣顯示一支「×4」箭頭

測試案例：打完部分怪物  
結果：箭頭轉指剩餘位置，數量自動更新

測試案例：純視覺提示
結果：對遊戲判定零影響，開關功能逐幀一致
```

### **性能測試**
- **計算效率**: 8方向分組算法優化，低CPU佔用
- **記憶體管理**: 指示器物件池化，避免頻繁創建銷毀
- **幀率影響**: 對遊戲幀率無明顯影響

## ⚙️ **配置系統**

### **完整可調參數** (config.stage.offscreenIndicator)
```typescript
interface OffscreenIndicatorConfig {
  enabled: boolean;              // 是否啟用清場輔助
  directionCount: number;        // 方向數量 (預設8方向)
  arrowSize: number;             // 箭頭大小
  edgeMargin: number;            // 距離螢幕邊緣距離
  flashSpeed: number;            // 閃動速度
  maxDistance: number;           // 最大檢測距離
  
  // 視覺樣式
  arrowColor: number;            // 箭頭顏色
  arrowTint: number;             // 箭頭色調
  fontSize: number;              // 數量文字大小
  fontColor: string;             // 文字顏色
  
  // 行為控制
  minEnemyCount: number;         // 最少怪物數量才顯示
  updateInterval: number;        // 更新間隔(ms)
  fadeInDuration: number;        // 淡入動畫時間
  fadeOutDuration: number;       // 淡出動畫時間
}
```

### **擴展性設計**
- **方向數可調**: 可擴展到16方向或更多
- **樣式定制**: 顏色、大小、字型完全可配置
- **行為調整**: 觸發條件、更新頻率可調整
- **一般戰鬥**: 可擴展到非清場階段使用

## 🔍 **除錯支援**

### **視覺除錯**
```typescript
// F9除錯面板顯示
private offscreenDebugInfo(): string[] {
  return [
    `Offscreen Indicators: ${this.enabled ? 'Active' : 'Disabled'}`,
    `Cleanup Phase: ${this.host.isCleanupPhase()}`,
    `Offscreen Enemies: ${this.getOffscreenEnemies().length}`,
    `Active Indicators: ${this.indicators.filter(i => i.visible).length}`,
    `Directions: ${this.indicators.map(i => i.direction.label).join(', ')}`
  ];
}
```

### **開發者工具**
- **方向線**: 開發模式下顯示8方向分割線
- **敵人標記**: 高亮顯示被計算的畫面外怪物  
- **範圍顯示**: 顯示檢測範圍和邊界區域

## 🚀 **上線記錄**

### **清場輔助箭頭** (de28c51)
- **初版功能**: 清場階段在畫面邊緣以箭頭指示畫面外剩餘怪物
- **基礎實現**: 方向分組、數量統計、視覺指示

### **視覺優化** (7c3de63)  
- **大小調整**: 放大到GO指示大小，提升可見性
- **圖示改進**: 數量文字改為怪物圖示，更直觀

### **最終版本** (ee572a6)
- **精簡設計**: 移除怪物圖示，只保留箭頭指示
- **性能優化**: 減少視覺元素，降低渲染負擔
- **用戶體驗**: 聚焦核心功能，減少視覺雜訊

### **部署狀態** (index-DS_Vk0dV.js)
- **銳騎評分**: 100/100完美通過
- **GitHub Pages**: 已部署並確認正常運作
- **用戶反饋**: 徹底解決清場時「不知道剩餘怪在哪」的痛點

## 📋 **未來整合**

### **多人攝影機整合**
- **協調顯示**: 與多人攝影機系統協調指示位置
- **團隊提示**: 考慮為不同玩家顯示不同的指示器
- **視野同步**: 確保所有玩家看到一致的指示

### **擴展功能**
- **一般戰鬥**: 擴展到非清場階段的戰鬥引導
- **重要目標**: 指示BOSS、寶箱等重要目標位置
- **路徑提示**: 結合路徑尋找提供更精確的方向指引

## 參考檔案

- `controllers/OffscreenEnemyIndicator.ts` - 清場輔助核心控制器
- `config.ts` - 配置參數 (config.stage.offscreenIndicator)
- `scenes/GameScene.ts` - 清場階段整合邏輯
- commits: de28c51, 7c3de63, ee572a6

**清場輔助系統完美解決畫面外怪物定位問題！**
