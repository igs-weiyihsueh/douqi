# 架構決策演進

## 鏡頭跟隨空間擴大與地圖邊界重新定義 (7975cc9, 2decdde)

### 決策背景
**原有問題**：
- 鏡頭固定不動，玩家移動範圍受限於畫面大小
- 場景背景固定在畫面上，無法展現更大的遊戲世界
- 邊界編輯器複雜但使用頻率低，增加維護負擔

**用戶需求**：
- 希望鏡頭能跟隨玩家移動，提供更動態的視覺體驗
- 場景背景應該是遊戲世界的一部分，而非UI元素
- 簡化開發工具，專注核心功能

### 架構決策

#### 1. 鏡頭跟隨系統 (7975cc9)
**舊架構**：
```typescript
// 固定鏡頭，玩家移動範圍=畫面大小
arena: { 
  padding: 72,           // 場地內縮
  size: 1920×1080      // 固定在畫面內
}
```

**新架構**：
```typescript
// 動態鏡頭跟隨玩家
cameras.main.startFollow(player, true, 0.08, 0.04);  // X/Y不同lerp
cameras.main.setDeadzone(320, 180);                  // 縮小死區

// 移動區擴大 + slot概念
stage: {
  arenaW: 2520, arenaH: 840,     // 可移動區 (後續調整)
  slotSize: 2520×1680           // 完整slot包含遠景
}
```

**技術優勢**：
- 鏡頭即時跟隨，死區縮小 (540×600 → 320×180)
- 玩家可在更大範圍移動，探索感增強
- 不同軸向lerp (X:0.08, Y:0.04) 提供更自然的跟隨

#### 2. 場景背景世界化 (7975cc9)
**舊設計**：
```typescript
// 背景固定在畫面上 (UI層級)
sceneBackground.setScrollFactor(0);  // 不隨鏡頭移動
```

**新設計**：
```typescript
// 背景貼在遊戲世界中
sceneBackgrounds: Image[];  // 每個slot一張，支援多場景
createCoverImage();         // 等比放大 + 裁切，不變形
setDepth(SCENE_BG_DEPTH);   // 0.5: 地面0 < 背景0.5 < 圍欄1
```

**架構改進**：
- 背景成為世界的一部分，隨鏡頭自然捲動
- 支援關卡制多slot背景 ([B-左, A-中, B-右])
- 視覺層次更清晰，深度管理統一

#### 3. 地圖邊界對齊背景圖 (2decdde)
**舊邊界**：
```typescript
// 四周均勻內縮
arena.padding = 72;  // 所有方向相同
```

**新邊界**：
```typescript
// 對齊背景圖地形特徵
stage: {
  arenaW: 2520,              // 左右貼齊背景圖寬度
  arenaH: 840,               // 高度配合地形
  sceneMarginX: 0,           // 左右無邊距
  sceneMarginTop: 504,       // 上方熔岩斷崖禁區
  sceneMarginBottom: 336     // 下方岩石帶禁區
}
```

**設計理念**：
- 遊戲邊界與視覺元素一致，玩家直觀理解可移動範圍
- 非對稱邊界更符合實際地形設計
- 水平空間最大化，垂直空間按地形限制

#### 4. 開發工具簡化 (2decdde)
**移除邊界編輯器**：
```typescript
// 刪除複雜的邊界調參系統
- borderEditorActive, borderSliders[]
- 🔧邊界設定按鈕, B鍵快捷鍵
- borderPreview, borderEditor相關UI
- config.borderEditor整個配置段落
```

**保留zoom編輯器**：
```typescript
// 專注實用的開發工具
zoomEditor: {
  // 相機縮放仍需要常調整
  defaultZoom: 1.0,
  minZoom: 0.3, maxZoom: 3.0
}
```

### 技術影響

#### 正面影響
1. **視覺體驗提升**：鏡頭跟隨讓遊戲感覺更動態
2. **世界感增強**：背景成為世界一部分，沉浸感更好
3. **代碼簡化**：移除低頻使用的複雜功能
4. **維護負擔減輕**：邊界編輯器相關bug風險消除

#### 潛在風險
1. **性能考量**：鏡頭跟隨增加渲染計算
2. **UI適配**：固定UI元素需要setScrollFactor(0)
3. **測試複雜度**：多slot背景需要更多測試場景

#### 緩解措施
```typescript
// UI元素固定畫面
showEventBanner().setScrollFactor(0);        // 事件提示
bossIntroOverlay.setScrollFactor(0);         // BOSS登場
timestopDarkOverlay.setScrollFactor(0);      // 時停暗幕

// BOSS技能範圍動態調整  
const arenaRadius = Math.sqrt(arenaW*arenaW + arenaH*arenaH) / 2;  // 移動區對角線
```

### 決策評估

**成功指標**：
- ✅ 鏡頭跟隨運行穩定，無明顯性能問題
- ✅ 場景背景視覺效果提升，世界感增強  
- ✅ 邊界編輯器移除後代碼更簡潔
- ✅ UI固定元素適配完成，無視覺錯位

**後續優化方向**：
- 考慮鏡頭跟隨的平滑度微調
- 評估是否需要鏡頭邊界的軟限制
- 多slot背景的記憶體優化

### 相關Commits
- **7975cc9**: 鏡頭跟隨空間擴大 + F4背景貼世界
- **2decdde**: 關卡模式地圖邊界重新定義 + 移除邊界編輯器
- **b62d292**: sceneBackgrounds欄位JSDoc註解優化

**決策時間**: 2026-10-07  
**決策者**: 翼騎 + Claude Opus 5.5  
**審核**: 銳騎通過
