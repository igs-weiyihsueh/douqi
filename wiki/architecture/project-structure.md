# 專案架構設計

## 目錄結構重大更新 (P2-1重構 9782518)

### 頂層結構概覽
```
douqi/
├── controllers/         🆕 有狀態場景操作模組
├── systems/            📝 純邏輯與資料模組  
├── objects/            角色與遊戲物件
├── scenes/             Phaser場景管理
├── minigames/          小遊戲獨立模組
├── wiki/               技術文檔庫
└── dist/               編譯輸出 (自動生成)
```

## 🚀 **P2-1重構成果** (commit 9782518)

### **新增Controllers目錄**
**設計目的**: 放置有狀態、會操作場景物件的系統模組  
**與Systems區別**: Controllers負責場景操作，Systems負責純邏輯

```typescript
controllers/
├── BossController.ts   🆕 BOSS系統完整控制 (651行)
└── (未來擴展)
```

### **重構統計**
- **BossController.ts**: +651行 (從GameScene抽取)
- **GameScene.ts**: -594行 (8,059→7,682行，下降7.4%)
- **systems/telegraphFx.ts**: +17行 (預警特效型別抽出)
- **淨變化**: +723行新增，-539行重構

### **核心架構變更**

#### **1. BossHost介面設計**
```typescript
// controllers/BossController.ts:7-42
export interface BossHost {
  readonly scene: Phaser.Scene;
  readonly enemies: Phaser.Physics.Arcade.Group;
  arena(): Phaser.Geom.Rectangle;
  characters(): ReadonlyArray<Character>;
  player(): Character;
  // ...更多場景能力開放
}
```

**設計原則**:
- ✅ **能力開放**: BossController通過介面存取GameScene必要功能
- ✅ **封裝保護**: 不直接存取場景私有成員
- ✅ **職責分離**: GameScene提供能力，Controller執行邏輯

#### **2. BOSS系統完整抽取**
**抽取範圍**:
- 🎯 **BOSS登場系統**: 位置計算、出場動畫、音效
- 🎯 **三招攻擊**: 衝刺、射擊、雷射技能完整邏輯
- 🎯 **亂入與離場**: 隨機亂入、擊殺離場機制
- 🎯 **命中與掉票**: 傷害處理、彩票掉落邏輯
- 🎯 **屍體系統**: 慢速模式BOSS屍體與變身機制
- 🎯 **變身功能**: P1靠近按Z鍵變身邏輯

**技術特色**:
- 📦 **狀態封裝**: BOSS相關狀態完全封裝在Controller內
- 🔗 **介面通訊**: 透過BossHost介面與GameScene協作  
- 🧪 **行為不變**: headless回歸測試確認行為一致性

#### **3. 預警特效系統重組**
```typescript
// systems/telegraphFx.ts - 抽出的型別定義
export interface TelegraphFx {
  owner: 'tower' | 'boss';
  gfx: Phaser.GameObjects.Graphics;
  tween?: Phaser.Tweens.Tween;
  fired: boolean;
}
```

**作用**: 統一塔防與BOSS的蓄力預警特效管理

## **目錄職責定義**

### **controllers/ (新增)**
**定位**: 有狀態、會操作場景物件的系統模組
**特色**:
- ✅ **場景依賴**: 需要Phaser場景物件進行渲染、動畫、碰撞
- ✅ **狀態管理**: 維護複雜的內部狀態與生命週期
- ✅ **高內聚**: 相關功能完整封裝在單一Controller

**當前模組**:
- `BossController.ts` - BOSS完整生命週期管理

### **systems/ (職責調整)**
**定位**: 純邏輯與資料模組 (不變)
**特色**:
- ✅ **場景無關**: 不依賴特定Phaser場景物件
- ✅ **純函數優先**: 數據處理、邏輯計算為主
- ✅ **可重用**: 跨場景、跨系統重用

**當前模組**:
- `characterParams.ts` - 角色參數存讀檔
- `telegraphFx.ts` - 預警特效型別定義

### **objects/ (維持不變)**
**定位**: Phaser遊戲物件類別
**範例**: `Character.ts`, `Enemy.ts`, `CharacterEditorPanel.ts`

### **scenes/ (核心簡化)**
**GameScene重構效果**:
- ✅ **代碼量下降**: 8,059行→7,682行 (-4.7%)
- ✅ **職責收窄**: 專注場景核心邏輯，BOSS系統委派給Controller
- ✅ **維護性提升**: 複雜系統抽取後更易理解與修改

## **架構設計模式**

### **Controller模式**
```typescript
// GameScene中使用BossController
class GameScene implements BossHost {
  private bossController = new BossController(this);
  
  // 實作BossHost介面
  arena(): Phaser.Geom.Rectangle { return this.arena; }
  characters(): ReadonlyArray<Character> { return this.characters; }
  // ...更多介面實作
}
```

**優勢**:
- 🎯 **關注分離**: GameScene專注場景管理，Controller專注業務邏輯
- 🔧 **易於測試**: Controller可獨立測試，依賴透過介面注入
- 📈 **可擴展**: 未來其他大型系統可比照抽取

### **介面驅動設計**
```typescript
// 開放必要能力，保護內部實作
interface BossHost {
  // 只開放Controller需要的場景能力
  damageCharacter(c: Character, amount: number, ...): void;
  triggerComboHit(actor: Character): void;
  showEventBanner(text: string): void;
  // 不開放內部私有狀態
}
```

**設計準則**:
- ✅ **最小權限**: 只開放Controller必要的場景功能
- ✅ **契約明確**: 介面定義清楚雙方責任
- ✅ **實作隱藏**: GameScene內部邏輯不暴露給Controller

## **P2-1重構里程碑意義**

### **架構演進成果**
1. **模組化成功**: 651行BOSS系統成功抽取，證明大型系統可拆解
2. **介面設計**: BossHost介面提供了Controller與Scene協作的標準模式
3. **代碼品質**: GameScene代碼量下降，職責更清晰
4. **測試驗證**: headless測試確保重構後行為一致

### **後續架構演進方向**
- 🎯 **P2-2計劃**: 角色系統、敵人系統進一步模組化
- 🎯 **Controller擴展**: 技能系統、道具系統可比照抽取
- 🎯 **介面標準化**: 建立更多Host介面模式

**參考檔案**: 
- `controllers/BossController.ts` (主要架構)
- `systems/telegraphFx.ts` (型別定義)  
- `scenes/GameScene.ts` (重構後場景)
- commit 9782518 (完整變更記錄)
