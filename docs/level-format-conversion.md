# 編輯器格式自動轉換系統

## 概述

LevelManager 現已支援自動檢測和轉換編輯器的簡化格式為完整的遊戲格式，無需修改編輯器匯出邏輯。

## 支援的格式

### 1. 編輯器簡化格式
```json
{
  "name": "編輯器關卡",
  "version": "1.0", 
  "entities": [
    {
      "type": "wooden_box",
      "position": [2, 0, -1],
      "color": 9127187,
      "id": "entity_1"
    }
  ]
}
```

### 2. 完整遊戲格式
```json
{
  "_format": "douqi-level",
  "_version": "1.0.0",
  "metadata": { "name": "...", "description": "..." },
  "level": { "id": "...", "timeLimit": 180 },
  "gameplay": { "playerStartPosition": [0, 0.5, 0] },
  "entities": [...],
  "events": [...],
  "config": {...}
}
```

## 格式檢測邏輯

系統使用以下邏輯自動識別格式：

1. **編輯器格式檢測**：
   - 沒有 `_format` 欄位
   - 有 `name`、`version`、`entities` 欄位
   - 實體包含 `color` 欄位且類型為數字
   - 實體類型為 `wooden_box`、`bomb`、`stone` 之一

2. **完整格式檢測**：
   - 有 `_format: "douqi-level"` 欄位
   - 包含所有必需的遊戲格式欄位

## 類型映射

| 編輯器類型 | 遊戲類型 | 說明 |
|-----------|---------|------|
| `wooden_box` | `obstacle` | 可破壞障礙物 |
| `bomb` | `powerup` | 爆炸類強化道具 |
| `stone` | `obstacle` | 不可破壞障礙物 |

## 屬性生成

### 木箱 (wooden_box → obstacle)
```json
{
  "health": 100,
  "destructible": true,
  "blockMovement": true,
  "material": "wood",
  "dropItems": ["coin"],
  "dropChance": 0.3
}
```

### 炸彈 (bomb → powerup)  
```json
{
  "effectType": "explosive",
  "explosionRadius": 100,
  "explosionDamage": 50,
  "duration": 0,
  "value": 0,
  "autoTrigger": true,
  "triggerDelay": 1.0
}
```

### 石頭 (stone → obstacle)
```json
{
  "health": 200,
  "destructible": false,
  "blockMovement": true,
  "material": "stone",
  "resistance": "physical"
}
```

## 自動生成的遊戲設定

### 關卡設定
- **時間限制**: 180秒 (3分鐘)
- **目標分數**: 1000分
- **難度**: normal
- **玩家起始位置**: 中心點 (0, 0.5, 0)

### 遊戲目標
1. **收集目標**: 收集所有道具 (炸彈轉換的強化道具)
2. **存活目標**: 存活到時間結束

### 環境設定
- **背景音樂**: default_battle.ogg
- **環境音效**: wind.ogg
- **天氣**: 晴朗 (clear)
- **光照**: 正午 (noon)

## 使用方法

```typescript
// 載入編輯器格式關卡
const levelManager = new LevelManager(scene);
await levelManager.initCustomLevel(editorLevelData);

// 系統會自動檢測格式並轉換
// 無需手動處理格式差異
```

## 錯誤處理

- **不支援的格式**: 拋出 "不支援的關卡格式" 錯誤
- **格式檢測失敗**: 記錄詳細的檢測資訊
- **轉換錯誤**: 記錄原始資料和錯誤詳情

## 向後相容性

- 完全支援現有的完整遊戲格式
- 編輯器格式僅作為補充，不影響原有功能
- 所有現有關卡檔案無需修改

## 日誌輸出

系統會輸出詳細的格式檢測和轉換日誌：

```
[LevelManager] 檢測到編輯器簡化格式，開始轉換...
[LevelManager] 轉換編輯器格式: 3 個實體
[LevelManager] 自定義關卡載入完成: 編輯器關卡
```
