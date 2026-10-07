# 新關卡系統 (Stage System)

> 🕒 最後更新：2026-10-07 19:25 (commit: 874b8f9)
> 📋 維護者：威騎

## 概述

新關卡系統實現從傳統8關波次制改為無限小關卡循環+卷軸HUD的重大架構變革。系統核心特色：無限延伸世界、4圓點進度HUD、階級化轉場機制、荒城↔火山主題交替。

## 📊 系統架構

### 核心配置
```typescript
// config.ts:920-940
stage: {
  enabled: true,                                    // 關卡制開關
  stageCycle: [                                     // 無限循環關卡定義
    { quota: 20, chest: 'low' },                   // 關1: 擊殺20隻→低階寶箱
    { quota: 25, chest: 'low' },                   // 關2: 擊殺25隻→低階寶箱  
    { quota: 30, chest: 'low' },                   // 關3: 擊殺30隻→低階寶箱
    { quota: 35, chest: 'high' }                   // 關4: 擊殺35隻→高階寶箱
  ],
  chestTickets: { low: 5, high: 30 },              // 寶箱彩票獎勵數量
  sceneLevel: 1,                                    // 固定場景配色(火山荒城)
  totalLevels: 4                                    // 場景配色數(除錯預覽範圍)
}
```

### 狀態管理
```typescript
// GameScene.ts:83-91
class GameScene {
  private currentStage = 1;                         // 當前關卡編號(1起算,無限遞增)
  private currentLevel = 1;                         // 場景配色用關卡key(固定為sceneLevel)
  private stageInProgress = false;                  // 關卡進行中標記
  private lastStageChest: 'low' | 'high';         // 剛完成關卡的寶箱階級
  private areaVariant: 'A' | 'B' = 'A';           // 場景變體('A'荒城/'B'火山)
  private dirLock: 'L' | 'R' | null = null;       // 方向限制(null=兩側開放)
}
```

## 🎯 關卡循環機制

### 關卡定義與循環
```typescript
// GameScene.ts:2822-2825
private stageDef(stage: number): { quota: number; chest: 'low' | 'high' } {
  const cycle = GameConfig.stage.stageCycle;
  return cycle[(stage - 1) % cycle.length];        // 循環取得關卡定義
}
```

### 關卡開始與完成
```typescript
// GameScene.ts:2828-2839 - 關卡開始
startStage(stage: number): void {
  const def = this.stageDef(stage);
  this.waveQuota = def.quota;                      // 設定擊殺目標
  this.waveState = 'spawning';                     // 開始生怪
  this.stageInProgress = true;                     // 標記關卡進行中
}

// GameScene.ts:2840-2856 - 關卡完成
completeStage(): void {
  const def = this.stageDef(this.currentStage);
  this.lastStageChest = def.chest;                 // 記錄寶箱階級
  
  // 發放彩票獎勵給每位存活角色
  this.characters.forEach(char => {
    if (char.hp > 0) this.grantStageReward(char, def.chest);
  });
  
  this.currentStage++;                             // 進入下一關
  this.stageInProgress = false;
}

// GameScene.ts:2857-2863 - 獎勵發放
grantStageReward(char: Character, chest: 'low' | 'high'): void {
  const tickets = GameConfig.stage.chestTickets[chest];
  char.credit += tickets;                          // 增加彩票
  this.ui.playComboRewardFx(char, `+${tickets} 彩票`); // 播放特效
}
```

## 🎨 卷軸HUD系統

### 資料流與狀態
```typescript
// GameScene.ts:7795 - 發送HUD資料
emitStats(): void {
  this.ui.updateStats({
    stage: this.currentStage,                      // 當前關卡編號
    stageKilled: this.stageInProgress ? this.waveKilled : 0, // 關卡擊殺數
    stageQuota: this.stageDef(this.currentStage).quota,      // 關卡目標
    stageChests: this.generateStageChests()        // 4格寶箱階級預覽
  });
}

// UIScene.ts:781-800 - HUD狀態更新  
updateStageHudState(stats: GameStats): void {
  const wasNewStage = stats.stage > this.stageHudState.stage;
  
  if (wasNewStage) {
    // 記錄剛完成的寶箱用於遞補動畫
    this.stageHudPrevChest = this.stageHudState.chests[0];
    this.stageHudShiftAt = this.time.now;
    this.stageHudFillTarget = 0;                   // 量條歸零
  }
  
  this.stageHudState = stats;
  this.stageHudFillTarget = stats.stageKilled / stats.stageQuota; // 進度比例
}
```

### 視覺渲染
```typescript
// UIScene.ts:809-853 - 主繪製函式
drawStageHud(): void {
  const cfg = GameConfig.waveHud;
  const state = this.stageHudState;
  
  // 遞補動畫進度
  const shiftProgress = Math.min(1, (this.time.now - this.stageHudShiftAt) / cfg.shiftMs);
  const ease = Phaser.Math.Easing.Cubic.Out(shiftProgress);
  
  // 繪製4個圓點和連接線
  for (let i = 0; i < cfg.visibleStages; i++) {
    const x = cfg.x + i * cfg.nodeGap - ease * cfg.nodeGap; // 遞補滑動
    const chest = state.stageChests[i];
    const nodeState = i === 0 ? 'current' : 'future';
    const alpha = i === cfg.visibleStages - 1 ? ease : 1;   // 新圓點淡入
    
    this.drawStageNode(x, cfg.y, chest, nodeState, alpha);
  }
}

// UIScene.ts:854-890 - 圓點繪製
drawStageNode(x: number, y: number, chest: 'low' | 'high', 
              state: StageNodeState, alpha: number): void {
  // 底盤圓形
  this.hudGraphics.fillStyle(0x444444, alpha);
  this.hudGraphics.fillCircle(x, y, cfg.nodeRadius);
  
  // current狀態脈動外框
  if (state === 'current') {
    const pulse = 0.8 + 0.2 * Math.sin(this.time.now * 0.005);
    this.hudGraphics.lineStyle(3, 0xffffff, alpha * pulse);
    this.hudGraphics.strokeCircle(x, y, cfg.nodeRadius + 2);
  }
  
  // 高階寶箱金色光暈
  if (chest === 'high') {
    this.hudGraphics.fillStyle(0xffd700, alpha * 0.3);
    this.hudGraphics.fillCircle(x, y, cfg.nodeRadius + 8);
  }
  
  // 寶箱圖示 (箱體+箱蓋+鎖扣)
  const chestColor = chest === 'high' ? 0xffd700 : 0x8b4513;
  // ... 寶箱繪製細節
}
```

## 🔄 轉場系統

### 轉場分流機制
```typescript
// GameScene.ts:2297-2310 - 完成後分流
onSubZoneComplete(): void {
  if (this.lastStageChest === 'low') {
    this.openCrossing();                           // 低階→左右平移轉場
  } else {
    this.progressPhase = 'exiting';
    this.showExit();                               // 高階→上方閃黑轉場  
  }
}
```

### 低階轉場：左右平移
```typescript
// GameScene.ts:2330-2370 - 開放通道
openCrossing(): void {
  const side = this.dirLock || (Math.random() < 0.5 ? 'L' : 'R');
  this.dirLock = side;                             // 鎖定前進方向
  
  // 開放物理邊界、繪製走廊、顯示箭頭提示
  this.openPhysicalBorder(side);
  this.drawCorridor(side);
  this.showDirectionArrow(side);
}

// GameScene.ts:2408-2450 - 偵測玩家跨越
updateCrossing(): void {
  if (this.progressPhase !== 'choosing') return;
  
  const bounds = this.getStageBounds();
  const trigger = this.dirLock === 'L' ? bounds.left : bounds.right;
  
  if (this.player.x < trigger || this.player.x > trigger) {
    this.startCameraPanToB(this.dirLock);          // 觸發鏡頭平移
  }
}

// GameScene.ts:2494-2525 - 鏡頭平移與自動行走
startCameraPanToB(side: 'L' | 'R'): void {
  this.progressPhase = 'panning';
  
  // 鏡頭平移到新區域
  const targetX = side === 'L' ? this.slotL.x : this.slotR.x;
  this.cameras.main.pan(targetX, this.player.y, 1000, 'Quad.easeInOut');
  
  // 玩家自動走進新區域
  this.autoWalkIntoB(side);
}
```

### 無限延伸機制
```typescript
// GameScene.ts:2572-2620 - 世界重構
recenterOn(side: 'L' | 'R'): void {
  // 重新標記slot位置
  const arrivedSlot = side === 'L' ? this.slotL : this.slotR;
  this.slotC = arrivedSlot;                        // 抵達slot變成中央
  
  // 前方新增slot
  if (side === 'L') {
    this.slotR = this.slotC;                       // 原中央→右鄰
    this.slotL = this.createNewSlot('L');          // 新增左側slot
  } else {
    this.slotL = this.slotC;                       // 原中央→左鄰  
    this.slotR = this.createNewSlot('R');          // 新增右側slot
  }
  
  // 背景圖重用與回收
  this.recycleDistantSlot();                       // 回收最遠slot
  this.repositionBackgrounds();                    // F4背景圖搬移
}
```

### 高階轉場：上方閃黑
```typescript
// GameScene.ts:2716-2760 - 上方出口
showExit(): void {
  const bounds = this.getStageBounds();
  const exitX = bounds.centerX;
  const exitY = bounds.top - 100;                  // 移動區上方
  
  // 繪製出口特效
  this.drawExitPortal(exitX, exitY);
  this.showExitHint();
}

// GameScene.ts:2875-2889 - 閃黑轉場
startTransition(): void {
  this.cameras.main.fadeOut(500, 0, 0, 0);        // 淡出到黑
  
  this.time.delayedCall(500, () => {
    this.advanceToNextLevel();                     // 場景變體切換
  });
}

// GameScene.ts:2890-2920 - 場景變體切換  
advanceToNextLevel(): void {
  this.dirLock = null;                             // 重置方向限制
  this.areaVariant = this.otherVariant();          // 荒城↔火山切換
  
  // 重繪三格場景
  this.drawAreaScenes();
  
  // 全隊從下方入場
  this.characters.forEach(char => {
    char.setPosition(centerX, bounds.bottom + 200);
    this.autoWalkUp(char);
  });
  
  this.cameras.main.fadeIn(500);                   // 淡入新場景
}
```

## 🌍 場景系統

### 雙變體架構
```typescript
// GameScene.ts:91, 2621-2625
private areaVariant: 'A' | 'B' = 'A';             // 當前場景變體
private otherVariant(): 'A' | 'B' {
  return this.areaVariant === 'A' ? 'B' : 'A';     // 荒城↔火山切換
}

// 變體特色
const variants = {
  A: '荒城 - 廢墟建築、石牆殘骸、沙塵色調',
  B: '火山 - 熔岩流、火山岩、橙紅色調'  
};
```

### 三格slot系統
```typescript
// GameScene.ts:3096-3140 - 場景繪製
drawZoneScene(slotKey: 'L' | 'C' | 'R'): void {
  const slot = this[`slot${slotKey}`];
  const variant = slotKey === 'C' ? this.areaVariant : this.otherVariant();
  
  // 登記到slotLayers用於回收
  if (!this.slotLayers[slot.id]) {
    this.slotLayers[slot.id] = { objects: [], bgImages: [] };
  }
  
  this.drawZoneSceneLayers(slot, variant);         // 實際繪製
}
```

## 📈 系統移除與保留

### 已移除內容
- **BOSS關系統**: startBossLevel已刪除，不再有BOSS關卡流程
- **事件輪替**: rollSubZoneContent、eventBag、lastSubZoneKind已刪除
- **8關限制**: currentLevel固定為sceneLevel，不再有關卡推進
- **森林/洞窟**: sceneThemeOf、drawFarForest、drawFarCave、scene.levels 5~8已刪除
- **關卡橫幅**: showLevelBanner自動顯示已移除

### 保留但不呼叫
```typescript
// 保留系統本體供經典模式(stage.enabled=false)使用
- BOSS系統本體: spawnBoss、BOSS技能、onBossKilled (GameScene.ts:3682)
- 事件系統本體: startEvent (GameScene.ts:3740)、塔/守護/佔領事件
- 關卡橫幅: showLevelBanner本體，僅除錯預覽使用
```

## 🔧 配置參數

### HUD配置
```typescript
// config.ts:58-80 (49b634d常數化，待上線)  
waveHud: {
  x: 960, y: 100,                                  // HUD位置
  nodeRadius: 22,                                  // 圓點半徑
  nodeGap: 150,                                    // 圓點間距
  visibleStages: 4,                                // 顯示關卡數
  shiftMs: 450,                                    // 遞補動畫時長
  
  // 寶箱顏色與尺寸
  chestColors: { low: 0x8b4513, high: 0xffd700 },
  chestRatios: { width: 0.6, height: 0.4, lock: 0.2 }
}
```

### 移動區配置  
```typescript
// config.ts:930-950
stage: {
  arenaW: 2520, arenaH: 840,                       // 移動區尺寸
  sceneMarginX: 0,                                 // 左右貼齊slot邊緣
  sceneMarginTop: 504,                             // 上方熔岩斷崖帶
  sceneMarginBottom: 336                           // 下方岩石禁區
}

// slot計算: (arenaW + 2×marginX) × (arenaH + marginTop + marginBottom) = 2520×1680
```

## 🏗 文檔交叉參考

- [戰鬥系統](./combat-system.md) - COMBO獎勵與關卡獎勵整合
- [UI實作](./ui-implementation.md) - 卷軸HUD視覺實作細節  
- [資料流](../architecture/data-flow.md) - GameScene↔UIScene統計資料傳遞
- [架構決策](../decisions/architecture-evolution.md) - 關卡制vs波次制設計決策
- [術語表](../glossary.md) - stage、chest、slot等核心術語定義
