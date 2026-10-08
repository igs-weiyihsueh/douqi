# 場景渲染系統

## 系統架構升級 (P2-2重構 fe938ff)

### **完整系統模組化**
場景繪製系統已從GameScene完整抽取到systems/zoneScenery.ts，實現程式化場景渲染的模組化管理。

```typescript
// systems/zoneScenery.ts - 場景渲染系統 (376行)
export interface ScenePalette {
  name: string;
  groundBase: number;        // 地面基色
  groundDark: number;        // 地面暗色
  groundLight: number;       // 地面亮色
  crackColor: number;        // 裂縫顏色
  pebble: number;           // 碎石顏色
  glow: number;             // 熔岩發光 (0=無熔岩)
  skyTop: number;           // 天空頂部
  skyBottom: number;        // 天空底部
}

// 純函式場景生成，無狀態依賴
export function createZoneBackground(scene: Phaser.Scene, ...): Phaser.GameObjects.Container
export function createZoneFarscape(scene: Phaser.Scene, ...): Phaser.GameObjects.Container  
export function createZoneGround(scene: Phaser.Scene, ...): Phaser.GameObjects.Container
```

## 場景層級系統

### **深度分層架構**
```typescript
// 場景圖層深度分配
const DEPTH = {
  sky: -3,          // 天空漸層背景
  far: -2,          // 遠景 (城池/火山)
  outer: -1,        // 外圍荒地
  ground: 0,        // 地面紋理
  border: 1,        // 圍欄邊界
  embers: 2         // 餘燼粒子
} as const;
```

**渲染順序**:
1. **天空層** (-3): 漸層背景色彩
2. **遠景層** (-2): 荒城/火山輪廓  
3. **外圍層** (-1): 荒地散布效果
4. **地面層** (0): 基礎地面紋理
5. **邊界層** (1): 圍欄與邊界
6. **粒子層** (2): 環境粒子效果

## 程式化場景生成

### **天空系統**
```typescript
// 漸層天空背景
function createSkyBackground(
  scene: Phaser.Scene,
  rect: Phaser.Geom.Rectangle,
  palette: ScenePalette
): Phaser.GameObjects.Graphics {
  const gfx = scene.add.graphics().setDepth(DEPTH.sky);
  
  // 垂直漸層：上部→下部
  gfx.fillGradientStyle(
    palette.skyTop,    palette.skyTop,     // 頂部
    palette.skyBottom, palette.skyBottom   // 底部  
  );
  gfx.fillRect(rect.x, rect.y, rect.width, rect.height);
  
  return gfx;
}
```

### **遠景系統** (A/B變體)
```typescript
// A變體：荒城遠景
function createVariantA_Cityscape(
  scene: Phaser.Scene,
  rect: Phaser.Geom.Rectangle,
  palette: ScenePalette
): Phaser.GameObjects.Container {
  const container = scene.add.container().setDepth(DEPTH.far);
  
  // 城池輪廓建築群
  for (let i = 0; i < 8; i++) {
    const buildingHeight = 60 + Math.random() * 40;
    const buildingWidth = 40 + Math.random() * 20;
    const x = rect.x + i * (rect.width / 8);
    const y = rect.y + rect.height - buildingHeight;
    
    const building = scene.add.rectangle(x, y, buildingWidth, buildingHeight, palette.groundDark);
    container.add(building);
  }
  
  return container;
}

// B變體：火山遠景  
function createVariantB_Volcanic(
  scene: Phaser.Scene, 
  rect: Phaser.Geom.Rectangle,
  palette: ScenePalette
): Phaser.GameObjects.Container {
  const container = scene.add.container().setDepth(DEPTH.far);
  
  // 火山輪廓山脈
  const mountainPeaks = [
    { x: rect.width * 0.2, height: 80 },
    { x: rect.width * 0.5, height: 120 }, // 主峰
    { x: rect.width * 0.8, height: 60 }
  ];
  
  mountainPeaks.forEach(peak => {
    const mountain = scene.add.triangle(
      rect.x + peak.x, rect.y + rect.height,
      0, 0, peak.height/2, -peak.height, -peak.height/2, 0,
      palette.groundDark
    );
    container.add(mountain);
  });
  
  return container;
}
```

### **外圍荒地系統**
```typescript
// 荒地散布效果
function createOuterWasteland(
  scene: Phaser.Scene,
  rect: Phaser.Geom.Rectangle, 
  palette: ScenePalette
): Phaser.GameObjects.Container {
  const container = scene.add.container().setDepth(DEPTH.outer);
  
  // 隨機散布碎石
  for (let i = 0; i < 25; i++) {
    const x = rect.x + Math.random() * rect.width;
    const y = rect.y + Math.random() * rect.height;
    const size = 2 + Math.random() * 4;
    
    const pebble = scene.add.circle(x, y, size, palette.pebble);
    pebble.setAlpha(0.6 + Math.random() * 0.4);
    container.add(pebble);
  }
  
  // 荒地裂縫
  for (let i = 0; i < 8; i++) {
    const crack = this.createRandomCrack(rect, palette.crackColor);
    container.add(crack);
  }
  
  return container;
}
```

### **地面紋理系統**
```typescript
// 多層地面紋理
function createGroundTexture(
  scene: Phaser.Scene,
  rect: Phaser.Geom.Rectangle,
  palette: ScenePalette
): Phaser.GameObjects.Container {
  const container = scene.add.container().setDepth(DEPTH.ground);
  
  // 基礎地面
  const baseGround = scene.add.rectangle(
    rect.centerX, rect.centerY, 
    rect.width, rect.height,
    palette.groundBase
  );
  container.add(baseGround);
  
  // 明暗紋理疊加
  const lightPatch = scene.add.graphics();
  lightPatch.fillStyle(palette.groundLight, 0.3);
  // 不規則光斑形狀
  this.drawIrregularPatches(lightPatch, rect, 6);
  container.add(lightPatch);
  
  const darkPatch = scene.add.graphics();
  darkPatch.fillStyle(palette.groundDark, 0.2);
  // 不規則陰影形狀  
  this.drawIrregularPatches(darkPatch, rect, 4);
  container.add(darkPatch);
  
  return container;
}
```

### **邊界圍欄系統**
```typescript
// 場景邊界圍欄
function createBorderFencing(
  scene: Phaser.Scene,
  rect: Phaser.Geom.Rectangle,
  palette: ScenePalette
): Phaser.GameObjects.Container {
  const container = scene.add.container().setDepth(DEPTH.border);
  const fenceColor = palette.groundDark;
  
  // 四邊圍欄柱子
  const fencePosts = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.left, y: rect.bottom },
    { x: rect.right, y: rect.bottom }
  ];
  
  fencePosts.forEach(post => {
    const fencePost = scene.add.rectangle(post.x, post.y, 8, 20, fenceColor);
    container.add(fencePost);
  });
  
  // 圍欄橫樑連接
  this.createFenceBeams(container, rect, fenceColor);
  
  return container;
}
```

## 環境粒子系統

### **餘燼粒子效果**
```typescript
// 環境餘燼粒子
function createEmberParticles(
  scene: Phaser.Scene,
  rect: Phaser.Geom.Rectangle,
  palette: ScenePalette
): Phaser.GameObjects.Particles.ParticleEmitter | null {
  // 只有熔岩場景才有餘燼
  if (palette.glow === 0) return null;
  
  const emitter = scene.add.particles(0, 0, 'ember', {
    x: { min: rect.left, max: rect.right },
    y: rect.bottom,
    speedY: { min: -30, max: -10 },
    speedX: { min: -5, max: 5 },
    scale: { start: 0.1, end: 0.05 },
    alpha: { start: 0.8, end: 0 },
    lifespan: 3000,
    frequency: 200,
    tint: palette.glow
  });
  
  emitter.setDepth(DEPTH.embers);
  return emitter;
}
```

## 關卡配色系統

### **配色方案定義**
```typescript
// config.ts - 關卡配色庫
scene: {
  levels: [
    {
      name: "荒漠",
      groundBase: 0x8B7355,     // 沙漠棕
      groundDark: 0x6B5635,     // 深棕
      groundLight: 0xAB8B6B,    // 淺棕
      crackColor: 0x4A3728,     // 裂縫深棕
      pebble: 0x9C8A7A,         // 碎石灰
      glow: 0x0,                // 無熔岩
      skyTop: 0x87CEEB,         // 天空藍
      skyBottom: 0xF0E68C       // 地平黃
    },
    {
      name: "熔岩",
      groundBase: 0x4A4A4A,     // 岩石灰
      groundDark: 0x2A2A2A,     // 深灰
      groundLight: 0x6A6A6A,    // 淺灰
      crackColor: 0xFF4500,     // 熔岩紅
      pebble: 0x555555,         // 礦石灰
      glow: 0xFF6600,           // 熔岩橙光
      skyTop: 0x2F1B14,         // 暗紅天空
      skyBottom: 0x8B0000       // 深紅地平
    }
    // ...更多關卡配色
  ]
}
```

### **關卡變體系統**
```typescript
// 每個關卡的A/B變體選擇
function selectZoneVariant(levelIndex: number): ZoneVariant {
  // 奇偶關卡不同變體
  return levelIndex % 2 === 0 ? 'A' : 'B';
}

// 根據變體生成對應遠景
function createFarscapeByVariant(
  scene: Phaser.Scene,
  rect: Phaser.Geom.Rectangle,
  variant: ZoneVariant,
  palette: ScenePalette
): Phaser.GameObjects.Container {
  switch (variant) {
    case 'A': return createVariantA_Cityscape(scene, rect, palette);
    case 'B': return createVariantB_Volcanic(scene, rect, palette);
  }
}
```

## 場景管理系統

### **GameScene整合方式**
```typescript
// GameScene.ts - 場景系統使用
class GameScene {
  private sceneLayers: Phaser.GameObjects.Container[] = [];
  
  create(): void {
    // 生成場景視覺層
    this.createSceneLayers();
  }
  
  private createSceneLayers(): void {
    const palette = GameConfig.scene.levels[this.currentLevel];
    const variant = this.selectZoneVariant();
    const rect = this.getSceneRect();
    
    // 依序建立各層
    this.sceneLayers.push(createZoneBackground(this, rect, palette));
    this.sceneLayers.push(createZoneFarscape(this, rect, variant, palette));
    this.sceneLayers.push(createZoneOuterArea(this, rect, palette));
    this.sceneLayers.push(createZoneGround(this, rect, palette));
    this.sceneLayers.push(createZoneBorder(this, rect, palette));
    
    // 環境粒子 (可選)
    const emitters = createZoneEmbers(this, rect, palette);
    if (emitters) this.sceneLayers.push(...emitters);
  }
}
```

## 技術架構優勢

### **純函式設計**
- ✅ **無狀態**: 所有函式不依賴外部狀態
- ✅ **可預測**: 相同輸入產生相同輸出  
- ✅ **可測試**: 便於單元測試與驗證
- ✅ **可重用**: 跨場景、跨關卡重用

### **模組化分離**
- 📦 **職責單一**: 每個函式專注單一場景元素
- 🎨 **配置驅動**: 視覺效果由配色參數決定
- 🔧 **易擴展**: 新增場景元素無需修改現有代碼
- 🎭 **變體支援**: A/B變體提供視覺多樣性

### **P2-2重構成果**
- **zoneScenery.ts**: +376行 (場景系統完整抽取)
- **GameScene.ts**: -340行 (場景相關代碼移除)  
- **深度標準化**: 統一場景圖層深度管理
- **配色集中**: 關卡配色參數統一管理

**參考檔案**:
- `systems/zoneScenery.ts` (主場景系統 376行)
- `config.ts` (關卡配色定義)
- `scenes/GameScene.ts` (場景系統整合)
- commit fe938ff (P2-2重構記錄)
