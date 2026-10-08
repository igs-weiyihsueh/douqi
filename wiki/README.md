# 鬥氣割草 (Douqi Cutgrass) WIKI

> H5遊戲開發團隊知識庫 - 讓新AI快速理解整個專案

## 📚 文檔架構

### 🔧 [Systems](./systems/) - 技術系統文檔
- [專案概覽](./systems/project-overview.md) - 專案基本資訊與團隊結構
- [戰鬥系統技術文檔](./systems/combat-system.md) - 多角色系統、敵人AI、波次控制、技能系統
- [UI系統實作細節](./systems/ui-implementation.md) - COMBO獎勵UI、角色狀態面板、頭上UI系統
- [效能和配置管理](./systems/performance-config.md) - GameConfig架構、效能優化、建構部署

### 📋 [Conventions](./conventions/) - 開發規範流程
- [H5程式碼規範](./conventions/h5-coding-standards.md) - TypeScript + Phaser開發規範

### 🎯 [Decisions](./decisions/) - 架構決策記錄
- [團隊結構決策](./decisions/team-structure.md) - 3C團隊分工與協作流程
- [技術選擇和原因](./decisions/technical-choices.md) - Phaser 3.80.1、TypeScript 5.4、Vite 5.2技術棧選擇理由

### 🏗️ [Architecture](./architecture/) - 系統架構分析
- [遊戲引擎架構](./architecture/game-engine.md) - Phaser 3.80.1技術棧、Scene系統、物件管理
- [資料流程與系統關係](./architecture/data-flow.md) - 遊戲狀態管理、物理系統、敵人AI架構
- [Phaser + TypeScript技術架構](./architecture/phaser-typescript.md) - 專案配置、模組化設計、效能最佳化

### 🎮 [Design](./design/) - 功能設計演進
- [遊戲功能設計演進](./design/gameplay-evolution.md) - 核心玩法、角色成長、敵人系統、小遊戲框架設計
- [UI/UX設計決策](./design/ui-ux-decisions.md) - 視覺設計原則、HUD系統、COMBO獎勵UI、調參系統
- [小遊戲系統設計](./design/minigame-system.md) - 可擴充框架、1P+3BOT模式、四個小遊戲機制設計

### 📖 [Guides](./guides/) - 操作指南
- [開發環境設定](./guides/development-setup.md) - 環境配置與開發流程

### 🔬 [Technical Reserves](./technical-reserves/) - 技術儲備
- [bodySeparation系統改進方案](./technical-reserves/body-separation-improvement.md) - 基於Miraculous技術的推擠系統優化

### 📚 [術語表](./glossary.md) - 專案術語對照
統一專案核心概念和程式碼對照，便於開發團隊和AI理解專案架構

### 📅 [Plans](./plans/) - 整合計劃
專案規劃、版本計劃、未來發展方向

## 🎯 使用目標

**讓未來的AI能夠：**
- 快速理解專案整體架構
- 掌握開發規範和最佳實踐
- 了解歷史決策和演進過程
- 獨立接手開發工作

## 🤖 維護原則

- **與代碼同步**：重要變更同步更新文檔
- **AI友善格式**：使用標準markdown，便於AI讀取
- **版本控制**：與專案代碼一起進行Git版控
- **持續更新**：保持文檔的準確性和時效性

---
*最後更新：2026-10-07*  
*維護者：3C團隊 (異靈、翼騎、征騎、銳騎)*
