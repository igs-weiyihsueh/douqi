# 專案架構設計

## 目錄結構持續升級 (方案B深度重構B-1完成)

### 頂層結構最新狀態
```
douqi/
├── controllers/         🎯 有狀態場景操作模組 (4個)
├── systems/            🔧 純邏輯與資料模組 (9個) 
├── objects/            🎮 角色與遊戲物件
├── scenes/             📱 Phaser場景管理
├── minigames/          🎪 小遊戲獨立模組
├── wiki/               📚 技術文檔庫
└── dist/               📦 編譯輸出 (自動生成)
```

## 🚀 **方案B深度重構 B-1里程碑** (commit 7bb93c4)

### **事件系統完整拆分成果**
- **重構前**: GameScene 6,301行 (P1a-P4a後基線)
- **重構後**: GameScene 5,621行 (305KB→281KB)
- **代碼量下降**: -680行 (-11%)
- **新增模組**: controllers/EventController.ts (879行)

### **B-1階段重構統計**
- **EventController.ts**: +879行 (事件系統完整抽取)
- **GameScene.ts**: -865行 (事件相關代碼移除)
- **淨變化**: +972行新增，-772行重構
- **核心瘦身**: GameScene從6,301行降到5,621行 (-680行)

## **新增模組完整架構升級**

### **controllers/ 目錄 (4個有狀態模組)**

#### **4. EventController.ts** (879行) 🆕
```typescript
// 限時事件系統完整控制器
export interface EventHost {
  readonly scene: Phaser.Scene;
  readonly enemies: Phaser.Physics.Arcade.Group;
  arena(): Phaser.Geom.Rectangle;
  currentSlot(): Phaser.Geom.Rectangle;
  characters(): ReadonlyArray<Character>;
  // ...事件執行必要能力
}

export class EventController {
  // 三種限時事件：塔/守護/佔領
  // 開場演出系統：走位→大字→聚焦→結束
  // 鏡頭聚焦與追蹤系統
}
```

**系統整合範圍**:
- 🏰 **塔事件**: 生成尖塔，扇形攻擊，擊敗條件
- 🛡️ **守護事件**: NPC保護，血量管理，失敗條件  
- ⛳ **佔領事件**: 圓圈佔領，進度計算，完成條件
- 🎬 **開場演出**: 四階段走位→大字→聚焦→開始
- 📹 **鏡頭系統**: 事件聚焦，平滑追蹤，跟隨恢復

#### **已有模組維持**
- **BossController.ts** (651行): BOSS系統完整控制
- **SkillController.ts** (547行): 一次性招式系統  
- **ArtStyleController.ts** (222行): F4美術切換系統

## **方案B深度重構整體計劃**

### **重構進度追蹤**
```typescript
// 方案B極致瘦身計劃：GameScene 6,301行 → 3,000行目標
interface RefactorPlan {
  'B-1': {
    name: '事件系統';
    status: '✅完成';
    reduction: -680;  // 6,301→5,621行
    module: 'controllers/EventController.ts';
  };
  'B-2': {
    name: 'slot世界+轉場';
    status: '🔄進行中';  
    target: 'SlotWorldController';
    estimate: -800; // 預估
  };
  'B-3': {
    name: '鎖定攻擊AI';
    status: '📋待進行';
    target: 'TargetingController'; 
    estimate: -600; // 預估
  };
  'B-4': {
    name: '除錯API重構';
    status: '📋待進行';
    method: '方案a';
    estimate: -400; // 預估
  };
}

// 進度: B-1完成(-680) + B-2~B-4預估(-1,800) = -2,480行
// 目標: 還需-141行 (6,301-3,000=3,301，已完成-680，還需-2,621)
```

### **B-1事件系統技術突破**

#### **EventHost介面設計**
```typescript
// 最小權限場景存取模式
export interface EventHost {
  // 必要場景物件
  readonly scene: Phaser.Scene;
  readonly enemies: Phaser.Physics.Arcade.Group;
  
  // 場景狀態查詢  
  arena(): Phaser.Geom.Rectangle;
  currentSlot(): Phaser.Geom.Rectangle;
  characters(): ReadonlyArray<Character>;
  currentWave(): number;
  
  // 事件執行能力
  damageCharacter(c: Character, ...): void;
  showEventBanner(text: string): void;
  enableFollow(slot: Phaser.Geom.Rectangle): void;
  onEventEnded(): void;
}
```

**設計原則**:
- ✅ **能力導向**: 只開放事件系統必要的場景功能
- ✅ **封裝保護**: 不直接存取GameScene私有成員  
- ✅ **職責邊界**: GameScene提供能力，EventController執行邏輯
- ✅ **生命週期**: create()時重建，取代resetState逐欄重設

#### **事件系統完整抽取**
**抽取範圍**:
- 🏰 **塔事件系統**: 尖塔生成、扇形攻擊、血量管理、擊敗判定
- 🛡️ **守護事件系統**: NPC保護、傷害處理、失敗條件、血量顯示
- ⛳ **佔領事件系統**: 圓圈生成、佔領進度、P1位置檢測、完成判定
- 🎬 **開場演出系統**: 四階段流程(走位→大字→聚焦→開始)
- 📹 **鏡頭聚焦系統**: 事件目標聚焦、平滑追蹤、跟隨恢復

**技術優化**:
- 📦 **代碼合併**: 四段重複hitGuardNpc邏輯統一為單一實作
- 🔄 **生命週期**: EventController每次create()重建，清理更徹底
- 🎯 **回調整合**: onTowerDestroyed()、onTimeStopEnd()標準化
- 🧹 **代碼清理**: 移除未使用eventPlayerCount，數值常數化

#### **零行為變更保證**
```typescript
// 品質保證測試
interface QualityAssurance {
  testScenarios: [
    '三種事件 × 成功/失敗模式',
    '時停順延測試',  
    '快速模式測試',
    '開場途中重開測試'
  ];
  verification: '新舊build決定性比對完全一致';
  review: '銳騎審查通過';
  deployment: 'index-C5t0t0Q8.js';
}
```

## **架構設計模式升級**

### **四層Controller模式**
```typescript
// GameScene變為Controller組合與協調中心
class GameScene implements BossHost, SkillHost, ArtStyleHost, EventHost {
  private bossController = new BossController(this);
  private skillController = new SkillController(this);
  private artStyleController = new ArtStyleController(this);
  private eventController = new EventController(this); // 🆕
  
  // 實作四個Host介面
  // ...各Controller所需的場景能力開放
}
```

### **Host介面標準化**
- ✅ **BossHost**: BOSS系統場景能力 (651行模組)
- ✅ **SkillHost**: 招式系統場景能力 (547行模組)  
- ✅ **ArtStyleHost**: 美術系統場景能力 (222行模組)
- ✅ **EventHost**: 事件系統場景能力 (879行模組) 🆕

### **系統邊界清晰化**
```typescript
// 明確的職責分工
const responsibilities = {
  GameScene: '場景協調、Controller組合、Host介面實作',
  Controllers: '業務邏輯封裝、狀態管理、生命週期控制',
  Systems: '純函式邏輯、工具函式、可重用模組',
  Objects: 'Phaser遊戲物件、實體類別定義'
};
```

## **B-1重構里程碑意義**

### **方案B可行性驗證**
- **技術可行**: 879行事件系統成功抽取，零行為變更
- **架構可行**: EventHost介面模式清晰可複製  
- **品質可行**: 完整測試覆蓋，銳騎審查通過
- **進度可行**: -680行達成，距離3,000行目標還需-2,621行

### **後續重構信心建立**
- 🎯 **B-2 slot世界**: 可比照EventController模式抽取
- 🎯 **B-3 攻擊AI**: TargetingController架構已有範本
- 🎯 **B-4 除錯API**: 方案a輔助tools系統重構
- 🎯 **最終目標**: GameScene極致瘦身到3,000行

### **架構演進成果**
1. **Controller模式成熟**: 4個Controller形成完整架構體系
2. **Host介面標準**: 統一的Controller-Scene協作模式  
3. **代碼品質**: 重複邏輯合併，常數提取，註解更新
4. **測試驗證**: 零行為變更的安全重構標準

## **P1a-P4a + B-1 綜合成果**

### **GameScene演進軌跡**
- **起點**: 8,059行 (P1a前Legacy巨型檔案)
- **P1a-P4a**: 6,124行 (12個模組，-24%)
- **B-1完成**: 5,621行 (4個Controller，-30.2%)  
- **B系列目標**: 3,000行 (極致瘦身，-62.8%)

### **模組化架構完善**
- **controllers/**: 4個有狀態場景操作模組 (2,299行)
- **systems/**: 9個純邏輯資料模組 (~1,000行)
- **總抽取**: ~3,300行代碼從GameScene成功模組化

**方案B深度重構B-1事件系統拆分成功，為GameScene極致瘦身目標奠定堅實基礎！** 🏗️✨

**參考檔案**: 
- `controllers/EventController.ts` (事件系統主模組 879行)
- `scenes/GameScene.ts` (重構後主場景 5,621行)
- commit 7bb93c4 (B-1事件系統拆分完成)
