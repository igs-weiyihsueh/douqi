# UI覆蓋替換修復測試指南

## 🔧 修復內容

**問題描述**：
F4激活時，原本的P1頭上UI（黃色"1P 61000"）和新的UI覆蓋（藍色"1P 999"）同時顯示，造成UI重複。

**修復方案**：
讓新UI覆蓋完全替換原UI，實現互斥顯示邏輯。

## ✅ 修復前後對比

### 修復前 (問題狀態)
```
F4激活時：
🔴 原P1 UI: 顯示 (黃色 "1P 61000")
🔴 新UI覆蓋: 顯示 (藍色 "1P 999") 
❌ 結果：兩個UI同時存在，視覺重複
```

### 修復後 (預期狀態)  
```
F4激活時：
🚫 原P1 UI: 隱藏
✅ 新UI覆蓋: 顯示 (藍色 "1P 999")
✅ 結果：只顯示新UI，替換原UI

F4關閉時：
✅ 原P1 UI: 顯示 (黃色 "1P 61000") 
🚫 新UI覆蓋: 隱藏
✅ 結果：恢復原UI顯示
```

## 🧪 測試步驟

### 1. 基本UI替換測試
1. 啟動遊戲進入GameScene
2. 觀察P1角色頭上的原UI（黃色"1P"和積分）
3. 按**F4**鍵激活覆蓋模式
4. ✅ **驗證**：原UI應該消失，只顯示藍色的新UI覆蓋

### 2. UI恢復測試
1. 在F4激活狀態下（只顯示新UI）
2. 再次按**F4**關閉覆蓋模式  
3. ✅ **驗證**：新UI消失，黃色原UI重新出現

### 3. 完整循環測試
1. F4激活 → 原UI隱藏，新UI顯示
2. F4關閉 → 新UI隱藏，原UI恢復
3. 重複多次F4切換
4. ✅ **驗證**：每次切換都只顯示一套UI，無重複

### 4. Console訊息驗證
觀察瀏覽器Console輸出：
```
F4激活時：
👑 P1頭上UI已隱藏
🎮 1P UI覆蓋已顯示

F4關閉時：  
🎮 1P UI覆蓋已隱藏
👑 P1頭上UI已顯示
```

## 🔍 技術實現

### UIScene新增方法
```typescript
setP1OverheadUIVisible(visible: boolean): void {
  const p1Container = this.overheadUIs.get(0); // P1索引為0
  if (p1Container) {
    p1Container.setVisible(visible);
  }
}
```

### GameScene整合邏輯
```typescript
// F4激活 - 隱藏原UI，顯示新UI
const uiScene = this.scene.get('UIScene') as any;
if (uiScene && uiScene.setP1OverheadUIVisible) {
  uiScene.setP1OverheadUIVisible(false); // 隱藏原UI
}

// F4關閉 - 顯示原UI，隱藏新UI  
uiScene.setP1OverheadUIVisible(true); // 恢復原UI
```

## ⚠️ 常見問題排除

**如果原UI沒有隱藏**：
1. 檢查Console是否有錯誤訊息
2. 確認UIScene已正確載入且運行中
3. 驗證P1角色已創建並有對應的overheadUI

**如果切換不流暢**：
1. 確認F4按鍵沒有重複觸發
2. 檢查場景引用是否正確獲取

## 🎯 預期成果

修復成功後，F4功能將提供：
- **視覺清潔**：同一時間只顯示一套UI，無重複干擾
- **完美替換**：新UI真正"覆蓋"並替換原UI
- **流暢切換**：F4可在兩套UI間無縫切換
- **狀態同步**：UI狀態與F4開關狀態完美同步

這解決了UI重複顯示的問題，實現真正的UI"覆蓋"效果！✨
