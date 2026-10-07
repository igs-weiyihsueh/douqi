# H5 TypeScript 程式碼規範

## 概述

本文檔定義了鬥氣割草專案的TypeScript + Phaser開發規範，確保代碼品質和團隊協作一致性。

## 程式碼品質評分標準

**權重分配**：
- **JSDoc註解完整性** (25%) - 所有公開方法必須有完整註解
- **魔法數字提取** (20%) - 將硬編碼數字提取為有意義的常數
- **命名規範一致性** (15%) - 遵循TypeScript命名慣例
- **程式碼結構清晰度** (15%) - 邏輯分層清晰，職責明確
- **複雜邏輯註解** (15%) - 複雜算法必須有說明註解
- **TypeScript最佳實踐** (10%) - 正確使用型別系統

## 開發流程

### 1. 開發前檢查
- 確認需求規格和修改範圍
- 檢查目標位置的程式碼結構  
- 規劃常數定義和命名

### 2. 規範撰寫
- 使用完整JSDoc註解
- 提取所有魔法數字為常數
- 遵循TypeScript命名規範
- 為複雜邏輯添加行內註解

### 3. 自我檢查
- ✅ JSDoc註解完整性
- ✅ 魔法數字常數化
- ✅ 命名規範一致性  
- ✅ 複雜邏輯說明充分

### 4. 代碼審查
審查者按品質權重檢查所有項目，確保符合標準。

## JSDoc 註解標準

```typescript
/**
 * 角色移動控制器
 * @description 處理玩家角色的移動邏輯，包括速度計算和邊界檢測
 */
class CharacterMovement {
    /**
     * 移動角色到指定位置
     * @param x - 目標X座標
     * @param y - 目標Y座標  
     * @param speed - 移動速度 (pixels/second)
     * @returns 是否成功移動
     */
    moveTo(x: number, y: number, speed: number): boolean {
        // 實作邏輯
    }
}
```

## 常數管理

```typescript
// ❌ 避免魔法數字
character.setSpeed(150);
if (health < 30) { /* 低血量邏輯 */ }

// ✅ 使用有意義的常數
const DEFAULT_MOVEMENT_SPEED = 150;
const LOW_HEALTH_THRESHOLD = 30;

character.setSpeed(DEFAULT_MOVEMENT_SPEED);  
if (health < LOW_HEALTH_THRESHOLD) { /* 低血量邏輯 */ }
```

## 命名規範

- **類別**：PascalCase (`GameScene`, `CharacterController`)
- **方法/變數**：camelCase (`moveCharacter`, `currentHealth`) 
- **常數**：UPPER_SNAKE_CASE (`MAX_PLAYER_COUNT`, `DEFAULT_SPEED`)
- **介面**：I + PascalCase (`IGameConfig`, `ICharacterStats`)

## 禁止事項

⚠️ **嚴禁使用的開發命令**：
- `npm run dev` - 會阻塞終端
- `vite` - 直接啟動會導致掛起

✅ **正確的建構命令**：
- `npm run build` - 編譯和建構
- 靜態檔案放在 `public/` 目錄供即時serve

---
*基於：h5-coding-standards SKILL*  
*創建日期：2026-10-07*  
*維護者：3C團隊*
