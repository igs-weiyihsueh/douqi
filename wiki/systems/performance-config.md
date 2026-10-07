# 效能和配置管理

## 配置中心化系統

### GameConfig統一架構
```typescript
// config.ts - 中央配置管理
export const GameConfig = {
  // 基礎顯示配置
  width: 1920,                    // 16:9解析度
  height: 1080,
  
  // 除錯開關
  debug: {
    showSlowTuningPanel: false,   // 慢速模式調參面板
    showZoomEditor: false         // 相機縮放編輯器
  },
  
  // 場地設置
  arena: {
    padding: 72,                  // 場地內縮 (按比例調整)
    borderThickness: 6,           // 圍欄粗細
    borderColor: 0x3a4668,       // 圍欄顏色
    bounceRestitution: 0.6       // 邊界反彈係數
  },
  
  // 敵人系統配置
  enemy: {
    types: {
      normal: { hp: 90, moveSpeed: 45, damage: 15 },
      tank: { hp: 320, moveSpeed: 30, damage: 20 },
      shielder: { hp: 150, shield: 50, moveSpeed: 40 }
    }
  }
  // ... 更多子系統配置
};
```

### 動態數值計算
```typescript
// 等級化數值系統
export function levelLerp(lv1Value: number, lv10Value: number, level: number): number {
  const t = (level - 1) / 9;  // 0~1映射
  return lv1Value + t * (lv10Value - lv1Value);
}

// 使用範例
const currentDamage = levelLerp(
  GameConfig.player.attackDamage * 0.6,  // Lv1: 15
  GameConfig.player.attackDamage          // Lv10: 25
);

const spawnRate = levelLerp(1000, 500, teamLevel);  // 生成間隔遞減
```

### 配置型別安全
```typescript
// 型別安全的配置使用
import { GameConfig } from '../config';

class Character {
  // 正確：明確型別標註
  private maxHp: number = GameConfig.player.maxHp;
  
  // 錯誤：會產生 TS2322 錯誤 (as const 數字欄位是 literal type)
  // private maxHp = GameConfig.player.maxHp;
}
```

## 效能優化策略

### 敵人分離系統優化
```typescript
// config.ts - 敵人碰撞分離配置
enemySeparation: {
  enabled: true,
  radiusPx: 44,              // 影響半徑：參考敵半徑×2~3
  weight: 1.1,               // 分離權重：平衡分離與追擊
  iterations: 2,             // 硬解重疊迭代次數
  maxStepPx: 9              // 單幀最大推移：防瞬移爆衝
}

// 分離算法：軟steering + 硬de-overlap
updateEnemySeparation() {
  // 1. 軟分離：計算鄰居影響
  const separationForce = this.calculateSeparationForce(enemy);
  
  // 2. 結合追擊與分離
  const finalDirection = Phaser.Math.Vector2.Normalize(
    targetDirection.add(separationForce.scale(config.weight))
  );
  
  // 3. 硬解重疊：迭代推開
  for (let i = 0; i < config.iterations; i++) {
    this.resolveOverlaps();
  }
}
```

### 波次生成效能控制
```typescript
// systems/waveMath.ts - 智慧生成控制
export function shouldSpawnMore(s: WaveSpawnState): boolean {
  const occupancy = s.alive + s.pending;
  
  // 三層檢查避免過度生成
  if (s.progress + occupancy >= s.targetProgress) return false; // 總量封頂
  if (occupancy >= s.maxAlive) return false;                    // 場上上限
  return s.refilling;                                           // 補生狀態
}

// 補生栓機制：防抖避免邊界震盪
export function updateRefillLatch(...): boolean {
  // 開啟條件：跌破閾值
  if (!refilling && occupancy < spawnThreshold) return true;
  
  // 關閉條件：補滿上限
  if (refilling && occupancy >= maxAlive) return false;
  
  // 其他情況：維持狀態(遲滯)
  return refilling;
}
```

## Phaser性能優化

### 物件池管理
```typescript
// 自動池化的物理群組
class GameScene {
  create() {
    this.enemies = this.physics.add.group({
      maxSize: 500,              // 池大小限制
      runChildUpdate: true,      // 自動update子物件
      createCallback: this.onEnemyCreate,
      removeCallback: this.onEnemyRemove
    });
  }
  
  // 物件重用機制
  spawnEnemy(x: number, y: number, type: EnemyType): Enemy {
    let enemy = this.enemies.getFirstDead(false) as Enemy;
    
    if (!enemy) {
      enemy = new Enemy(this, x, y, type);
      this.enemies.add(enemy);
    } else {
      enemy.resetState(x, y, type);  // 重置狀態重用
    }
    
    return enemy;
  }
}
```

### UI更新效能控制
```typescript
// 條件更新機制
class UIScene {
  private needsUIUpdate = false;
  
  updateUI(forceUpdate: boolean = false) {
    if (!forceUpdate && !this.needsUIUpdate) return;
    
    // 批次更新所有UI元素
    this.updateHealthBars();
    this.updateExperienceBar();
    this.updateSkillCooldowns();
    
    this.needsUIUpdate = false;
  }
  
  // 智慧觸發更新
  onPlayerStateChange() {
    this.needsUIUpdate = true;
  }
}
```

### 特效數量節流
```typescript
// 全域特效管理
class GameScene {
  private activeFxCount = 0;
  private readonly maxActiveFx = 40;  // 同時特效上限
  
  spawnDamageText(x: number, y: number, damage: number) {
    if (this.activeFxCount >= this.maxActiveFx) {
      return; // 超量直接忽略，優先保證流暢度
    }
    
    this.activeFxCount++;
    
    const text = this.add.text(x, y, damage.toString(), {
      fontSize: '16px',
      fill: '#ffff00'
    });
    
    this.tweens.add({
      targets: text,
      y: y - 50,
      alpha: 0,
      duration: 600,
      onComplete: () => {
        this.activeFxCount--;
        text.destroy();
      }
    });
  }
}
```

## 建構與部署最佳化

### Vite建構配置
```typescript
// vite.config.ts - 生產最佳化
export default defineConfig({
  base: './',                    // 相對路徑部署
  
  build: {
    target: 'es2020',           // 現代瀏覽器目標
    outDir: 'dist',             // 輸出目錄
    emptyOutDir: true,          // 清空輸出
    minify: false,              // 開發階段不壓縮
    sourcemap: false,           // 關閉sourcemap避免警告
    
    rollupOptions: {
      treeshake: false,         // 關閉搖樹(開發需要)
      output: {
        // 資源命名策略
        entryFileNames: 'assets/index-[hash].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  
  resolve: {
    alias: {
      '@': resolve(__dirname, '.') // 根目錄別名
    }
  }
});
```

### TypeScript編譯優化
```json
// tsconfig.json - 編譯效能配置
{
  "compilerOptions": {
    "target": "ES2020",              // 現代JS特性
    "module": "ESNext",              // ES模組
    "moduleResolution": "bundler",   // Bundler解析
    "skipLibCheck": true,            // 跳過庫檢查加速編譯
    "isolatedModules": true,         // 模組隔離編譯
    "strict": true,                  // 嚴格模式保證品質
    "noUnusedLocals": true,          // 移除未使用變數
    "noUnusedParameters": true       // 移除未使用參數
  },
  "include": ["."]                   // 包含整個專案
}
```

## 記憶體管理

### 場景生命週期管理
```typescript
// 場景清理機制
class GameOverScene {
  restart() {
    // 完全重建避免材質殘留
    this.scene.stop('UIScene');
    this.scene.stop('GameScene');
    
    // 延遲重啟確保清理完成
    this.time.delayedCall(100, () => {
      this.scene.start('TitleScene');
    });
  }
}

// 物件清理
class Character {
  destroy() {
    // 停止所有動畫
    this.burstMarkTween?.stop();
    
    // 清理粒子效果
    this.empowerParticles?.destroy();
    
    // 呼叫父類清理
    super.destroy();
  }
}
```

### 材質管理策略
```typescript
// BootScene - 程序化材質生成
class BootScene {
  create() {
    // 一次性生成所有需要的材質
    this.generateAllTextures();
    
    // 立即清理graphics物件
    this.graphicsObjects.forEach(g => g.destroy());
    
    // 材質由Phaser自動管理，直接進入下個場景
    this.scene.start('TitleScene');
  }
  
  generateAllTextures() {
    // 角色材質
    ['blue', 'yellow', 'red', 'green'].forEach(color => {
      this.makeHumanoidTexture(color);
    });
    
    // 敵人材質  
    Object.keys(GameConfig.enemy.types).forEach(type => {
      this.makeEnemyTexture(type);
    });
  }
}
```

## 調參與除錯系統

### 即時調參面板
```typescript
// TitleScene - 開發工具
class TitleScene {
  // zoom編輯器配置
  zoomEditor: {
    defaultZoom: 1.0,
    minZoom: 0.3, maxZoom: 3.0,
    fineStep: 0.05,              // 微調步進
    coarseStep: 0.1,             // 粗調步進
    keyboardStep: 0.2,           // 鍵盤步進
    
    // UI位置 - 右上角避免重疊
    panelX: 1580, panelY: 50,
    panelWidth: 320, panelHeight: 180
  },
  
  // 快捷鍵系統
  shortcuts: {
    zoomIn: ['PLUS', 'NUMPAD_ADD'],
    zoomOut: ['MINUS', 'NUMPAD_SUBTRACT'],
    reset: ['R']
  }
}
```

### 條件編譯機制
```typescript
// 開發功能條件啟用
if (GameConfig.debug.showSlowTuningPanel) {
  this.createSlowTuningPanel();
}

if (GameConfig.debug.showZoomEditor) {
  this.createZoomEditor();
}

// 生產環境自動優化
const isProduction = process.env.NODE_ENV === 'production';
if (!isProduction) {
  console.log('🛠️ 開發模式：除錯功能已啟用');
}
```

**參考檔案**: `config.ts`, `vite.config.ts`, `tsconfig.json`, `systems/waveMath.ts`, `scenes/BootScene.ts`
