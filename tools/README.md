# 鬥氣割草編輯器套件

## 📖 概覽

這個目錄包含從 SpinningTop 專案移植過來的編輯器工具，用於提升鬥氣割草遊戲的內容創作效率。

## 🛠️ 編輯器列表

### ✅ 已移植
- 🎬 **scene-editor** - 場景編輯器：3D 環境布置、物件擺放、場景設計
- 🗺️ **level-editor** - 關卡編輯器：關卡邏輯、生成點配置、遊戲規則設定

### 🔄 計劃中
- 🖼️ **ui-editor** - UI 編輯器：界面布局設計
- 🎭 **animation-editor** - 動畫編輯器：角色動畫製作  
- ✨ **vfx-editor** - 特效編輯器：粒子效果製作
- 🧩 **prefab-editor** - Prefab 編輯器：預製件管理

## 🚀 快速開始

### 場景編輯器
```bash
cd tools/scene-editor
npm install
# ⚠️ 注意：請使用 npm run build 而非 npm run dev
# npm run dev 會啟動持續運行的開發服務器，導致 AgEnD 實例卡住
npm run build
```

### 關卡編輯器  
```bash
cd tools/level-editor
npm install
# ⚠️ 注意：請使用 npm run build 而非 npm run dev
# npm run dev 會啟動持續運行的開發服務器，導致 AgEnD 實例卡住
npm run build
```

## 🏗️ 技術架構

### 共用技術棧
- **TypeScript 5.4+** - 類型安全
- **Vite 5.2+** - 建置工具
- **Three.js 0.182** - 3D 渲染引擎

### 目錄結構
```
tools/
├── shared/              # 共用工具和類型定義
│   ├── types/          # TypeScript 類型
│   ├── utils/          # 工具函數
│   └── assets/         # 共用資源
├── scene-editor/       # 場景編輯器
├── level-editor/       # 關卡編輯器
└── README.md           # 本文件
```

## 📋 移植進度

- [x] 專案架構規劃
- [x] 目錄結構建立
- [ ] 場景編輯器移植
- [ ] 關卡編輯器移植
- [ ] 整合測試
- [ ] 文檔完善

## 👥 負責人員

- **異靈** - 統籌規劃、架構設計
- **翼騎** - 技術移植實施
- **征騎** - 測試和調試

## 📝 移植注意事項

### 依賴管理
- 使用獨立的 package.json 管理各編輯器依賴
- 共用依賴放在 shared/ 目錄

### 路徑調整
- 所有相對路徑需要重新配置
- 資源路徑統一使用 shared/assets/

### 功能適配
- 3D 編輯器功能適配 2D 遊戲需求
- 保留原有功能的同時增加 2D 專用配置

## 🔗 相關鏈接

- [SpinningTop 原始專案](../../../變身大亂鬥/SpinningTopTest/)
- [鬥氣割草主專案](../)
- [移植可行性評估報告](./MIGRATION_ASSESSMENT.md)

---

*最後更新：2026-09-24*
*版本：v1.0.0*
