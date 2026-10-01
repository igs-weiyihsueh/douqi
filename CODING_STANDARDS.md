# TypeScript 程式碼規範 (參考SF6 SKILL)

## 工作流程

- 做規格修改前，先與使用者討論方案，確認好再動手實作
- 修改程式碼前，先確認插入/替換位置的上下文結構完整（大括號配對、方法邊界）
- 修改程式碼後，必須檢查大括號平衡、方法結構未被破壞、沒有產生孤立的 `{` 或 `}`

## JSDoc 註解

- 所有新增的欄位、方法、邏輯區塊都要寫 JSDoc 註解或行內註解
- 使用 `/** */` 格式為 public/private 方法加註解
- 邏輯區塊用 `//` 行內註解說明意圖

```typescript
/**
 * 創建角色頭上UI容器
 * @param character 角色狀態數據，包含位置和屬性
 * @param index 角色在隊列中的索引(0-3)，用作Map鍵值
 * @returns 包含編號牌、Credit顯示、能量條的Container
 */
private createOverheadUI(character: CharStat, index: number): Phaser.GameObjects.Container {
    // 創建200×80px容器，用於承載頭上UI元素
    const container = this.add.container(0, 0);
    return container;
}
```

## 大括號風格

- if / else / for / while / foreach 即使只有一行也必須加大括號
- 大括號採用 K&R style（開括號同行）

```typescript
// 正確
if (condition) {
    doSomething();
}

// 錯誤  
if (condition)
    doSomething();

// 錯誤
if (condition) doSomething();
```

## 禁止魔法數字

- 所有數值必須宣告為常數或可設定欄位，禁止直接寫死數字在邏輯中

```typescript
// 正確
const UI_LAYOUT = {
    BADGE_OFFSET_Y: -25,
    CREDIT_OFFSET_Y: 5,
    ENERGY_OFFSET_Y: 35,
    SAFE_SPACING: 40
} as const;

const SWORD_DIMENSIONS = {
    BLADE_WIDTH: 4,
    BLADE_LENGTH: 12,
    GUARD_WIDTH: 12,
    GUARD_HEIGHT: 2
} as const;

if (energy >= UI_LAYOUT.CREDIT_OFFSET_Y) { ... }

// 錯誤
if (energy >= 5) { ... }
swordIcon.fillRect(-2, -8, 4, 12); // 無常數定義
```

## 存取修飾子

- 所有類成員都必須有明確的存取修飾子（private / protected / public）

```typescript
// 正確
private overheadUIs: Map<number, Phaser.GameObjects.Container> = new Map();
public updateStats(stats: StatsPayload): void { ... }

// 錯誤  
overheadUIs: Map<number, Phaser.GameObjects.Container> = new Map(); // 缺少 private
```

## 命名規範

- 私有欄位：`camelCase` 
- 私有方法：`camelCase`
- 公開屬性：`camelCase` 
- 公開方法：`camelCase`
- 常數物件：`UPPER_SNAKE_CASE`
- 常數屬性：`UPPER_SNAKE_CASE`
- 參數/區域變數：`camelCase`
- 介面：`PascalCase`
- 類別：`PascalCase`

```typescript
// 正確的命名
class UIScene extends Phaser.Scene {
    private overheadUIs: Map<number, Container> = new Map();
    private readonly OVERHEAD_DEPTH = 900;
    
    private createOverheadUI(character: CharStat, index: number): Container { ... }
    public updateStats(stats: StatsPayload): void { ... }
}

interface CharStat {
    x: number;
    y: number;
    credit: number;
}
```

## 程式碼結構組織

使用區塊註解組織程式碼，順序如下：

```typescript
/**
 * [類別描述] 
 * 頭上UI系統管理器，負責角色上方浮動元素的創建、更新和銷毀
 */
export class UIScene extends Phaser.Scene {
    // ========================================
    // Fields & Properties  
    // ========================================
    private overheadUIs: Map<number, Container> = new Map();
    private readonly OVERHEAD_DEPTH = 900;
    
    // ========================================
    // Constants
    // ========================================
    private static readonly UI_LAYOUT = {
        BADGE_OFFSET_Y: -25,
        CREDIT_OFFSET_Y: 5
    } as const;
    
    // ========================================
    // Phaser Lifecycle Methods
    // ========================================
    create(): void { ... }
    update(): void { ... }
    
    // ========================================  
    // Public Methods
    // ========================================
    updateStats(stats: StatsPayload): void { ... }
    
    // ========================================
    // Private Methods  
    // ========================================
    private createOverheadUI(character: CharStat, index: number): Container { ... }
    private updateOverheadUIContent(character: CharStat, container: Container): void { ... }
}
```

## 複雜邏輯註解要求

- 座標轉換邏輯必須註解
- 圖形繪製邏輯必須說明各部分用途
- 數學計算必須說明公式意圖

```typescript
/**
 * 繪製22x22px劍形圖標
 * 包含劍身、劍尖、護手、劍柄四個部分
 */
private drawSwordIcon(graphics: Phaser.GameObjects.Graphics, isFlashing: boolean): void {
    const fillColor = isFlashing ? 0xff3b30 : 0xffca28;
    const strokeColor = isFlashing ? 0xcc0000 : 0xffa000;
    
    graphics.clear();
    graphics.fillStyle(fillColor);
    graphics.lineStyle(1, strokeColor);
    
    // 劍身：垂直矩形 4×12px，劍的主體部分
    graphics.fillRect(-2, -8, SWORD_DIMENSIONS.BLADE_WIDTH, SWORD_DIMENSIONS.BLADE_LENGTH);
    
    // 劍尖：三角形，指向上方形成尖端  
    graphics.fillTriangle(0, -8, -2, -8, 0, -11);
    
    // 護手：水平橫條 12×2px，分隔劍身與劍柄
    graphics.fillRect(-6, 4, SWORD_DIMENSIONS.GUARD_WIDTH, SWORD_DIMENSIONS.GUARD_HEIGHT);
    
    // 劍柄：垂直矩形 2×4px，握持部分
    graphics.fillRect(-1, 6, 2, 4);
    
    // 底部裝飾：2px圓形，劍柄末端
    graphics.fillCircle(0, 10, 2);
}

/**
 * 轉換世界座標到螢幕座標
 * GameScene使用相機偏移，UIScene使用固定相機，需要座標轉換
 */
private worldToScreenCoordinates(worldX: number, worldY: number): { x: number; y: number } {
    const gcam = this.scene.get('GameScene')?.cameras?.main;
    // 減去相機滾動偏移，轉換為螢幕座標
    const screenX = worldX - (gcam?.scrollX || 0);  
    const screenY = worldY - (gcam?.scrollY || 0);
    return { x: screenX, y: screenY };
}
```

## TypeScript 最佳實踐

- 遵循 TypeScript 特定的最佳實踐
- 正確使用 interface 和 type
- 適當的 type assertion 使用
- 生成的程式碼應可直接通過 ESLint 檢查

## Code Review 檢查重點

### 翼騎開發時必須確認：
1. ✅ 所有函式都有完整 JSDoc 註解
2. ✅ 複雜邏輯有行內註解說明
3. ✅ 沒有魔法數字，全部提取為常數  
4. ✅ 命名規範一致性
5. ✅ 存取修飾子明確
6. ✅ 程式碼結構清晰組織

### 征騎審查時必須檢驗：
1. 🔍 JSDoc 註解完整性和準確性
2. 🔍 常數提取是否充分
3. 🔍 命名規範是否一致
4. 🔍 程式碼結構是否清晰
5. 🔍 複雜邏輯是否有充分說明
6. 🔍 是否符合 TypeScript 最佳實踐

---

**此規範為地球宿舍 H5 專案程式碼標準，翼騎開發、征騎審查時必須嚴格遵守！**
