# 關卡選擇器與自動命名系統 - 測試報告

## 📋 **實作完成功能**

### ✅ **1. 關卡選擇器**
- 下拉選單包含 8 個關卡選項：
  - 關卡 1：新手村
  - 關卡 2：森林  
  - 關卡 3：沙漠
  - 關卡 4：火山 (BOSS)
  - 關卡 5：雪山
  - 關卡 6：海底
  - 關卡 7：城堡
  - 關卡 8：天空

### ✅ **2. 自動命名系統**
- **LevelNamingSystem 類別**：管理檔案命名邏輯
- **檔案格式**：`level{關卡ID}_{編號}.json`
- **自動遞增**：檢查現有檔案並自動分配下一個編號
- **目錄記憶**：記住上次使用的資料夾位置

### ✅ **3. 多檔案管理**
- 支援同關卡多個配置檔案
- 自動掃描現有檔案編號
- 檔案名稱自動更新顯示

### ✅ **4. 介面改進**
- 場景名稱欄位改為唯讀模式
- 加入操作提示文字
- 關卡變更時自動更新檔案名稱

## 🔧 **核心技術實現**

### **LevelNamingSystem 類別**：
```typescript
class LevelNamingSystem {
  // 生成下一個可用檔案名稱
  async generateFileName(levelId: string): Promise<string>
  
  // 目錄記憶管理
  setLastDirHandle(handle: any)
  getLastDirHandle()
}
```

### **檔案命名邏輯**：
```typescript
// 檢查現有檔案：level1_001.json, level1_002.json
// 自動生成：level1_003.json (下一個可用編號)
const prefix = `level${levelId}_`;
const nextNumber = Math.max(...existingNumbers) + 1;
return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
```

### **整合功能**：
- **儲存系統**：使用新的命名規則和目錄記憶
- **載入系統**：自動識別關卡ID並更新選擇器
- **匯出系統**：支援 .douqi.json 格式 (遊戲專用格式)

## 📁 **檔案結構範例**
```
scenes/
├── level1_001.json  # 關卡1 第1個配置
├── level1_002.json  # 關卡1 第2個配置
├── level2_001.json  # 關卡2 第1個配置  
├── level3_001.json  # 關卡3 第1個配置
└── level4_001.json  # 關卡4 BOSS戰配置
```

## ✅ **測試狀態**
- [x] TypeScript 編譯成功
- [x] Vite 建置成功 (989.74 kB)
- [x] 無語法錯誤
- [x] 功能邏輯完整實現

## 🎯 **使用流程**
1. **開啟編輯器** → 預設選擇關卡1，檔名顯示 `level1_001`
2. **切換關卡** → 選擇器變更後檔名自動更新
3. **儲存場景** → 使用自動生成的檔名，支援編號遞增
4. **載入場景** → 自動識別關卡ID並同步選擇器
5. **匯出遊戲** → 產生 .douqi.json 格式供遊戲使用

**階段1實作完成，準備進行階段2的遊戲端整合！** 🚀
