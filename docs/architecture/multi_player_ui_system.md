# 多角色UI替換系統架構說明

## 系統概述
擴展了原本的1P底部面板替換系統，現在支持1P、2P、3P、4P四個角色的同時UI替換。

## 架構設計

### 1. 資源載入系統 (BootScene)
```typescript
// 多角色底部面板UI資源載入
this.load.image('bottom-panel-1P', 'assets/1P.png');  // P1底部面板UI
this.load.image('bottom-panel-2P', 'assets/2P.png');  // P2底部面板UI  
this.load.image('bottom-panel-3P', 'assets/3P.png');  // P3底部面板UI
this.load.image('bottom-panel-4P', 'assets/4P.png');  // P4底部面板UI
```

### 2. 多角色覆蓋UI系統 (UIScene)
```typescript
// 多角色底部面板替換系統
private bottomPanelOverlays: Array<Phaser.GameObjects.Image | null> = [null, null, null, null]; // [1P, 2P, 3P, 4P]
private isBottomPanelOverlayMode = false;
```

### 3. 精確位置計算
每個角色的覆蓋UI都精確對準對應的原始面板位置：
```typescript
// 角色面板位置計算
const playerPanelX = startX + i * (panelW + panelGap);  // i=0,1,2,3
const playerCenterX = playerPanelX + panelW / 2;        // 中心X座標
const playerCenterY = rowTopY + panelH / 2;             // 中心Y座標
```

### 4. 深度層級管理
```typescript
.setDepth(1000 + i)  // 1P:1000, 2P:1001, 3P:1002, 4P:1003
```
確保每個角色的覆蓋UI都在對應原始面板之上，且不互相衝突。

## 功能特性

### 🎯 精確定位
- 每個角色的覆蓋UI精確對準原始面板中心點
- 使用與原始面板相同的佈局計算邏輯
- 支持不同解析度的自動調整

### 🎨 原始尺寸保持
- 所有角色覆蓋UI都保持324x166原始尺寸
- 無壓縮變形，最佳視覺效果
- 假設所有角色UI使用相同的設計尺寸

### 🔄 統一F4控制
```typescript
setBottomPanelOverlay(useOverlay: boolean)
```
- F4激活：同時顯示所有可用的角色覆蓋UI，隱藏原始面板
- F4關閉：隱藏所有覆蓋UI，恢復所有原始面板
- 智能錯誤處理：缺失圖片時保持原始面板顯示

### 🛡️ 錯誤處理
- 資源不存在時自動跳過，不影響其他角色
- 詳細的控制台日誌，方便調試
- 優雅的降級處理

## 檔案對應關係

### 期望的資源文件
```
public/assets/
├── 1P.png  ✅ 已存在 (324x166, 63KB)
├── 2P.png  🟡 待提供
├── 3P.png  🟡 待提供 
└── 4P.png  🟡 待提供
```

### 角色面板位置 (1920x1080)
```
1P: 位置(642, 1030)   - 左下角第1個
2P: 位置(854, 1030)   - 左下角第2個  
3P: 位置(1066, 1030)  - 左下角第3個
4P: 位置(1278, 1030)  - 左下角第4個
```

## 控制流程

### F4激活流程
```
用戶按F4 → GameScene.controlBottomPanelOverlay(true) → UIScene.setBottomPanelOverlay(true)
    ↓
遍歷所有角色 (i=0,1,2,3)
    ↓
檢查bottomPanelOverlays[i]是否存在 → 顯示覆蓋UI → 隱藏原始面板rows[i]
```

### F4關閉流程
```
用戶按F4 → GameScene.controlBottomPanelOverlay(false) → UIScene.setBottomPanelOverlay(false)
    ↓
遍歷所有角色 (i=0,1,2,3)
    ↓
隱藏覆蓋UI bottomPanelOverlays[i] → 恢復原始面板rows[i]
```

## 實施狀態

### ✅ 已完成
- [x] 多角色資源載入邏輯
- [x] 多角色覆蓋UI創建系統  
- [x] 精確的位置計算（所有角色）
- [x] F4統一控制邏輯
- [x] 錯誤處理和日誌系統
- [x] 構建測試通過

### 🟡 等待資源
- [ ] 用戶提供2P.png、3P.png、4P.png文件
- [ ] 複製資源到assets目錄
- [ ] 完整功能測試

## 使用方式

### 1. 提供圖片文件
將2P.png、3P.png、4P.png放入 `public/assets/` 目錄

### 2. 測試功能
- 載入遊戲
- 按F4激活多角色UI替換
- 確認所有角色面板同時被覆蓋UI替換
- 按F4關閉確認恢復正常

系統已準備就緒，等待圖片資源即可完整啟用！
