# 小遊戲生命週期分析報告

## 🔍 三個小遊戲的生命週期模式分析

### 1. CollectRaceScene (收集競賽)
```typescript
// 生命週期階段
phase: 'intro' | 'playing' | 'ended' = 'intro'
running: boolean = false

// 創建 → 立即顯示說明
create() {
  // 初始化所有系統
  this.phase = 'intro'
  this.running = false
  this.showIntro() // 立即顯示說明浮層
}

// 顯示說明浮層，等待用戶開始
showIntro() {
  // 創建說明浮層
  // 按空格或點擊開始
}

// 開始遊戲
startPlaying() {
  if (this.phase !== 'intro') return
  this.phase = 'playing'
  // 清除說明浮層
  this.running = true
  // 設置結束時間
}

// 更新循環
update() {
  if (!this.running) return // 關鍵：running控制更新
  // 檢查時間結束
  if (remainMs <= 0 && !this.finishing) {
    this.beginFinish()
    return
  }
  // 遊戲邏輯
}

// 結束流程
beginFinish() {
  this.finishing = true
  this.running = false // 停止遊戲更新
  // 顯示聚光燈效果
  // 延遲後調用endGame()
}

endGame() {
  this.phase = 'ended' // 設置結束狀態
  // 顯示結果UI和按鈕
}
```

### 2. BombArenaScene (炸彈人對戰)
```typescript
// 生命週期階段
phase: 'intro' | 'ready' | 'playing' | 'ended' = 'intro'
running: boolean = false

create() {
  this.phase = 'intro'
  this.running = false
  this.showIntro()
}

showIntro() {
  // 顯示說明
  // 按空格進入ready階段
}

startReady() {
  if (this.phase !== 'intro') return
  this.phase = 'ready'
  this.running = false // ready期間不運行遊戲邏輯
  // 顯示倒數3-2-1-開始
  // 倒數完成後調用startPlaying()
}

startPlaying() {
  if (this.phase !== 'ready' && this.phase !== 'intro') return
  this.phase = 'playing'
  this.running = true
  // 設置結束時間
}

update() {
  if (!this.running) return
  // 遊戲邏輯
}
```

### 3. PushSurvivalScene (推人生存)
類似模式，有intro → playing → ended的清晰流程

## 🚨 桃樹彩票的問題

### 當前問題分析
1. **缺少intro階段**: 直接進入playing，沒有說明畫面
2. **沒有running標誌**: 沒有用running控制遊戲邏輯的開始/停止
3. **結束流程混亂**: revealing階段處理不當，沒有正確過渡到ended
4. **缺少endGame方法**: 沒有統一的結束處理

### 標準生命週期應該是：
```
create() → showIntro() → (用戶按空格) → startPlaying() → (遊戲進行) → beginFinish() → endGame()
```

### 修復策略：
1. 添加intro階段和說明浮層
2. 添加running標誌控制遊戲邏輯
3. 修正revealing到ended的轉換
4. 統一結束處理邏輯
