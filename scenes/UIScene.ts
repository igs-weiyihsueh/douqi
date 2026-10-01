import Phaser from 'phaser';
import { GameConfig } from '../config';

interface CharStat {
  label: string;
  color: number;
  hp: number;
  maxHp: number;
  spirit: number;
  maxSpirit: number;
  kills: number;
  alive: boolean;
  isPlayer: boolean;
  // ★頭上UI：角色世界座標
  x: number;
  y: number;
}

interface StatsPayload {
  chars: CharStat[];
  teamKills: number;
  survivalMs: number;
  playerBurstReady: boolean;
  count: number;
  maxCount: number;
  /** v14 等級制 */
  level: number;
  levelCap: number;
  levelExpInto: number;
  levelExpNeed: number;
  /** v25 第8項：P1 普攻累計命中次數 */
  p1AttackHits: number;
  /** v27 波次制 */
  wave: number;
  waveKilled: number;
  waveQuota: number;
  waveState: string;
  /** ★波次進度 HUD(關卡制) */
  levelMode?: boolean;
  currentLevel?: number;
  currentSub?: string;
  subWavesDone?: number;
  subWavesTarget?: number;
  progressPhase?: string;
  crossingOpen?: boolean;
  /** v31/v55 連段(招式)系統 */
  controlMode: string;
  combo: number;
  comboMax: number;
  comboThresholds: { circle: number; line: number; burst: number; empower: number };
  comboUnlocked: { circle: boolean; line: boolean; burst: boolean; empower: boolean };
  empowerRemainMs: number;
  /** v55 能量(強化)系統(slow 用) */
  energy: number;
  energyMax: number;
  energyTrigger: number;
  empowered: boolean;
}

/**
 * UIScene（v19）：疊在遊戲上方的 HUD。
 * - 上方中央：團隊總擊殺 + 存活時間 + 加夥伴提示 + 等級/經驗條
 * - 血量/鬥氣改顯示在「各角色腳下」（見 Character），HUD 不再有底部狀態列與攻擊鈕
 * - 攻擊：空白鍵 或 點擊畫面任意處（不顯示大按鈕）
 * - 角色周圍：P1 的方向瞄準圓環 + 箭頭
 */
export class UIScene extends Phaser.Scene {
  private teamText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;

  /** 🔄 NEW UI：角色狀態列重大改版 - 圓形標籤 + 雙欄位系統 */
  private rows: {
    // 🔵 圓形標籤系統
    circle: Phaser.GameObjects.Arc;
    labelText: Phaser.GameObjects.Text;
    
    // 📊 雙欄位系統  
    killIconText: Phaser.GameObjects.Text;  // 💀 骷髏圖案
    killText: Phaser.GameObjects.Text;      // 擊殺數字
    ticketIconText: Phaser.GameObjects.Text; // 🎫 彩票圖案
    ticketText: Phaser.GameObjects.Text;    // 彩票數字
    
    // 🎨 背景系統 - 方案B：分離式小框設計
    panelBg: Phaser.GameObjects.Rectangle;  // 個別面板背景
    killBox: Phaser.GameObjects.Rectangle;  // 💀 擊殺數小框
    ticketBox: Phaser.GameObjects.Rectangle; // 🎫 彩票數小框
    
    // ❌ 移除的血條系統 (保留屬性防止破壞現有代碼)
    hpBarBg: Phaser.GameObjects.Rectangle;
    hpBar: Phaser.GameObjects.Rectangle;
    spiritBar: Phaser.GameObjects.Rectangle;
  }[] = [];

  private aimGraphics!: Phaser.GameObjects.Graphics;
  private joinHintText!: Phaser.GameObjects.Text;
  /** ★波次進度 HUD:節點序列圖(●─●─◆);Graphics 每幀重繪 */
  private waveHudGfx!: Phaser.GameObjects.Graphics;
  /** 波次 HUD 最新進度(供 update() 每幀重繪脈動用);visible 決定是否顯示 */
  private waveHudDone = 0;
  private waveHudTarget = 0;
  private waveHudShow = false;
  /** ★線漸進填滿:目前已填滿的「線段進度」(0..target),每幀 lerp 逼近 waveHudFillTarget */
  private waveHudFill = 0;
  /** ★③逐怪反饋:目標填線進度 = 已完成波數 + 當前波(waveKilled/waveQuota);每殺一隻怪即前進一點 */
  private waveHudFillTarget = 0;
  /** ★D:節點圖案 icons — nodeIcons[]=波次節點(enemy-normal),rewardIcon=獎勵節點(collect-gem) */
  private nodeIcons: Phaser.GameObjects.Image[] = [];
  private rewardIcon!: Phaser.GameObjects.Image;
  /** v25 第8項：P1 普攻命中計數（左上角） */
  private hitText!: Phaser.GameObjects.Text;
  /** ★頭上UI系統 - 替換舊的左上角COMBO系統 */
  // 移除：comboBar, comboNodes, comboLabel, energyBar等左上角UI元素
  // 保留：character.spirit數值邏輯（COMBO獎勵系統會用到）
  private overheadUIs: Map<CharStat, Phaser.GameObjects.Container> = new Map();
  private readonly OVERHEAD_DEPTH = 900;
  /** v27 波次顯示（上方中央） */
  private waveText!: Phaser.GameObjects.Text;
  /** v28 BOSS 血條 */
  private bossBarBg!: Phaser.GameObjects.Rectangle;
  private bossBar!: Phaser.GameObjects.Rectangle;
  private bossLabel!: Phaser.GameObjects.Text;
  private readonly bossBarWidth = 460;
  /** v33 事件 HUD（進度/倒數條） */
  private eventBarBg!: Phaser.GameObjects.Rectangle;
  private eventBar!: Phaser.GameObjects.Rectangle;
  private eventLabel!: Phaser.GameObjects.Text;
  private readonly eventBarWidth = 400;
  /** ★道具開關觸控按鈕(右上角);面色/字隨 itemsEnabled 狀態更新;與鍵盤 I 鍵並存 */
  private itemToggleBtnBg!: Phaser.GameObjects.Rectangle;
  private itemToggleBtnText!: Phaser.GameObjects.Text;

  constructor() {
    super('UIScene');
  }

  create(): void {
    // 根因修復：重啟時 rows 殘留上一局已銷毀物件會崩潰，每次 create 先清空
    this.rows = [];
    this.overheadUIs.clear(); // 清空頭上UI容器
    const w = GameConfig.width;
    const h = GameConfig.height;

    // 團隊總分 + 時間（上方中央）——★用戶要求隱藏這兩個上方文字(保留物件供 stats 更新,不顯示)
    this.teamText = this.add
      .text(w / 2, 14, '團隊總擊殺 0', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffe66d',
        stroke: '#000000',
        strokeThickness: 4
      })
      .setOrigin(0.5, 0)
      .setVisible(false);
    this.timeText = this.add
      .text(w / 2, 40, '時間 0.0s', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#cbd5e1',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setOrigin(0.5, 0)
      .setVisible(false);

    // ★波次進度 HUD(關卡制:節點序列 ●─●─◆);固定螢幕、每幀依 stats 重繪,預設隱藏。
    this.waveHudGfx = this.add.graphics()
      .setScrollFactor(0)
      .setDepth(25)
      .setVisible(false);
    // ★D:節點 icon(修正版):原本 Graphics 圓形/菱形形狀、發光、pulse 全部保留(Graphics depth25 不動)。
    // Icon 只是疊在節點中心的【小裝飾】——尺寸明顯小於節點,不蓋住邊框/發光效果。depth=26。不加 mask。
    const iconMaxWaves = 4;
    const nr = GameConfig.waveHud.nodeRadius;
    const waveIconSize = Math.round(nr * 1.6); // 約 nodeRadius×0.8 半徑 → 不蓋外圈
    for (let i = 0; i < iconMaxWaves; i++) {
      const icon = this.add.image(0, 0, 'enemy-normal')
        .setScrollFactor(0).setDepth(26).setVisible(false)
        .setDisplaySize(waveIconSize, waveIconSize);
      this.nodeIcons.push(icon);
    }
    // 獎勵節點 icon(collect-gem 綠寶石):菱形比圓形略大,icon 縮一點
    const rewardIconSize = Math.round(nr * 1.6);
    this.rewardIcon = this.add.image(0, 0, 'collect-gem')
      .setScrollFactor(0).setDepth(26).setVisible(false)
      .setDisplaySize(rewardIconSize, rewardIconSize);

    // ★UI調整②:加入夥伴提示移到【畫面下方】(角色狀態列上方,置中) - 🚫 用戶要求關閉
    this.joinHintText = this.add
      .text(w / 2, h - 100, '按 B 加入ROBOT (1/4)', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#7bed9f',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setOrigin(0.5, 0)
      .setDepth(21)
      .setVisible(false); // 🚫 關閉加入夥伴提示

    // ★拔等級(階段2):等級數字 + 經驗條 HUD 已移除(等級系統已拔,數值固定滿等)。畫面下方留白,不再顯示 Lv/經驗。

    // v25 第8項：P1 普攻命中計數（左上角，不擋主要畫面）
    this.hitText = this.add
      .text(12, 12, '命中 0', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#8be9fd',
        stroke: '#000000',
        strokeThickness: 4
      })
      .setOrigin(0, 0);

    // v27 波次顯示（右上角）- 🚫 用戶要求關閉
    this.waveText = this.add
      .text(w - 12, 12, 'WAVE 1  0/12', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffb86c',
        stroke: '#000000',
        strokeThickness: 4,
        align: 'right'
      })
      .setOrigin(1, 0)
      .setVisible(false); // 🚫 關閉波次顯示

    // ★頭上UI系統初始化 - 替換舊的左上角COMBO/能量系統
    this.createOverheadUISystem();

    // 🔄 NEW UI：角色狀態列重大改版 - 圓形標籤 + 雙欄位系統，移除血條系統
    const count = GameConfig.characters.count;
    const panelW = 200;
    const panelH = 60;
    const panelGap = 12;
    const startX = (w - (count * panelW + (count - 1) * panelGap)) / 2; // 居中排列
    const rowTopY = h - 80;
    
    // 🎨 整個狀態列表統一底圖
    this.add
      .rectangle(startX - 8, rowTopY - 8, count * panelW + (count - 1) * panelGap + 16, panelH + 16, 0x000000, 0.6)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x444444, 0.8)
      .setDepth(18); // 在所有元素下方
    
    for (let i = 0; i < count; i++) {
      const x = startX + i * (panelW + panelGap);
      const color = GameConfig.characters.colors[i];
      const label = GameConfig.characters.labels[i];
      
      // 🎨 個別角色狀態背景 - 配合角色顏色，不透明
      const panelBg = this.add
        .rectangle(x, rowTopY, panelW, panelH, color, 1.0) // 使用角色顏色，完全不透明
        .setOrigin(0, 0)
        .setStrokeStyle(1, 0xffffff, 0.8) // 白色邊框
        .setDepth(19);
      
      // 🔵 左側圓形標籤 (24px半徑，白邊框，角色識別色填充)
      const circleX = x + 24;
      const circleY = rowTopY + panelH / 2;
      const circleRadius = 24;
      
      const circle = this.add.circle(circleX, circleY, circleRadius, color)
        .setStrokeStyle(2, 0xffffff)
        .setDepth(20);
      
      const labelText = this.add
        .text(circleX, circleY, label, { 
          fontFamily: 'monospace', 
          fontSize: '14px', 
          color: '#ffffff', 
          stroke: '#000000', 
          strokeThickness: 2,
          fontStyle: 'bold'
        })
        .setOrigin(0.5, 0.5)
        .setDepth(21);
      
      // 📊 右側雙欄位系統
      const statsX = x + 60;
      
      // 🎨 計算較暗的角色顏色用於小框
      const colorObj = Phaser.Display.Color.IntegerToColor(color);
      const darkerColor = Phaser.Display.Color.GetColor(
        Math.floor(colorObj.red * 0.7),
        Math.floor(colorObj.green * 0.7), 
        Math.floor(colorObj.blue * 0.7)
      );
      
      // 🔲 方案B：分離式小框設計 - 為💀和🎫各自添加獨立背景框
      
      // 上方：💀 骷髏擊殺數小框 - 調整為支援4位數顯示
      const killBoxW = 75;  // 從60px增加到75px，與彩票數框保持一致
      const killBoxH = 20;
      const killBoxX = statsX - 2;
      const killBoxY = rowTopY + 6;
      
      const killBox = this.add
        .rectangle(killBoxX, killBoxY, killBoxW, killBoxH, darkerColor, 1.0)
        .setOrigin(0, 0)
        .setStrokeStyle(1, 0xffffff, 0.6)
        .setDepth(20);
      
      const killIconText = this.add
        .text(statsX, rowTopY + 8, '💀', { 
          fontSize: '16px' 
        })
        .setDepth(21);
        
      const killText = this.add
        .text(statsX + 25, rowTopY + 8, '0', { 
          fontFamily: 'monospace', 
          fontSize: '16px', 
          color: '#ffffff', 
          stroke: '#000000', 
          strokeThickness: 2,
          fontStyle: 'bold'
        })
        .setDepth(21);
      
      // 下方：🎫 彩票數小框 (分離獨立) - 調整為支援4位數顯示
      const ticketBoxW = 75;  // 從60px增加到75px，支援4位數(1000-9999)顯示
      const ticketBoxH = 20;
      const ticketBoxX = statsX - 2;
      const ticketBoxY = rowTopY + 30;
      
      const ticketBox = this.add
        .rectangle(ticketBoxX, ticketBoxY, ticketBoxW, ticketBoxH, darkerColor, 1.0)
        .setOrigin(0, 0)
        .setStrokeStyle(1, 0xffffff, 0.6)
        .setDepth(20);
      
      const ticketIconText = this.add
        .text(statsX, rowTopY + 32, '🎫', { 
          fontSize: '16px' 
        })
        .setDepth(21);
        
      const ticketText = this.add
        .text(statsX + 25, rowTopY + 32, '0', { 
          fontFamily: 'monospace', 
          fontSize: '16px', 
          color: '#ffd700', 
          stroke: '#000000', 
          strokeThickness: 2,
          fontStyle: 'bold'
        })
        .setDepth(21);
      
      // 存儲UI元素 (方案B：分離式小框 + 個別面板背景)
      this.rows.push({ 
        circle,
        labelText, 
        killIconText,
        killText,
        ticketIconText, 
        ticketText,
        panelBg,        // 🎨 個別面板背景
        killBox,        // 🔲 擊殺數小框
        ticketBox,      // 🔲 彩票數小框
        // 保留空的血條屬性以免破壞現有代碼 (移除大框statsBg)
        hpBarBg: this.add.rectangle(0, 0, 0, 0).setVisible(false),
        hpBar: this.add.rectangle(0, 0, 0, 0).setVisible(false), 
        spiritBar: this.add.rectangle(0, 0, 0, 0).setVisible(false)
      });
    }

    this.aimGraphics = this.add.graphics().setDepth(30);

    // v28 BOSS 血條（上方中央，預設隱藏）
    const bossBarY = 116;
    this.bossLabel = this.add
      .text(w / 2, bossBarY - 16, 'BOSS', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#ff5a6e',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setOrigin(0.5, 0)
      .setDepth(40)
      .setVisible(false);
    this.bossBarBg = this.add
      .rectangle(w / 2 - this.bossBarWidth / 2, bossBarY, this.bossBarWidth, 14, 0x000000, 0.6)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xff3355, 0.8)
      .setDepth(40)
      .setVisible(false);
    this.bossBar = this.add
      .rectangle(w / 2 - this.bossBarWidth / 2 + 2, bossBarY + 2, this.bossBarWidth - 4, 10, 0xff3355)
      .setOrigin(0, 0)
      .setDepth(40)
      .setVisible(false);

    // v33 事件 HUD 條（上方中央，BOSS 條下方；預設隱藏）
    const eventBarY = 142;
    this.eventLabel = this.add
      .text(w / 2, eventBarY - 16, '', {
        fontFamily: 'monospace', fontSize: '15px', color: '#ffd166', stroke: '#000000', strokeThickness: 3
      })
      .setOrigin(0.5, 0).setDepth(40).setVisible(false);
    this.eventBarBg = this.add
      .rectangle(w / 2 - this.eventBarWidth / 2, eventBarY, this.eventBarWidth, 12, 0x000000, 0.6)
      .setOrigin(0, 0).setStrokeStyle(2, 0xffd166, 0.8).setDepth(40).setVisible(false);
    this.eventBar = this.add
      .rectangle(w / 2 - this.eventBarWidth / 2 + 2, eventBarY + 2, this.eventBarWidth - 4, 8, 0xffd166)
      .setOrigin(0, 0).setDepth(40).setVisible(false);

    // v19：移除右下攻擊鈕；改為「點擊畫面任意處」觸發攻擊（空白鍵仍可用，於 GameScene）
    // ★道具開關觸控按鈕(右上角):必須在全畫面攻擊熱區【之前】建立,並攔截 pointerdown(stopPropagation)避免點按鈕也觸發攻擊。
    const btnW = 56, btnH = 36, btnPad = 12;
    const btnCx = w - btnPad - btnW / 2;
    const btnCy = btnPad + btnH / 2;
    const initOn = GameConfig.items.spawnEnabled;
    // 🚫 用戶要求關閉：右上角道具按鈕 (原本顯示"結束(1)"等內容)
    this.itemToggleBtnBg = this.add
      .rectangle(btnCx, btnCy, btnW, btnH, initOn ? 0x1a7f37 : 0x9b2226, 0.85)
      .setStrokeStyle(2, 0xffffff, 0.7)
      .setDepth(50)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .setVisible(false); // 🚫 關閉右上角按鈕
    this.itemToggleBtnText = this.add
      .text(btnCx, btnCy, initOn ? '道具\nON' : '道具\nOFF', {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', stroke: '#000000', strokeThickness: 2, align: 'center'
      })
      .setOrigin(0.5, 0.5)
      .setDepth(51)
      .setScrollFactor(0)
      .setVisible(false); // 🚫 關閉按鈕文字
    this.itemToggleBtnBg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation(); // ★攔截:不讓此點擊冒泡到全畫面攻擊熱區
      this.game.events.emit('ui-toggle-items');
    });

    this.input.on('pointerdown', () => this.game.events.emit('ui-attack'));

    this.game.events.on('stats', this.updateStats, this);
    this.game.events.on('aim', this.updateAim, this);
    this.game.events.on('boss-hp', this.updateBossHp, this);
    this.game.events.on('event-hud', this.updateEventHud, this);
    this.game.events.on('items-state', this.updateItemToggleBtn, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('stats', this.updateStats, this);
      this.game.events.off('aim', this.updateAim, this);
      this.game.events.off('boss-hp', this.updateBossHp, this);
      this.game.events.off('event-hud', this.updateEventHud, this);
      this.game.events.off('items-state', this.updateItemToggleBtn, this);
      // ★D:清除節點 icon
      for (const ic of this.nodeIcons) ic.destroy();
      if (this.rewardIcon) this.rewardIcon.destroy();
    });
  }

  /** ★道具開關按鈕面:隨 itemsEnabled 狀態即時更新色/字(開=綠ON、關=紅OFF)。由 GameScene 'items-state' 事件驅動。 */
  private updateItemToggleBtn = (on: boolean): void => {
    if (!this.itemToggleBtnBg) return;
    this.itemToggleBtnBg.setFillStyle(on ? 0x1a7f37 : 0x9b2226, 0.85);
    this.itemToggleBtnText.setText(on ? '道具\nON' : '道具\nOFF');
  };

  /** v33 事件 HUD 更新：label + 進度/倒數 */
  private updateEventHud = (d: { active: boolean; label: string; ratio: number; remainMs: number }): void => {
    const show = d.active;
    this.eventLabel.setVisible(show);
    this.eventBarBg.setVisible(show);
    this.eventBar.setVisible(show);
    if (show) {
      const suffix = d.remainMs > 0 ? `  ${(d.remainMs / 1000).toFixed(1)}s` : '';
      this.eventLabel.setText(`${d.label}${suffix}`);
      this.eventBar.width = (this.eventBarWidth - 4) * Phaser.Math.Clamp(d.ratio, 0, 1);
    }
  };

  /** v28：BOSS 血條更新 */
  private updateBossHp = (d: { active: boolean; ratio: number }): void => {
    const show = d.active;
    this.bossLabel.setVisible(show);
    this.bossBarBg.setVisible(show);
    this.bossBar.setVisible(show);
    if (show) {
      this.bossBar.width = (this.bossBarWidth - 4) * Phaser.Math.Clamp(d.ratio, 0, 1);
    }
  };

  private updateStats = (s: StatsPayload): void => {
    this.teamText.setText(`團隊總擊殺 ${s.teamKills}`);
    this.timeText.setText(`時間 ${(s.survivalMs / 1000).toFixed(1)}s`);
    // v25 第8項：P1 普攻命中次數
    this.hitText.setText(`命中 ${s.p1AttackHits ?? 0}`);
    // v27 波次：Wave N + 進度；intermission 顯示過關中
    if (s.waveState === 'intermission') {
      this.waveText.setText(`WAVE ${s.wave} CLEAR!`);
    } else {
      this.waveText.setText(`WAVE ${s.wave}  ${s.waveKilled}/${s.waveQuota}`);
    }

    // ★頭上UI系統：檢查並創建角色的頭上UI
    for (let i = 0; i < s.chars.length; i++) {
      const character = s.chars[i];
      if (!this.overheadUIs.has(character)) {
        const container = this.createOverheadUI(character, i);
        this.overheadUIs.set(character, container);
      }
      
      // 更新頭上UI位置
      const container = this.overheadUIs.get(character);
      if (container && character.alive) {
        this.updateOverheadUI(character, container);
        container.setVisible(true);
      } else if (container) {
        container.setVisible(false);
      }
    }

    // ★波次進度 HUD(關卡制:節點序列 ●─●─◆);只在【純波次子區】顯示;事件/BOSS/非 levelMode 隱藏。
    // 這裡只記錄狀態,實際節點繪製在 update() 每幀跑(脈動+線漸填平滑)。
    const nowShow = !!(GameConfig.waveHud.enabled && s.levelMode &&
        s.waveState !== 'event' && s.waveState !== 'boss' &&
        s.progressPhase === 'playing' && !s.crossingOpen &&
        (s.subWavesTarget ?? 0) > 0);
    const newDone = s.subWavesDone ?? 0;
    const newTarget = s.subWavesTarget ?? 0;
    // ★③逐怪反饋:填線目標 = 已完成波數 + 當前波內殺敵比例(waveKilled/waveQuota),clamp 在 [0,target]。
    // 每殺一隻怪 onWaveKill→emitStats→這裡更新目標→update() 每幀平滑 lerp 逼近→線一點一點推進(非打完整波才動)。
    //
    // ★BUG 修:波與波【過渡期(intermission)】,上一波剛完成 subWavesDone 已 +1,但 waveKilled 仍殘留 = 上一波 quota
    //   (要到下一波 spawning 才歸零)→ 若照算 curWaveFrac = quota/quota = 1 → fillTarget = done+1 → 第二段線直接跳滿。
    //   根因:當前波分項在過渡期讀到上一波的殘留殺敵值。修法:非 spawning/clearing(即 intermission 等下一波未開始)
    //   時,當前波分項一律當 0(下一波還沒開始,不該有進度);waveQuota<=0 也當 0(除零防呆)。
    const waveActive = (s.waveState === 'spawning' || s.waveState === 'clearing');
    const wq = s.waveQuota ?? 0;
    const curWaveFrac = (waveActive && wq > 0)
      ? Phaser.Math.Clamp((s.waveKilled ?? 0) / wq, 0, 1)
      : 0;
    const newFillTarget = Phaser.Math.Clamp(newDone + curWaveFrac, 0, newTarget);
    // 新子區(target 變 或 從隱藏轉顯示 或 done 倒退)→重置線填滿進度為 0(重新一節一節填)
    if (newTarget !== this.waveHudTarget || (nowShow && !this.waveHudShow) || newDone < this.waveHudDone) {
      this.waveHudFill = 0;
    }
    this.waveHudShow = nowShow;
    this.waveHudDone = newDone;
    this.waveHudTarget = newTarget;
    this.waveHudFillTarget = newFillTarget;
    if (!this.waveHudShow) {
      this.waveHudGfx.setVisible(false);
      for (const ic of this.nodeIcons) ic.setVisible(false);
      if (this.rewardIcon) this.rewardIcon.setVisible(false);
    }

    // 加入夥伴提示：滿了改字
    if (s.count >= s.maxCount) {
      this.joinHintText.setText(`夥伴已滿 (${s.count}/${s.maxCount})`);
      this.joinHintText.setColor('#94a3b8');
    } else {
      this.joinHintText.setText(`按 B 加入ROBOT (${s.count}/${s.maxCount})`);
      this.joinHintText.setColor('#7bed9f');
    }

    // 🔄 NEW UI：角色狀態列更新 - 圓形標籤 + 雙欄位系統，完全移除血條系統
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      
      if (i >= s.chars.length) {
        // 未加入狀態：透明度0.3，灰色標籤
        row.circle.setAlpha(0.3);
        row.labelText.setColor('#555555').setAlpha(0.3);
        row.killIconText.setAlpha(0.3);
        row.killText.setText('0').setColor('#555555').setAlpha(0.3);
        row.ticketIconText.setAlpha(0.3);
        row.ticketText.setText('0').setColor('#555555').setAlpha(0.3);
        // 🎨 背景保持原色不變，用戶要求移除狀態顏色變化
        continue;
      }
      
      const c = s.chars[i];
      
      if (!c.alive) {
        // 死亡狀態：透明度0.5，灰色標籤，擊殺數帶✖
        row.circle.setAlpha(0.5);
        row.labelText.setColor('#777777').setAlpha(0.5);
        row.killIconText.setAlpha(0.5);
        row.killText.setText(`${c.kills} ✖`).setColor('#777777').setAlpha(0.5);
        row.ticketIconText.setAlpha(0.5);
        const tickets = Math.floor(c.kills / 2);
        row.ticketText.setText(`${tickets} ✖`).setColor('#777777').setAlpha(0.5);
        // 🎨 背景保持原色不變，用戶要求移除狀態顏色變化
        continue;
      }
      
      // 活躍狀態：完全不透明，白色標籤
      row.circle.setAlpha(1);
      row.labelText.setColor('#ffffff').setAlpha(1);
      row.killIconText.setAlpha(1);
      row.killText.setText(`${c.kills}`).setColor('#ffffff').setAlpha(1);
      row.ticketIconText.setAlpha(1);
      const tickets = Math.floor(c.kills / 2);
      row.ticketText.setText(`${tickets}`).setColor('#ffd700').setAlpha(1); // 彩票數金色
      // 🎨 背景保持原色不變，用戶要求移除狀態顏色變化
    }
  };

  /** 每幀:波次節點序列脈動 + 線漸進填滿重繪(只在顯示時)。 */
  update(_time: number, delta: number): void {
    // ★頭上UI系統：移除舊的COMBO/能量閃爍邏輯
    // 保留波次節點相關邏輯
    if (!this.waveHudShow) return;
    // ★③逐怪反饋:waveHudFill 每幀 lerp 逼近 waveHudFillTarget(=已完成波+當前波殺敵比例)。
    // 每殺一隻怪目標往前一點→線一點一點平滑推進(非打完整波才填);一整「段線」約 lineFillMs 填滿速率。
    const rate = delta / Math.max(1, GameConfig.waveHud.lineFillMs); // 每 ms 前進的段數比例
    if (this.waveHudFill < this.waveHudFillTarget) {
      this.waveHudFill = Math.min(this.waveHudFillTarget, this.waveHudFill + rate);
    } else if (this.waveHudFill > this.waveHudFillTarget) {
      this.waveHudFill = this.waveHudFillTarget;
    }
    this.drawWaveNodes(this.waveHudDone, this.waveHudTarget, this.waveHudFill);
    this.waveHudGfx.setVisible(true);
    // ★D:更新節點 icons 位置+狀態(跟 waveHudGfx 相同座標系)
    this.updateNodeIcons(this.waveHudDone, this.waveHudTarget);
  }

  /**
   * ★D:節點 icon 位置/狀態更新(每幀在 drawWaveNodes 後呼叫)。
   * 波次節點 icon(enemy-normal): done=亮(tint 白)、pending=暗(tint 0x666666)。
   * 獎勵節點 icon(collect-gem): allDone=亮,else=暗。mask 跟隨節點中心。
   */
  private updateNodeIcons(done: number, target: number): void {
    const cfg = GameConfig.waveHud;
    const total = target + 1; // 波次節點 + 獎勵節點
    const gap = cfg.nodeGap;
    const width = (total - 1) * gap;
    const startX = cfg.x - width / 2;
    const y = cfg.y;
    // 波次節點(target 個):icon 疊在圓形中心,尺寸小於節點,不蓋外圈/發光
    for (let i = 0; i < this.nodeIcons.length; i++) {
      const icon = this.nodeIcons[i];
      if (i >= target) { icon.setVisible(false); continue; }
      const cx = startX + i * gap;
      icon.setPosition(cx, y).setVisible(true);
      icon.setTint(i < done ? 0xffffff : 0x888888); // done=亮白、pending=暗灰
    }
    // 獎勵節點:icon 疊在菱形中心
    const rx = startX + target * gap;
    const allDone = done >= target;
    this.rewardIcon.setPosition(rx, y).setVisible(true);
    this.rewardIcon.setTint(allDone ? 0xffffff : 0x666666);
  }

  /**
   * ★波次進度節點序列 ●─●─◆:target 個波次節點 + 1 個獎勵節點(菱形)。
   * 先畫線(含漸進填滿 fill)→再畫節點(節點蓋住線交會處,層次壓過線)。
   * done 個波次已亮、第 done+1 個(當前波)高亮脈動、其餘暗;fill=已填滿的線段進度(0..target)。
   */
  private drawWaveNodes(done: number, target: number, fill: number): void {
    const cfg = GameConfig.waveHud;
    const g = this.waveHudGfx;
    g.clear();
    const total = target + 1; // 波次節點 + 獎勵節點
    const r = cfg.nodeRadius, gap = cfg.nodeGap;
    const width = (total - 1) * gap;
    const startX = cfg.x - width / 2;
    const y = cfg.y;
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this.time.now / 260));

    // ---- 1) 連線(先畫,節點會蓋在上層) ----
    for (let i = 0; i < total - 1; i++) {
      const x1 = startX + i * gap, x2 = startX + (i + 1) * gap;
      // 底線(暗)
      g.lineStyle(cfg.lineThickness, cfg.lineColor, 0.9);
      g.lineBetween(x1, y, x2, y);
      // 已填滿部分(此段的 fill 比例:fill 落在 [i, i+1] 之間→部分填;>=i+1→全填)
      const segFill = Phaser.Math.Clamp(fill - i, 0, 1);
      if (segFill > 0) {
        g.lineStyle(cfg.lineThickness, cfg.lineFillColor, 1);
        g.lineBetween(x1, y, x1 + (x2 - x1) * segFill, y);
      }
    }

    // ---- 2) 波次節點(畫在線上層,★不透明蓋住線交會) ----
    // 每個節點先畫一層【不透明底盤(alpha1)】把線端點完全蓋掉→線絕不從節點下透出;再畫顏色層。
    const bg = 0x1a1408; // 深底(HUD 背景色調)——節點不透明底盤
    for (let i = 0; i < target; i++) {
      const cx = startX + i * gap;
      const isDone = i < done;
      const isCurrent = i === done;
      // 不透明底盤(半徑略大於線,確保完全蓋住線端點/交會)
      g.fillStyle(bg, 1); g.fillCircle(cx, y, r + 3);
      if (isDone) {
        g.fillStyle(cfg.doneColor, 1); g.fillCircle(cx, y, r);          // 亮金填滿(不透明)
        g.lineStyle(3, 0x000000, 0.45); g.strokeCircle(cx, y, r);
      } else if (isCurrent) {
        // 當前波:不透明實心(用 pulse 調亮度,非 alpha→仍完全不透明蓋線)+ 脈動外框
        const litColor = this.mixColor(bg, cfg.currentColor, pulse);
        g.fillStyle(litColor, 1); g.fillCircle(cx, y, r);
        g.lineStyle(4, cfg.currentColor, 0.5 + 0.5 * pulse); g.strokeCircle(cx, y, r + 6);
      } else {
        g.fillStyle(0x000000, 1); g.fillCircle(cx, y, r);               // 暗底(不透明,空心感靠描邊)
        g.lineStyle(3, cfg.pendingColor, 1); g.strokeCircle(cx, y, r);
      }
    }

    // ---- 3) 獎勵/完成節點(菱形 ◆,畫最上層,不透明底盤蓋線) ----
    const rx = startX + target * gap;
    const allDone = done >= target;
    const dr = r + 4;
    // 不透明圓底盤蓋住線端點(菱形本身有尖角會露線,先用圓底盤墊底)
    g.fillStyle(bg, 1); g.fillCircle(rx, y, r + 3);
    const pts = [ new Phaser.Geom.Point(rx, y - dr), new Phaser.Geom.Point(rx + dr, y), new Phaser.Geom.Point(rx, y + dr), new Phaser.Geom.Point(rx - dr, y) ];
    if (allDone) { g.fillStyle(cfg.rewardColor, 1); g.fillPoints(pts, true); g.lineStyle(3, 0xfff4c2, 1); g.strokePoints(pts, true); }
    else { g.fillStyle(0x000000, 1); g.fillPoints(pts, true); g.lineStyle(3, cfg.rewardColor, 0.9); g.strokePoints(pts, true); }
  }

  /** 依比例 t(0..1) 在兩色間線性混色(用於當前波節點脈動亮度,保持不透明填滿)。 */
  private mixColor(c0: number, c1: number, t: number): number {
    const a = Phaser.Display.Color.IntegerToColor(c0);
    const b = Phaser.Display.Color.IntegerToColor(c1);
    const r = Math.round(Phaser.Math.Linear(a.red, b.red, t));
    const g = Math.round(Phaser.Math.Linear(a.green, b.green, t));
    const bl = Math.round(Phaser.Math.Linear(a.blue, b.blue, t));
    return Phaser.Display.Color.GetColor(r, g, bl);
  }

  /** P1 方向圓環 + 箭頭 + 衝刺距離指示線（P1 陣亡則隱藏） */
  private updateAim = (a: {
    alive: boolean;
    x: number;
    y: number;
    angle: number;
    dashDistance: number;
    showDashLine?: boolean;
  }): void => {
    const g = this.aimGraphics;
    g.clear();
    if (!a.alive) return;

    const cfg = GameConfig.aim;
    // ★方案e:aimGraphics 在 UIScene(固定相機 scroll0),但玩家座標是 GameScene 世界座標;
    //   GameScene 鏡頭跟隨捲動後,需扣掉 GameScene 相機 scroll 才對齊玩家螢幕位置(否則平移/捲動後圓圈箭頭會位移)。
    const gs = this.scene.get('GameScene');
    const gcam = gs && (gs as Phaser.Scene).cameras ? (gs as Phaser.Scene).cameras.main : null;
    const ox = gcam ? gcam.scrollX : 0;
    const oy = gcam ? gcam.scrollY : 0;
    const ax = a.x - ox, ay = a.y - oy;

    // 衝刺距離指示線（半透明）+ 終點小標記
    if (a.showDashLine !== false) {
      const ind = cfg.indicator;
      const ex = ax + Math.cos(a.angle) * a.dashDistance;
      const ey = ay + Math.sin(a.angle) * a.dashDistance;
      g.lineStyle(ind.thickness, ind.color, ind.alpha);
      g.lineBetween(ax, ay, ex, ey);
      g.fillStyle(ind.color, ind.alpha + 0.25);
      g.fillCircle(ex, ey, ind.endMarkerRadius);
    }

    // 方向圓環
    g.lineStyle(cfg.ringThickness, cfg.ringColor, cfg.ringAlpha);
    g.strokeCircle(ax, ay, cfg.ringRadius);

    // 箭頭
    const tipX = ax + Math.cos(a.angle) * (cfg.ringRadius + cfg.arrowSize * 0.6);
    const tipY = ay + Math.sin(a.angle) * (cfg.ringRadius + cfg.arrowSize * 0.6);
    const baseX = ax + Math.cos(a.angle) * (cfg.ringRadius - cfg.arrowSize * 0.4);
    const baseY = ay + Math.sin(a.angle) * (cfg.ringRadius - cfg.arrowSize * 0.4);
    const perp = a.angle + Math.PI / 2;
    const half = cfg.arrowSize * 0.5;
    g.fillStyle(cfg.arrowColor, 1);
    g.fillTriangle(
      tipX,
      tipY,
      baseX + Math.cos(perp) * half,
      baseY + Math.sin(perp) * half,
      baseX - Math.cos(perp) * half,
      baseY - Math.sin(perp) * half
    );
  };

  /** ★頭上UI系統：創建跟隨角色的UI容器 */
  private createOverheadUISystem(): void {
    // 暫時不創建，等待角色數據傳入後再創建
    // 在updateStats中檢測角色並創建對應的頭上UI
  }

  /** ★創建單個角色的頭上UI容器 */
  private createOverheadUI(_character: CharStat, index: number): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    container.setDepth(this.OVERHEAD_DEPTH);
    
    // 🎯 玩家編號牌 - 位置：(-66, -2) 相對容器中心
    const badgeX = -66;
    const badgeY = -2;
    
    // 內圓：半徑18px，角色顏色
    const badgeColor = GameConfig.characters.colors[index];
    const badge = this.add.circle(badgeX, badgeY, 18, badgeColor)
      .setStrokeStyle(2, 0xffffff); // 白色邊框
    
    // 文字：角色標籤，20px字體，白色
    const badgeLabel = GameConfig.characters.labels[index];
    const badgeText = this.add.text(badgeX, badgeY, badgeLabel, {
      fontFamily: 'monospace',
      fontSize: '20px', 
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
      fontStyle: 'bold'
    }).setOrigin(0.5, 0.5);
    
    // 添加到容器
    container.add([badge, badgeText]);
    
    return container;
  }

  /** ★更新頭上UI位置 */
  private updateOverheadUI(character: CharStat, container: Phaser.GameObjects.Container): void {
    if (!character.alive) {
      container.setVisible(false);
      return;
    }
    
    // 🎯 使用角色實際位置：頭上140px
    const worldX = character.x;
    const worldY = character.y - 140;
    
    // ★修復座標系統：UIScene是固定相機，需要考慮GameScene的相機偏移
    const gameScene = this.scene.get('GameScene') as any;
    const gcam = gameScene?.cameras?.main;
    const screenX = worldX - (gcam?.scrollX || 0);
    const screenY = worldY - (gcam?.scrollY || 0);
    
    container.setPosition(screenX, screenY);
    container.setVisible(true);
  }
}
