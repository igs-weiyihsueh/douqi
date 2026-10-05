# 小遊戲系統架構分析報告

## 🎯 系統概覽

《3C大亂鬥》H5版本已實作完整的小遊戲系統架構，用戶可通過主菜單的「🎮 小遊戲 (G)」按鈕進入小遊戲選單，選擇不同的小遊戲進行遊玩。

## 📁 系統架構總覽

```
/mnt/d/3C/douqi/
├── minigames/
│   └── registry.ts           # 🎯 小遊戲註冊表（核心配置文件）
├── scenes/
│   ├── MinigameMenuScene.ts  # 📋 小遊戲選單場景
│   ├── CollectRaceScene.ts   # 🎮 收集競賽小遊戲
│   ├── PushSurvivalScene.ts  # 🎮 推人生存小遊戲
│   ├── BombArenaScene.ts     # 🎮 炸彈人對戰小遊戲
│   └── TitleScene.ts         # 🏠 主菜單（包含小遊戲入口）
└── main.ts                   # ⚙️ 場景註冊配置
```

## 🔧 核心組件分析

### 1. **小遊戲註冊表 (`minigames/registry.ts`)**

這是整個系統的**核心配置文件**，定義了所有小遊戲的元數據：

```typescript
export interface MinigameEntry {
  key: string;       // 唯一鍵
  name: string;      // 顯示名稱  
  sceneKey: string;  // 對應的 Phaser Scene key
  desc: string;      // 選單上的簡短說明
  icon: string;      // 選單圖示（emoji）
}

export const MINIGAMES: MinigameEntry[] = [
  {
    key: 'collect-race',
    name: '收集競賽',
    sceneKey: 'CollectRaceScene',
    desc: '60 秒內收集告示指定的形狀丟進自己的箱子，比誰分數高！(1 人 vs 3 BOT)',
    icon: '💎'
  },
  // ... 更多小遊戲
];
```

### 2. **小遊戲選單場景 (`MinigameMenuScene.ts`)**

自動讀取註冊表，生成動態選單：

- ✅ **自動載入**: 從`MINIGAMES`數組自動生成選單項
- ✅ **互動體驗**: 支持鼠標點擊和鍵盤導航（上下鍵/WS選擇，空格/回車確認）
- ✅ **視覺效果**: 黃色高亮框脈動效果，卡片懸停變色
- ✅ **快捷返回**: ESC鍵或"返回主選單"按鈕

### 3. **主菜單入口 (`TitleScene.ts`)**

在主菜單左下角提供小遊戲入口：

```typescript
// 小遊戲入口：🎮 小遊戲 (G) → MinigameMenuScene
const mgBtn = // ... 按鈕配置
mgBtn.on('pointerdown', () => this.scene.start('MinigameMenuScene'));
this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.G)
  .on('down', () => this.scene.start('MinigameMenuScene'));
```

### 4. **場景註冊系統 (`main.ts`)**

所有小遊戲場景必須在主程序中註冊：

```typescript
scene: [
  BootScene, TitleScene, GameScene, UIScene, GameOverScene,
  MinigameMenuScene,        // 小遊戲選單
  CollectRaceScene,         // 收集競賽
  PushSurvivalScene,        // 推人生存  
  BombArenaScene           // 炸彈人對戰
]
```

## 🎮 現有小遊戲列表

| 圖示 | 名稱 | Scene Key | 描述 | 狀態 |
|------|------|-----------|------|------|
| 💎 | 收集競賽 | `CollectRaceScene` | 60秒內收集指定形狀，比分數高 | ✅ 已實作 |  
| 💥 | 推人生存 | `PushSurvivalScene` | 閃躲爆炸圈，推人害死對手 | ✅ 已實作 |
| 💣 | 炸彈人對戰 | `BombArenaScene` | 撿炸彈丟向對手，最後活著者勝 | ✅ 已實作 |

## 🚀 新增小遊戲的標準流程

### 步驟1: 創建小遊戲場景類

```typescript
// scenes/NewMinigameScene.ts
import Phaser from 'phaser';
import { GameConfig } from '../config';

export class NewMinigameScene extends Phaser.Scene {
  constructor() {
    super('NewMinigameScene'); // 🎯 Scene Key
  }

  create(): void {
    // 🎮 遊戲邏輯實作
    
    // 📍 標準返回按鈕（參考其他小遊戲）
    this.makeEndButton(x, y, '← 小遊戲選單', 0x2d3748, () => {
      this.scene.start('MinigameMenuScene');
    });
  }
  
  // 🎯 遊戲具體邏輯...
}
```

### 步驟2: 註冊到主程序

```typescript
// main.ts
import { NewMinigameScene } from './scenes/NewMinigameScene';

scene: [
  // ... 現有場景
  NewMinigameScene  // 🆕 新增這行
]
```

### 步驟3: 添加到註冊表

```typescript
// minigames/registry.ts  
export const MINIGAMES: MinigameEntry[] = [
  // ... 現有小遊戲
  {
    key: 'new-minigame',
    name: '新小遊戲',
    sceneKey: 'NewMinigameScene', // 🎯 必須匹配Scene的constructor參數
    desc: '這是新小遊戲的簡短描述',
    icon: '🎲'  // 選擇合適的emoji圖示
  }
];
```

## ✨ 系統特色與優勢

### 🔄 **熱插拔架構**
- 新增小遊戲只需修改3個文件：Scene類 + main.ts註冊 + registry.ts添加條目
- MinigameMenuScene自動檢測並顯示新小遊戲，無需額外修改

### 🎯 **統一用戶體驗**  
- 所有小遊戲都有統一的返回路徑：`← 小遊戲選單`
- 一致的按鈕樣式和互動方式
- 標準的結束流程（再玩一次/返回選單）

### 🎮 **豐富的互動方式**
- 鼠標點擊 + 鍵盤導航雙支持
- 視覺反饋（高亮、懸停、脈動效果）
- 快捷鍵支持（G進入選單，ESC返回主菜單）

### 🔧 **可擴展設計**
- 開放式註冊表，易於添加新遊戲類型
- 場景獨立性，互不干擾
- 標準化的數據結構

## 📋 建議的小遊戲開發規範

### 🎯 **命名規範**
- Scene類名: `{GameName}Scene` (如: `RacingScene`)
- Scene Key: 與類名一致 (如: `'RacingScene'`) 
- Registry Key: kebab-case (如: `'car-racing'`)

### 🎨 **視覺規範**  
- 使用統一的配色方案（參考`GameConfig`）
- 標準按鈕樣式（240x48尺寸，圓角矩形）
- 一致的字體（monospace）和字號

### 🎮 **功能規範**
- 必須實作返回小遊戲選單功能
- 建議添加"再玩一次"選項
- 支持ESC快捷鍵退出
- 遊戲結束時顯示結果統計

### 🔧 **技術規範**
- 獨立的遊戲邏輯，不依賴GameScene
- 使用標準Phaser組件和功能
- 適當的深度層級管理
- 性能優化（cleanup和resource management）

## 🎯 總結

現有的小遊戲系統已經提供了一個**完整、可擴展、用戶友好**的架構。新增小遊戲的流程非常簡化：

1. ✅ **場景實作**: 創建獨立的遊戲場景類
2. ✅ **系統整合**: 在main.ts註冊場景  
3. ✅ **選單顯示**: 在registry.ts添加元數據

系統會自動處理選單生成、導航邏輯、視覺效果等通用功能，開發者只需專注於遊戲本身的創意和邏輯實作。

**新增小遊戲所需時間估算**: 1-2天（取決於遊戲複雜度），系統集成只需5分鐘！** 🚀
