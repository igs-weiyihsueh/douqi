# 遊戲引擎架構

## 技術棧概覽

### 核心依賴
```json
{
  "dependencies": {
    "phaser": "3.80.1"
  },
  "devDependencies": {
    "typescript": "5.4.5", 
    "vite": "5.2.11",
    "@types/node": "^26.6.3"
  }
}
```

### 專案配置
- **解析度**: 1920×1080 (16:9橫向)
- **縮放模式**: Phaser.Scale.FIT + CENTER_BOTH (等比縮放滿版)
- **物理引擎**: Arcade Physics (無重力俯視角設計)
- **渲染**: Phaser.AUTO (WebGL優先，Canvas fallback)
- **像素風格**: `pixelArt: true`, `roundPixels: true`

## Scene系統架構

### 場景註冊順序
```typescript
// main.ts - 場景生命週期
scene: [
  BootScene,           // 資源載入與貼圖生成
  TitleScene,          // 主選單與模式選擇
  GameScene,           // 核心遊戲邏輯
  UIScene,             // HUD覆蓋層  
  GameOverScene,       // 結算重開
  MinigameMenuScene,   // 小遊戲選單
  CollectRaceScene,    // 收集競賽小遊戲
  PushSurvivalScene,   // 推人生存小遊戲
  BombArenaScene,      // 炸彈人對戰小遊戲
  PeachLotteryScene    // 桃樹彩票小遊戲
]
```

### 場景職責分工
| Scene | 檔案 | 主要職責 | 大小 | 更新 |
|-------|------|----------|------|------|
| `BootScene` | 24KB | 程序化貼圖生成、資源預處理 | 小 | - |
| `TitleScene` | 44KB | 主選單、模式選擇、設定面板 | 中 | - |
| `GameScene` | 160KB | 🎯 核心遊戲邏輯、戰鬥系統 | **中** | 方案C-2完成 |
| `UIScene` | 71KB | HUD系統、血條、UI覆蓋 | 大 | - |
| `GameOverScene` | 5KB | 結算畫面、重新開始 | 小 | - |
| `MinigameMenuScene` | 5KB | 小遊戲選單導航 | 小 | - |

### 場景職責分工
| Scene | 檔案 | 主要職責 | 大小 | 更新 |
|-------|------|----------|------|------|
| `BootScene` | 24KB | 程序化貼圖生成、資源預處理 | 小 | - |
| `TitleScene` | 44KB | 主選單、模式選擇、設定面板 | 中 | - |
| `GameScene` | 134KB | 🎯 核心遊戲邏輯、戰鬥系統 | **中** | 方案C-3完成 |
| `UIScene` | 71KB | HUD系統、血條、UI覆蓋 | 大 | - |
| `GameOverScene` | 5KB | 結算畫面、重新開始 | 小 | - |
| `MinigameMenuScene` | 5KB | 小遊戲選單導航 | 小 | - |

### 場景職責分工
| Scene | 檔案 | 主要職責 | 大小 | 更新 |
|-------|------|----------|------|------|
| `BootScene` | 24KB | 程序化貼圖生成、資源預處理 | 小 | - |
| `TitleScene` | 44KB | 主選單、模式選擇、設定面板 | 中 | - |
| `GameScene` | 106KB | 🎯 核心遊戲邏輯、戰鬥系統 | **中** | 方案C完成 |
| `UIScene` | 71KB | HUD系統、血條、UI覆蓋 | 大 | - |
| `GameOverScene` | 5KB | 結算畫面、重新開始 | 小 | - |
| `MinigameMenuScene` | 5KB | 小遊戲選單導航 | 小 | - |

**方案B+C重構史詩完成** (commits 7bb93c4+cc7a433+b7e9a77+3c143c8+10f4af8+ede39c8+c05df68+5baaf48+c358b54+4502caa):
- **GameScene**: 315KB→106KB，6,301行→2,116行 (-66%史詩級瘦身)
- **十五Controller**: SpawnController+EnemyAttackController+CombatFx新增，15個Controller完整體系
- **架構成就**: 創造軟體重構史上-66%瘦身創新紀錄，Legacy巨型檔案到極致模組化完美轉型

### 場景間通訊
```typescript
// 場景啟動與資料傳遞
this.scene.start('GameScene', { controlMode: 'fast' });
this.scene.launch('UIScene');  // 並行UI覆蓋層
this.scene.bringToTop('UIScene');

// 跨場景狀態共享
const gameScene = this.scene.get('GameScene') as GameScene;
const uiScene = this.scene.get('UIScene') as UIScene;
```

## 遊戲物件系統

### 核心物件架構
```typescript
// 物件繼承關係
Phaser.Physics.Arcade.Sprite
├── Character        // 角色基類 (P1+BOT共用)
└── Enemy           // 敵人基類 (5種類型)

Phaser.GameObjects.Sprite  
├── Item            // 道具拾取物
├── Bullet          // ~~子彈物件~~ (ad47c9c已移除)
└── Breakable       // 可破壞物件
```

### 物件管理系統
```typescript
// GameScene中的群組管理
private characters: Character[] = [];              // 角色陣列
private enemies: Phaser.Physics.Arcade.Group;     // 敵人物理群組
private items: Phaser.Physics.Arcade.Group;       // 道具群組  
private bullets: Phaser.Physics.Arcade.Group;     // ~~子彈群組~~ (ad47c9c已移除)
private breakables: Phaser.GameObjects.Group;     // 可破壞物群組
```

## 配置中心化系統

### GameConfig架構
```typescript
// config.ts - 統一配置管理
export const GameConfig = {
  // 基礎設定
  width: 1920, height: 1080,
  
  // 除錯開關
  debug: {
    showSlowTuningPanel: false,
    showZoomEditor: false
  },
  
  // 遊戲系統配置
  player: { /* 角色屬性 */ },
  enemy: { /* 敵人配置 */ },
  skills: { /* 技能參數 */ },
  // ...更多子系統配置
};
```

### 配置使用模式
```typescript
// 類型安全的配置引用
import { GameConfig } from '../config';

// 角色初始化
hp: number = GameConfig.player.maxHp;
moveSpeed = GameConfig.player.moveSpeed;

// 動態數值計算
const damage = levelLerp(
  GameConfig.player.attackDamage * 0.6,  // Lv1
  GameConfig.player.attackDamage         // Lv10
);
```

## 物理系統設計

### Arcade Physics配置
```typescript
physics: {
  default: 'arcade',
  arcade: {
    debug: false,              // 生產環境關閉碰撞框顯示
    gravity: { y: 0 }          // 俯視角無重力
  }
}
```

### 碰撞檢測層級
1. **Physics Group自動碰撞** - 基礎物件互動
2. **自定義距離檢測** - 高精度命中判定
3. **範圍查詢** - AOE技能、視野檢測

## 小遊戲框架

### 註冊系統
```typescript
// minigames/registry.ts - 可擴充框架
export interface MinigameEntry {
  key: string;           // 唯一識別
  name: string;          // 顯示名稱  
  sceneKey: string;      // 場景KEY
  desc: string;          // 描述文字
  icon: string;          // 顯示圖示
}

export const MINIGAMES: MinigameEntry[] = [
  { key: 'collect-race', name: '收集競賽', ... },
  { key: 'push-survival', name: '推人生存', ... },
  { key: 'bomb-arena', name: '炸彈人對戰', ... },
  { key: 'peach-lottery', name: '桃樹彩票', ... }
];
```

### 動態選單生成
```typescript
// MinigameMenuScene自動依registry生成UI
MINIGAMES.forEach((game, index) => {
  this.createGameCard(game, index);
});
```

## 除錯與測試支援

### 全域除錯接口
```typescript
// main.ts - 供自動化測試/主控台檢視
(window as unknown as { __game: Phaser.Game }).__game = game;

// 右鍵防護
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
}, false);
```

### 開發工具整合
- **TypeScript嚴格模式**: 編譯時錯誤檢查
- **Vite HMR**: 開發時熱更新 (WSL環境受限)
- **ESModule**: 現代化模組系統

**參考檔案**: `main.ts`, `config.ts`, `package.json`, `minigames/registry.ts`
