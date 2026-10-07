# UI系統實作細節

## UI架構分層

### Scene分離設計 (66e51cb更新)
```typescript
// GameScene + UIScene 並行架構
class GameScene {
  create() {
    // 啟動UI覆蓋層
    this.scene.launch('UIScene');
    this.scene.bringToTop('UIScene');
    
    // 跨Scene通訊
    const uiScene = this.scene.get('UIScene') as UIScene;
    uiScene.updateStats(this.getStatsPayload());
  }
  
  // 重開狀態重置 (66e51cb)
  resetState() {
    this.useSkeletonWarrior = false;  // 重置敵人外觀預設值
    // ...其他狀態重置
  }
}

// UIScene - 專職HUD管理
class UIScene extends Phaser.Scene {
  create() {
    // 66e51cb: 修正重開後頭頂UI狀態同步問題
    this.isP1HeadUIHidden = false;  // 重置P1頭頂UI顯示狀態
    
    // ...其他初始化
  }
  
  // 統計資料接口
  updateStats(payload: StatsPayload): void {
    this.updateCharacterPanels(payload.chars);
    this.updateTeamStats(payload);
  }
}
```

### 角色狀態介面
```typescript
// 角色統計資料結構
interface CharStat {
  label: string;              // 角色標籤 (P1/P2/P3/P4)
  color: number;              // 代表顏色
  hp: number;                 // 當前血量
  maxHp: number;              // 最大血量
  spirit: number;             // 連段/能量
  maxSpirit: number;          // 連段上限
  kills: number;              // 擊殺數
  alive: boolean;             // 存活狀態
  isPlayer: boolean;          // 玩家標記
  
  // 世界座標 (頭上UI用)
  x: number; y: number;
  
  // 階段二：貨幣系統
  credit: number;
  
  // 階段三：COMBO系統
  combo: ComboState;
}
```

## COMBO獎勵UI系統

### COMBO狀態追蹤
```typescript
// COMBO系統狀態
interface ComboState {
  currentStreak: number;      // 當前連擊數
  lastKillTime: number;       // 上次擊殺時間戳
  ticketsEarned: number;      // 本局獲得票券總數
  isWarning: boolean;         // 警告狀態 (1.5-2秒間)
  nextMilestone: number;      // 下個獎勵里程碑
}

// UIScene中的COMBO顯示
class UIScene {
  updateComboDisplay(combo: ComboState) {
    // 連擊數字放大顯示
    this.comboText.setText(`${combo.currentStreak} HIT!`);
    this.comboText.setScale(combo.currentStreak > 5 ? 1.5 : 1.0);
    
    // 警告狀態閃爍
    if (combo.isWarning) {
      this.comboText.setTint(0xff0000);  // 紅色警告
      this.startBlinkAnimation(this.comboText);
    } else {
      this.comboText.clearTint();
    }
    
    // 里程碑進度條
    this.updateMilestoneProgress(combo);
  }
}
```

### 票券獎勵動畫
```typescript
// 票券獲得特效
showTicketReward(tickets: number, milestone: number) {
  const ticketText = this.add.text(centerX, centerY, `+${tickets} 票券!`, {
    fontSize: '32px',
    fill: '#ffd700',
    stroke: '#000000',
    strokeThickness: 3
  }).setOrigin(0.5);
  
  // 彈跳動畫
  this.tweens.add({
    targets: ticketText,
    scaleX: { from: 0, to: 1.5 },
    scaleY: { from: 0, to: 1.5 },
    alpha: { from: 1, to: 0 },
    y: centerY - 100,
    duration: 2000,
    ease: 'Bounce.easeOut',
    onComplete: () => ticketText.destroy()
  });
  
  // 里程碑達成特效
  if (milestone > 0) {
    this.showMilestoneEffect(milestone);
  }
}
```

## 統計面板系統

### 遊戲統計顯示
```typescript
// 統計資料載體
interface StatsPayload {
  chars: CharStat[];          // 4角色狀態陣列
  teamKills: number;          // 團隊總擊殺
  survivalMs: number;         // 生存時間毫秒
  playerBurstReady: boolean;  // 玩家爆發準備狀態
  count: number;              // 當前計數
  maxCount: number;           // 最大計數
  
  // 等級系統 (v14+)
  level: number;              // 團隊等級
  levelCap: number;           // 等級上限
  levelExpInto: number;       // 當前等級內經驗
}

// 統計面板更新
updateTeamStats(payload: StatsPayload) {
  // 團隊擊殺數
  this.teamKillsText.setText(`團隊擊殺: ${payload.teamKills}`);
  
  // 生存時間 (mm:ss格式)
  const minutes = Math.floor(payload.survivalMs / 60000);
  const seconds = Math.floor((payload.survivalMs % 60000) / 1000);
  this.survivalText.setText(`生存時間: ${minutes}:${seconds.toString().padStart(2, '0')}`);
  
  // 等級與經驗
  this.levelText.setText(`等級: ${payload.level}/${payload.levelCap}`);
  this.updateExpBar(payload.levelExpInto);
}
```

### 角色面板系統
```typescript
// 4角色狀態面板
updateCharacterPanels(chars: CharStat[]) {
  chars.forEach((char, index) => {
    const panel = this.characterPanels[index];
    
    // 血條更新
    const hpRatio = char.hp / char.maxHp;
    panel.hpBar.setScale(hpRatio, 1);
    panel.hpBar.setTint(hpRatio > 0.3 ? 0x00ff00 : 0xff0000);
    
    // 連段/能量條
    const spiritRatio = char.spirit / char.maxSpirit;
    panel.spiritBar.setScale(spiritRatio, 1);
    
    // 存活狀態視覺
    if (!char.alive) {
      panel.container.setAlpha(0.3);     // 死亡變暗
      panel.container.setTint(0x666666);
    } else {
      panel.container.setAlpha(1.0);
      panel.container.clearTint();
    }
    
    // 擊殺數顯示
    panel.killsText.setText(`${char.kills}`);
    
    // 貨幣顯示
    panel.creditText.setText(`${char.credit}💰`);
  });
}
```

## 頭上UI系統

### 角色跟隨UI
```typescript
// Character - 腳下狀態條同步
syncLabel() {
  // 位置跟隨角色
  this.label.setPosition(this.x, this.y + 32);
  
  // 血條更新 (僅在需要時顯示)
  if (this.hp < this.maxHp) {
    this.updateHealthBar();
    this.hpBarBg.setVisible(true);
    this.hpBar.setVisible(true);
  } else {
    this.hpBarBg.setVisible(false);
    this.hpBar.setVisible(false);
  }
  
  // 連段/能量條
  this.updateSpiritBar();
  
  // 特殊狀態標記
  this.updateStatusMarkers();
}

// 血條視覺化
private updateHealthBar() {
  const hpRatio = this.hp / this.maxHp;
  const barWidth = this.footBarW;  // 34px
  const barHeight = 4;
  
  // 背景條 (暗紅)
  this.hpBarBg.setSize(barWidth, barHeight);
  this.hpBarBg.setFillStyle(0x330000);
  
  // 當前血量條
  this.hpBar.setSize(barWidth * hpRatio, barHeight);
  this.hpBar.setFillStyle(hpRatio > 0.3 ? 0x00ff00 : 0xff0000);
}
```

### 狀態標記系統
```typescript
// 爆發標記 (v19+)
private updateBurstMark() {
  const spiritFull = this.spirit >= this.getMaxSpirit();
  
  if (spiritFull && !this.burstMark.visible) {
    this.burstMark.setVisible(true);
    this.burstMark.setText('爆');
    
    // 脈動動畫
    this.burstMarkTween = this.scene.tweens.add({
      targets: this.burstMark,
      scaleX: { from: 1, to: 1.3 },
      scaleY: { from: 1, to: 1.3 },
      duration: 500,
      yoyo: true,
      repeat: -1
    });
  } else if (!spiritFull && this.burstMark.visible) {
    this.burstMark.setVisible(false);
    this.burstMarkTween?.stop();
  }
}

// 定身標記 (v45+)
private updateRootMark() {
  const isRooted = this.scene.time.now < this.rootedUntil;
  
  if (isRooted && !this.rootMark.visible) {
    this.rootMark.setVisible(true);
    this.rootMark.setText('定身!');
    
    // 鎖鏈環繞效果
    this.rootRing.clear();
    this.rootRing.lineStyle(3, 0xffff00, 0.8);
    this.rootRing.strokeCircle(this.x, this.y, 25);
  } else if (!isRooted) {
    this.rootMark.setVisible(false);
    this.rootRing.clear();
  }
}
```

## 強化視覺系統

### 強化型態造型 (v60)
```typescript
// Character - 強化形態視覺
class Character {
  empoweredForm: boolean = false;          // 強化型態開關
  private empowerFormOn: boolean = false;  // 當前顯示狀態
  private empowerParticles?: Phaser.GameObjects.Particles.ParticleEmitter;
  
  updateEmpowerVisuals() {
    const shouldShow = this.empowered && this.empoweredForm;
    
    if (shouldShow && !this.empowerFormOn) {
      // 進入強化型態
      this.empowerFormOn = true;
      this.createEmpowerParticles();
      this.createOrbitEffect();
      
    } else if (!shouldShow && this.empowerFormOn) {
      // 退出強化型態
      this.empowerFormOn = false;
      this.destroyEmpowerParticles();
      this.clearOrbitEffect();
    }
  }
  
  // 強化粒子效果
  private createEmpowerParticles() {
    this.empowerParticles = this.scene.add.particles(this.x, this.y, 'spark', {
      scale: { start: 0.3, end: 0 },
      speed: { min: 30, max: 60 },
      lifespan: 1000,
      alpha: { start: 0.8, end: 0 },
      tint: 0xffd700,
      frequency: 50
    });
  }
}
```

### 軌道環繞特效 (v40)
```typescript
// 強化狀態軌道效果
private empowerOrbit: Phaser.GameObjects.Graphics;

updateOrbitEffect() {
  if (!this.empowered) return;
  
  this.empowerOrbit.clear();
  
  // 環繞光點
  const time = this.scene.time.now * 0.003;  // 旋轉速度
  const orbitRadius = 30;
  
  for (let i = 0; i < 3; i++) {
    const angle = time + (i * Math.PI * 2 / 3);
    const orbX = this.x + Math.cos(angle) * orbitRadius;
    const orbY = this.y + Math.sin(angle) * orbitRadius;
    
    // 光點繪製
    this.empowerOrbit.fillStyle(0xffd700, 0.8);
    this.empowerOrbit.fillCircle(orbX, orbY, 4);
  }
  
  // 脈動光環
  const pulseScale = 1 + Math.sin(time * 2) * 0.2;
  this.empowerOrbit.lineStyle(2, 0xffd700, 0.6);
  this.empowerOrbit.strokeCircle(this.x, this.y, 25 * pulseScale);
}
```

## 調參面板系統 (2decdde更新)

### 開發工具UI
```typescript
// TitleScene - zoom編輯器 (保留)  
private zoomEditorActive = false;
private zoomSliders: Array<{
  name: string;
  value: number; 
  min: number; max: number; step: number;
  slider: Phaser.GameObjects.Rectangle;
  handle: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  valueText: Phaser.GameObjects.Text;
}> = [];

// 注意: 邊界編輯器已在commit 2decdde中完全移除
// - 🔧邊界設定按鈕已刪除
// - B鍵邊界編輯器已移除  
// - borderEditorActive等相關變數已清理
// - config.borderEditor配置已刪除

// 滑桿互動 (zoom編輯器)
updateSliderValue(slider: SliderConfig, delta: number) {
  slider.value = Phaser.Math.Clamp(
    slider.value + delta * slider.step,
    slider.min,
    slider.max
  );
  
  // 更新手柄位置
  const ratio = (slider.value - slider.min) / (slider.max - slider.min);
  slider.handle.x = slider.slider.x + (ratio - 0.5) * slider.slider.width;
  
  // 更新數值顯示
  slider.valueText.setText(slider.value.toFixed(2));
  
  // 應用到zoom配置
  this.applyZoomConfig(slider.name, slider.value);
}
```
```

**參考檔案**: `scenes/UIScene.ts`, `objects/Character.ts`, `scenes/TitleScene.ts`
