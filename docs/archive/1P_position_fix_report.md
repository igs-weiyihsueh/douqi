# 1P.png底部面板覆蓋位置修正報告

## 問題描述
用戶測試F4切換功能後發現1P.png底部面板覆蓋出現在畫面中央偏左位置，而不是在P1原始面板的正確位置上。

## 根本原因
原始代碼使用簡單的畫面中心底部定位 `(w/2, h-50)`，但P1面板實際位置是通過複雜的佈局計算得出的。

## 修正措施

### 1. 精確位置計算
```typescript
// 復制原始面板的位置計算邏輯
const count = GameConfig.characters.count;    // 4個角色
const panelW = 200;                           // 面板寬度 
const panelH = 60;                            // 面板高度
const panelGap = 12;                          // 角色間距
const startX = (w - (count * panelW + (count - 1) * panelGap)) / 2; // 居中排列
const rowTopY = h - 80;                       // 底部Y座標

// P1面板中心位置 (第0個角色)
const p1CenterX = startX + panelW / 2;        // X: 542 + 100 = 642
const p1CenterY = rowTopY + panelH / 2;       // Y: 1000 + 30 = 1030
```

### 2. 尺寸匹配
添加 `.setDisplaySize(panelW, panelH)` 確保覆蓋圖片調整為200x60像素，與原始面板完全匹配。

### 3. 調試增強
添加詳細的位置計算日誌，方便後續調試和驗證。

## 修正結果
- ✅ **精確定位**: 1P.png現在會精確出現在P1原始面板位置
- ✅ **尺寸匹配**: 覆蓋圖片自動調整為原始面板尺寸
- ✅ **層級正確**: depth=1000確保在原始面板上方顯示

## 測試驗證
1. 按F4激活覆蓋模式
2. 確認1P.png出現在左下角P1面板位置
3. 確認覆蓋圖片完全遮蓋原始面板
4. 按F4關閉確認正常恢復

修正已提交並推送到deploy-refactor分支。
