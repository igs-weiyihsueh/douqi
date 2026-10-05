# 角色上方UI覆蓋系統測試指南

## 🎯 功能概述

實現了角色上方UI覆蓋系統，顯示MG_1P_Player_all.png：
- **UI元素**：顯示"1P"標識和積分信息
- **位置**：P1角色上方40像素處
- **層級**：UI層(depth=20)，最高優先級顯示

## 🎮 測試步驟

### 1. UI覆蓋基本顯示測試
1. 啟動遊戲 (npm run dev)
2. 進入GameScene
3. 按**F4**鍵激活覆蓋模式
4. 確認看到完整的三層覆蓋效果：
   - **背景層**：Scene.png火焰山背景
   - **角色皮膚層**：Goku皮膚覆蓋在P1角色上  
   - **UI層**：MG_1P_Player_all.png顯示在角色上方

### 2. UI跟隨測試
1. 在覆蓋模式下(F4已激活)
2. 控制P1角色移動(WASD或方向鍵)
3. 確認UI覆蓋始終跟隨角色移動
4. 驗證UI位置始終在角色上方40像素處

### 3. 多層覆蓋協同測試
1. F4激活 → 三層覆蓋同時顯示
2. 觸發P1強化狀態 → 角色皮膚切換為金色光環版，UI保持不變
3. F4關閉 → 所有覆蓋層同時隱藏

### 4. 層級順序驗證
確認顯示層級正確：
```
🔝 UI覆蓋 (depth=20) - MG_1P_Player_all.png
   角色皮膚 (depth=15) - Goku_1.png/Goku_2.png  
   角色本體 (depth=10) - P1角色
   背景 (depth=1) - Scene.png
🔽 原場景元素 (depth < 1)
```

## 🔍 技術細節

### 資源載入
- `character-ui-overlay`: MG_1P_Player_all.png (17KB)
- 與現有皮膚系統並行載入

### 位置計算
```typescript
// UI覆蓋定位在角色上方40像素
this.characterUIOverlay.setPosition(this.player.x, this.player.y - 40);
```

### 深度管理
- UI覆蓋：depth=20 (最上層)
- 角色皮膚：depth=15
- 角色本體：depth=10  
- 背景：depth=1/-10

### Console訊息
測試時觀察Browser Console訊息：
```
🎮 角色UI覆蓋已創建：1P UI在位置(x, y) (depth=20, hidden)
🎮 1P UI覆蓋已顯示
🎮 1P UI覆蓋已隱藏
```

## ⚠️ 潛在問題排除

如果UI覆蓋不顯示：
1. 確認F4已激活覆蓋模式
2. 檢查MG_1P_Player_all.png是否存在於/public/assets/
3. 檢查Console是否有資源載入錯誤
4. 確認UI深度層級沒有被其他元素覆蓋

## 🎉 預期效果

成功時，用戶將看到：
- F4切換觸發完整三層覆蓋系統 ✅
- UI元素始終顯示在角色上方 ✅  
- 所有覆蓋層協同工作，無衝突 ✅
- 角色移動時UI完美跟隨 ✅
- 強化狀態下皮膚切換，UI保持穩定 ✅

## 🚀 系統整合

現在F4功能提供完整的視覺覆蓋體驗：
1. **背景替換**：Scene.png火焰山場景
2. **角色裝飾**：Goku皮膚(普通/強化自動切換)  
3. **UI增強**：1P玩家信息顯示

這三層系統協同工作，為用戶提供豐富的自定義視覺體驗！
