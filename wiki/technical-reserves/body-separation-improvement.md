# bodySeparation系統改進方案

## 📚 **技術文檔歸檔**

**技術來源**: Miraculous ContactSolver系統  
**發現者**: 問騎-t1557566154871013417  
**整合分析**: 翼騎基於現有系統分析  
**歸檔日期**: 2026-10-08  
**狀態**: 隨時可實施的改進方案  

## 🎯 **背景**

基於問騎發現的Miraculous ContactSolver技術，結合翼騎分析的現有bodySeparation系統，制定最小風險的技術改進路徑。

### **現有系統問題**
- 等量推擠處理：tank與normal同等對待，缺乏真實感
- 微小重疊過度反應：任何重疊都觸發推擠，造成視覺抖動
- 100%修正可能過度：容易產生振盪效果

## 💡 **三大改進點**

### **1. 質量加權推移**
- **現狀**: 等量推擠 (tank與normal同等對待)
- **改進**: 按質量比例分配推移 (tank承受較少推移)
- **效果**: 增強真實感，重型敵人更穩定

### **2. 接觸容差機制** 
- **現狀**: 任何重疊都觸發推擠
- **改進**: 1-2px容差內不處理
- **效果**: 減少微小抖動，提升視覺穩定性

### **3. 鬆弛係數優化**
- **現狀**: 100%修正可能過度反應
- **改進**: 每次修正50-80%重疊量
- **效果**: 防止振盪，平滑推擠效果

## 🔧 **實作方案**

### **Phase 1: 參數化改進** (風險最低)
```javascript
const separationConfig = {
    massWeighting: true,     // 啟用質量加權
    contactSlop: 1.5,        // 接觸容差(px)  
    relaxation: 0.6,         // 鬆弛係數
    unitMass: {              // 單位質量表
        normal: 1.0,
        tank: 3.0,
        boss: 5.0
    }
};
```

### **Phase 2: 功能驗證**
- tank vs normal推擠測試
- 視覺抖動改善評估
- 手感調優

### **Phase 3: 配置調優**
- 用戶可調參數
- 不同場景預設值

## 📊 **技術優勢**

- **向後兼容**: 保持現有API不變
- **漸進升級**: 可分階段實施
- **配置靈活**: 支援不同遊戲手感需求
- **性能友善**: 基於現有架構優化，不重寫

## 🎯 **觸發條件**

- 用戶反饋敵人推擠不夠真實
- 需要改善視覺抖動問題
- 有餘力進行polish改進
- UI間距系統需要升級時

## 📁 **相關資料**

- **原始技術來源**: Miraculous ContactSolver系統
- **現有系統**: `douqi/bodySeparation.ts`
- **技術發現者**: 問騎-t1557566154871013417
- **分析整合**: 翼騎基於現有系統架構

## 🔬 **技術實作細節**

### **質量加權推移算法**
```javascript
function applyMassWeightedSeparation(objA, objB, overlap) {
    const massA = getMass(objA.type);
    const massB = getMass(objB.type);
    const totalMass = massA + massB;
    
    const ratioA = massB / totalMass;  // A承受的比例
    const ratioB = massA / totalMass;  // B承受的比例
    
    objA.x += overlap.x * ratioA * config.relaxation;
    objB.x -= overlap.x * ratioB * config.relaxation;
}
```

### **接觸容差檢測**
```javascript
function shouldSeparate(overlap) {
    const overlapMagnitude = Math.sqrt(overlap.x * overlap.x + overlap.y * overlap.y);
    return overlapMagnitude > config.contactSlop;
}
```

### **鬆弛係數應用**
```javascript
function applyRelaxation(correctionVector) {
    return {
        x: correctionVector.x * config.relaxation,
        y: correctionVector.y * config.relaxation
    };
}
```

## ⚡ **性能考量**

- 質量查詢：預計算質量表，O(1)查詢
- 容差檢測：簡單數值比較，微小開銷
- 鬆弛計算：標量乘法，可忽略影響

## 🧪 **測試策略**

### **單元測試**
- 質量加權正確性驗證
- 容差邊界值測試
- 鬆弛係數效果驗證

### **整合測試**
- tank vs normal推擠行為
- 大量敵人聚集穩定性
- 性能基準測試

### **使用者測試**
- 視覺抖動改善評估
- 推擠真實感反饋
- 不同配置偏好調查

## 📈 **預期效果**

1. **視覺改善**: 減少微小抖動，更穩定的敵人互動
2. **真實感提升**: 重型敵人表現更符合直覺
3. **系統穩定**: 防止振盪，平滑的推擠效果
4. **配置彈性**: 支援不同遊戲風格需求

---

**歸檔狀態**: ✅ 技術儲備就緒  
**實施優先級**: 中等 (polish改進)  
**風險等級**: 低 (向後兼容，漸進升級)  
**資源需求**: 1-2週開發+測試時間
