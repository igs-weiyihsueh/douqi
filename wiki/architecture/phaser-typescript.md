# Phaser + TypeScript 技術架構

## 專案配置體系

### TypeScript 嚴格模式配置
```json
// tsconfig.json - 高品質程式碼保證
{
  "compilerOptions": {
    "target": "ES2020",              // 現代JS特性支援
    "module": "ESNext",              // ES模組系統
    "moduleResolution": "bundler",   // Vite bundler解析
    "strict": true,                  // 嚴格型別檢查
    "noUnusedLocals": true,          // 禁止未使用變數
    "noUnusedParameters": true,      // 禁止未使用參數
    "noImplicitReturns": true,       // 強制明確回傳
    "isolatedModules": true          // 模組隔離編譯
  }
}
```

### Vite 建構配置
```typescript
// vite.config.ts - 現代化建構工具
export default defineConfig({
  base: './',                    // 相對路徑部署
  publicDir: 'public',           // 靜態資源目錄
  
  server: {
    host: true,                  // 網路存取
    port: 5173                   // 開發服務器埠
  },
  
  build: {
    target: 'es2020',           // 建構目標
    outDir: 'dist',             // 輸出目錄
    emptyOutDir: true,          // 清空輸出
    minify: false,              // 開發階段不壓縮
    treeshake: false            // 關閉搖樹優化
  }
});
```

## Phaser 引擎整合

### 遊戲配置初始化
```typescript
// main.ts - Phaser遊戲實例配置
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,                    // 自動選擇WebGL/Canvas
  parent: 'game',                       // DOM掛載點
  backgroundColor: '#12131a',           // 暗色背景
  pixelArt: true,                       // 像素藝術模式
  roundPixels: true,                    // 像素對齊
  
  scale: {
    mode: Phaser.Scale.FIT,            // 等比縮放
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GameConfig.width,           // 1920×1080
    height: GameConfig.height
  },
  
  physics: {
    default: 'arcade',                 // Arcade物理引擎
    arcade: { debug: false, gravity: { y: 0 } }
  }
};
```

### Scene 生命週期管理
```typescript
// Scene註冊與生命週期
scene: [
  BootScene,          // preload → create → start(TitleScene)
  TitleScene,         // 選單 → start(GameScene, data)
  GameScene,          // 核心邏輯 → launch(UIScene)
  UIScene,            // HUD覆蓋 → 並行運行
  GameOverScene,      // 結算 → restart流程
  ...MinigameScenes   // 小遊戲群組
]

// Scene間通訊模式
this.scene.start('GameScene', { mode: 'fast' });  // 切換+傳參
this.scene.launch('UIScene');                     // 並行啟動
this.scene.get('UIScene').updateHealth(hp);       // 跨Scene呼叫
```

## 模組化架構設計

### 物件導向設計模式
```typescript
// 繼承體系
Phaser.Physics.Arcade.Sprite
├── Character    // 角色基類
│   ├── Player   // 玩家控制
│   └── Bot      // AI控制
└── Enemy        // 敵人基類
    ├── Normal   // 普通敵人
    ├── Tank     // 坦克型
    └── Boss     // BOSS型

// 組合模式
class GameScene {
  private characters: Character[];           // 角色管理
  private enemies: Phaser.Physics.Arcade.Group;  // 敵人群組
  private systems: {                        // 系統組合
    spawn: SpawnSystem,
    ai: AISystem, 
    combat: CombatSystem
  };
}
```

### 配置驅動架構
```typescript
// config.ts - 中央配置系統
export const GameConfig = {
  // 模組化配置
  player: { hp: 100, speed: 180, ... },
  enemy: { 
    types: {
      normal: { hp: 90, speed: 45, ... },
      tank: { hp: 320, speed: 30, ... }
    }
  },
  skills: { /* 技能配置 */ },
  // ... 更多子系統
};

// 型別安全的配置使用
import { GameConfig } from '../config';
const damage: number = GameConfig.player.attackDamage;
```

## TypeScript 進階特性運用

### 型別系統設計
```typescript
// 列舉與聯合型別
export type EnemyType = 'normal' | 'tank' | 'shielder' | 'shooter' | 'charger';
export type SkillType = 'A' | 'B' | 'C' | 'E' | 'T' | 'H';
export type WaveState = 'spawning' | 'clearing' | 'intermission' | 'boss' | 'event';

// 介面定義
interface MinigameEntry {
  key: string;
  name: string; 
  sceneKey: string;
  desc: string;
  icon: string;
}

// 泛型約束
interface GameObject {
  x: number;
  y: number;
}

class Character {
  lockedTarget: (Phaser.GameObjects.GameObject & GameObject) | null;
}
```

### 模組化導入策略
```typescript
// ES6 模組導入
import Phaser from 'phaser';                    // 預設導入
import { GameConfig } from './config';          // 命名導入
import { Character } from './objects/Character'; // 相對路徑
import type { EnemyType } from './objects/Enemy'; // 型別導入

// 動態導入(未使用)
// const scene = await import('./scenes/GameScene');
```

## 效能優化技術

### 編譯時優化
```typescript
// 型別檢查但不產生運行時開銷
const enum Direction {
  UP, DOWN, LEFT, RIGHT  // 編譯時內聯
}

// 斷言與型別縮窄
const body = this.body as Phaser.Physics.Arcade.Body;
if (enemy.type === 'boss') {
  // TypeScript知道這裡enemy是Boss型別
}
```

### 運行時優化
```typescript
// 物件池 (Phaser群組自動管理)
this.enemies = this.physics.add.group({
  maxSize: 500,              // 池大小
  runChildUpdate: true       // 自動更新
});

// 條件編譯
if (GameConfig.debug.showSlowTuningPanel) {
  this.createDebugPanel();  // 開發模式功能
}
```

## 除錯與開發工具

### 全域除錯接口
```typescript
// main.ts - 開發工具整合
(window as unknown as { __game: Phaser.Game }).__game = game;

// 防護機制
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();  // 防止右鍵選單
}, false);

console.log('🛡️ 瀏覽器右鍵防護已啟用');
```

### 型別安全的除錯
```typescript
// 條件性除錯功能
class GameScene {
  debugState(): object {
    return {
      wave: this.currentWave,
      enemies: this.enemies.children.size,
      characters: this.characters.map(c => ({
        hp: c.hp,
        alive: c.alive
      }))
    };
  }
}

// 使用方式
// window.__game.scene.getScene('GameScene').debugState();
```

## 部署與建構

### GitHub Actions整合
```yaml
# .github/workflows/deploy.yml
- name: Install dependencies
  run: npm ci
  
- name: Build
  run: npm run build  # tsc --noEmit && vite build
  
- name: Deploy
  uses: peaceiris/actions-gh-pages@v3
```

### 建構輸出結構
```
dist/
├── index.html              # 入口頁面
├── assets/
│   ├── index-[hash].js    # 主要邏輯
│   ├── chunk-[hash].js    # 代碼分割塊
│   └── [name]-[hash].[ext] # 靜態資源
└── public/                 # 複製的公共資源
```

**參考檔案**: `main.ts`, `vite.config.ts`, `tsconfig.json`, `package.json`
