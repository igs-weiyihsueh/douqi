# 技術選擇和原因

## 遊戲引擎選擇

### Phaser 3.80.1 選擇理由
**技術優勢**：
- 成熟的2D遊戲引擎，WebGL渲染效能優異
- 完整的Arcade Physics物理系統適合俯視角動作遊戲
- Scene管理系統支援複雜狀態切換和並行場景
- 豐富的輸入處理和事件系統
- TypeScript原生支援，開發體驗良好

**對比其他選擇**：
```typescript
// Phaser vs 其他方案
const engineComparison = {
  Phaser: {
    pros: ['完整遊戲框架', '豐富API', 'TypeScript支援'],
    cons: ['包體較大', '學習曲線']
  },
  PixiJS: {
    pros: ['輕量', '高效能渲染'],
    cons: ['需自建遊戲框架', '物理系統需外部庫']
  },
  Three.js: {
    pros: ['3D能力強'],
    cons: ['2D遊戲過重', '複雜度高']
  }
};
```

**實際驗證**：目前專案 GameScene 達 422KB，證明 Phaser 足以支撐複雜遊戲邏輯。

## 開發工具鏈決策

### TypeScript 5.4.5 + 嚴格模式
**選擇原因**：
```typescript
// tsconfig.json - 嚴格配置的價值
{
  "strict": true,                  // 強型別檢查防錯
  "noUnusedLocals": true,          // 清理無用代碼
  "noUnusedParameters": true,      // 參數使用檢查
  "noImplicitReturns": true        // 強制明確回傳
}
```

**開發效益**：
- 編譯時錯誤檢查減少運行時問題
- IDE智慧提示提升開發效率
- 代碼重構更安全可靠
- 團隊協作代碼品質一致

### Vite 5.2.11 vs Webpack
**選擇 Vite 的決定性因素**：
```typescript
// 開發體驗對比
const buildToolComparison = {
  Vite: {
    devServerStart: '< 1秒',
    hmr: '即時更新',
    buildSpeed: '快速',
    配置複雜度: '簡單'
  },
  Webpack: {
    devServerStart: '5-10秒',
    hmr: '較慢',
    buildSpeed: '中等',
    配置複雜度: '複雜'
  }
};
```

**配置簡潔性**：
```typescript
// vite.config.ts - 僅需簡單配置
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2020' }
});
```

## 架構模式決策

### Scene-based 架構
**採用 Phaser Scene 系統的理由**：
```typescript
// 場景分離帶來的好處
const sceneArchitecture = {
  BootScene: '資源載入與材質生成',
  TitleScene: '主選單與設定',
  GameScene: '核心遊戲邏輯',      // 422KB 主要邏輯
  UIScene: '71KB HUD系統',        // 並行覆蓋層
  GameOverScene: '結算重啟'
};

// 並行Scene優勢
this.scene.launch('UIScene');        // UI與邏輯分離
this.scene.bringToTop('UIScene');    // 層級管理清晰
```

**替代方案考量**：
- 單Scene方案：邏輯耦合，難以維護
- 自建狀態機：重複造輪子，複雜度高
- 選擇Scene系統：框架成熟，分離清晰

### 配置中心化設計
**統一配置管理** (`config.ts` 83KB)：
```typescript
// 中央配置的價值
export const GameConfig = {
  width: 1920, height: 1080,
  arena: { padding: 72, borderThickness: 6 },
  player: { maxHp: 100, moveSpeed: 180 },
  enemy: { types: { normal: {...}, tank: {...} } }
  // 所有遊戲數值集中管理
};

// 動態數值計算
export function levelLerp(lv1: number, lv10: number, level: number): number {
  const t = (level - 1) / 9;
  return lv1 + t * (lv10 - lv1);
}
```

**設計優勢**：
- 數值調整方便，支援即時調參
- 避免魔法數字散佈代碼中
- 等級化數值統一計算
- 團隊協作配置清晰

## 物理系統選擇

### Arcade Physics vs Matter.js
**選擇 Arcade Physics 的原因**：
```typescript
// 性能與需求平衡
const physicsComparison = {
  ArcadePhysics: {
    性能: '優秀 - 適合大量物件',
    API複雜度: '簡單易用',
    功能完整度: '2D俯視角足夠',
    整合度: '與Phaser完美整合'
  },
  MatterJS: {
    性能: '中等 - 高精度物理',
    API複雜度: '較複雜',
    功能完整度: '完整但過於複雜',
    整合度: '需要額外配置'
  }
};
```

**實際應用驗證**：
- 場上同時 500+ 敵人，Arcade Physics 表現良好
- 俯視角遊戲不需要複雜物理模擬
- 碰撞檢測滿足遊戲需求

### 混合碰撞檢測策略
**Arcade Physics + 自定義距離數學**：
```typescript
// 高速物件防穿透
function checkCircleCollision(a: GameObject, b: GameObject): boolean {
  const distance = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
  return distance <= (a.radius + b.getBodyRadius());
}

// 修正衝刺命中判定
findFirstEnemyInRangeOf(x, y, radius) {
  return enemies.find(enemy => {
    const distance = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
    return distance <= (radius + enemy.getBodyRadius()); // 邊緣到中心
  });
}
```

## 小遊戲框架決策

### 可擴充註冊系統
**選擇註冊表模式**：
```typescript
// minigames/registry.ts - 統一管理
export const MINIGAMES: MinigameEntry[] = [
  {
    key: 'collect-race',
    name: '收集競賽',
    sceneKey: 'CollectRaceScene',
    desc: '60 秒內收集指定形狀競賽',
    icon: '💎'
  }
  // 新增小遊戲只需添加到此陣列
];

// 動態選單生成
MinigameMenuScene.create() {
  MINIGAMES.forEach(game => this.createGameCard(game));
}
```

**設計優勢**：
- 新增小遊戲只需修改一個檔案
- 選單自動生成，無需手動維護
- 型別安全的介面定義
- 便於統一管理和擴展

### 1P+3BOT 統一模式
**所有小遊戲採用相同格式的理由**：
```typescript
// 統一的角色管理
interface GameCharacter {
  index: number;        // 0=P1, 1-3=BOT
  isBot: boolean;       // AI標記
  // 統一的屬性和方法
}

// 好處
const unifiedBenefits = {
  開發效率: '複用角色管理邏輯',
  用戶體驗: '一致的遊戲體驗',
  AI系統: '統一的難度平衡',
  維護成本: '單一系統維護'
};
```

## 效能優化決策

### 特效數量節流 vs 無限制
**選擇節流機制 (`maxActiveFx: 40`)**：
```typescript
// 效能保證策略
spawnEffect(type: string, x: number, y: number): boolean {
  if (this.activeFxCount >= this.maxActiveFx) {
    return false; // 超量忽略，優先保證流暢度
  }
  // 創建特效...
}
```

**決策考量**：
- 大量敵人同時死亡時防止卡頓
- 視覺效果品質 vs 遊戲流暢度平衡
- 使用者體驗優於視覺完整性

### 敵人分離系統設計
**軟分離 + 硬解重疊雙重機制**：
```typescript
// enemySeparation配置
{
  enabled: true,
  radiusPx: 44,        // 影響半徑：敵半徑×2~3
  weight: 1.1,         // 分離權重：平衡追擊與分離
  iterations: 2,       // 硬解迭代：性能與效果平衡
  maxStepPx: 9        // 防瞬移：單幀最大推移
}
```

**技術選擇**：
- 軟分離：自然的群體行為
- 硬解重疊：保證不會完全疊加
- 參數可調：支援即時調校

## 部署與維護決策

### 根目錄扁平架構
**解決 CI 部署問題**：
```typescript
// vite.config.ts - 簡化結構
{
  base: './',
  publicDir: 'public',
  // 無需特殊 root 設定
}
```

**GitHub Actions 相容性**：
- 避免複雜的子目錄結構
- 簡化建構路徑配置
- 提高部署可靠性

### TypeScript 嚴格模式取捨
**開發體驗 vs 限制**：
```typescript
// 遇到的實際問題
class Enemy {
  // ✓ 正確：明確型別標註
  private hp: number = GameConfig.enemy.types.normal.hp;
  
  // ✗ 錯誤：as const 數字欄位是 literal type
  // private hp = GameConfig.enemy.types.normal.hp; // TS2322
}
```

**解決策略**：
- 保持嚴格模式獲得型別安全
- 明確標註型別避免 literal type 問題
- 團隊統一編碼規範

**參考檔案**: `package.json`, `vite.config.ts`, `tsconfig.json`, `config.ts`, `minigames/registry.ts`
