# 鬥氣割草 編輯器套件

> 🎮 **鬥氣割草** H5 遊戲的完整編輯器工具套件，包含場景編輯器和關卡編輯器。

## 📋 套件概述

### 🏗️ 場景編輯器 (Scene Editor)
- **功能**：3D場景設計、物件擺放、材質設定、光照配置
- **輸出格式**：`.douqi.json` 場景檔案
- **位置**：`tools/scene-editor/`
- **建置產物**：968KB JS + 54KB HTML

### 🎯 關卡編輯器 (Level Editor)  
- **功能**：關卡邏輯設計、敵人配置、事件觸發、遊戲目標設定
- **輸出格式**：`.json` 關卡配置檔案
- **位置**：`tools/level-editor/`
- **建置產物**：548KB JS + 9.21KB HTML

## 🚀 快速開始

### 系統需求
- Node.js 16+
- npm 8+
- 支援 ES2020 的現代瀏覽器

### 安裝步驟

1. **複製專案**
```bash
git clone <repository-url>
cd douqi
```

2. **場景編輯器安裝**
```bash
cd tools/scene-editor
npm install
npm run build
```

3. **關卡編輯器安裝**
```bash
cd ../level-editor
npm install 
npm run build
```

### 建置所有編輯器
```bash
# 在專案根目錄執行
cd tools/scene-editor && npm run build
cd ../level-editor && npm run build
cd ../..
```

## 📁 目錄結構

```
douqi/
├── tools/                          # 編輯器工具
│   ├── scene-editor/               # 場景編輯器
│   │   ├── dist/                   # 建置輸出
│   │   ├── src/                    # 原始碼
│   │   ├── package.json            # 依賴配置
│   │   └── vite.config.ts          # 建置配置
│   ├── level-editor/               # 關卡編輯器
│   │   ├── dist/                   # 建置輸出
│   │   ├── editor.ts               # 主程式
│   │   ├── package.json            # 依賴配置
│   │   └── vite.config.ts          # 建置配置
│   ├── shared/                     # 共用工具
│   └── docs/                       # 使用文檔
├── public/                         # 遊戲資源
│   ├── scenes/                     # 場景檔案 (.douqi.json)
│   └── assets/data/levels/         # 關卡檔案 (.json)
├── src/                            # 遊戲主程式
└── README.md                       # 專案說明
```

## 🔄 工作流程

### 1. 場景設計
使用**場景編輯器**設計 3D 環境：
- 擺放地形和建築物件
- 設定材質和貼圖
- 配置光照和特效
- 匯出 `.douqi.json` 檔案

### 2. 關卡配置
使用**關卡編輯器**設計遊戲邏輯：
- 引用場景檔案作為基礎
- 配置敵人和道具
- 設定遊戲目標和事件
- 匯出關卡配置檔案

### 3. 整合測試
- 驗證場景和關卡檔案格式
- 測試遊戲載入和執行
- 調整參數和優化效能

## 📄 詳細文檔

- [🏗️ 場景編輯器指南](SCENE_EDITOR.md)
- [🎯 關卡編輯器指南](LEVEL_EDITOR.md)
- [🔄 協作工作流程](WORKFLOW.md)
- [📝 檔案格式規範](FILE_FORMAT.md)

## ⚠️ 開發注意事項

### 安全規範
- **禁止執行**：`npm run dev`、`vite`、`npm start` 等持續運行命令
- **建置命令**：只使用 `npm run build`、`npm test` 等一次性命令
- **原因**：持續運行命令會佔用開發環境，導致系統無回應

### 檔案格式
- **場景檔案**：`.douqi.json` 格式，存放於 `public/scenes/`
- **關卡檔案**：`.json` 格式，存放於 `public/assets/data/levels/`
- **編碼**：統一使用 UTF-8

### 版本控制
- 編輯器原始碼納入版本控制
- 建置產物 (`dist/`) 可選擇忽略
- 測試檔案建議納入版本控制作為範例

## 🛠️ 技術細節

### 技術棧
- **前端框架**：Phaser 3 + TypeScript
- **3D 引擎**：Three.js ^0.182.0
- **建置工具**：Vite ^5.4.0
- **型別系統**：TypeScript ^5.4.0

### 相依性
```json
{
  "three": "^0.182.0",
  "three.quarks": "^0.17.1",
  "@types/three": "^0.182.0",
  "typescript": "^5.4.0", 
  "vite": "^5.4.0"
}
```

## 📞 支援與貢獻

### 問題回報
遇到問題請提供：
- 編輯器版本和瀏覽器資訊
- 詳細錯誤訊息和步驟
- 相關的檔案和配置

### 開發貢獻
- 遵循 TypeScript 嚴格模式
- 使用統一的程式碼風格
- 新增功能需附帶測試和文檔

---

**🎯 鬥氣割草編輯器套件 - 讓遊戲設計更簡單、更高效！**

*建立於 2026-09-24 | 版本 1.0.0*
