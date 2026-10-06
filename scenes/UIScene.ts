import Phaser from 'phaser';
import { GameConfig } from '../config';

/**
 * COMBO獎勵系統狀態
 * Hit streak (連擊數) → 票券獎勵轉換機制
 */
interface ComboState {
  /** 當前連擊數 */
  currentStreak: number;
  /** 上次擊殺時間戳 */
  lastKillTime: number;
  /** 本局獲得票券總數 */
  ticketsEarned: number;
  /** 是否在警告狀態(1.5-2秒間) */
  isWarning: boolean;
  /** 下個獎勵里程碑 */
  nextMilestone: number;
}

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
  // ★階段二：Credit點數
  credit: number;
  // ★階段三：COMBO獎勵系統狀態
  combo: ComboState;
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
  // ★頭上UI系統：使用角色索引作為Map鍵，避免對象引用問題
  private overheadUIs: Map<number, Phaser.GameObjects.Container> = new Map();
  private readonly OVERHEAD_DEPTH = 900;
  
  // ★覆蓋模式控制標誌 - 防止updateStats()強制顯示P1頭頂UI
  private isP1HeadUIHidden = false;
  
  // ★多角色底部面板替換系統
  private bottomPanelOverlays: Array<Phaser.GameObjects.Image | null> = [null, null, null, null]; // [1P, 2P, 3P, 4P]
  private isBottomPanelOverlayMode = false;
  
  // ★頭上UI佈局常數：避免魔術數字
  private readonly OVERHEAD_UI_CONFIG = {
    // 編號牌配置 - 左側位置
    BADGE: {
      X: -70,  // ★調整：更左側，為Credit騰出空間
      Y: -5,   // ★調整：與Credit水平對齊
      RADIUS: 18,
      BORDER_WIDTH: 2,
      FONT_SIZE: '20px',
      STROKE_WIDTH: 2
    },
    // Credit顯示配置 - 編號牌右側
    CREDIT: {
      X: 20,   // ★調整：移到編號牌右側
      Y: -5,   // ★調整：與編號牌水平對齊
      BG_WIDTH: 120,
      BG_HEIGHT: 34,
      BORDER_WIDTH: 2,
      ICON_OFFSET_X: -40,
      TEXT_OFFSET_X: 10,
      FONT_SIZE: '22px',
      STROKE_WIDTH: 2,
      FLASH_CYCLE_MS: 600
    },
    // 劍形圖標尺寸
    SWORD: {
      BLADE_WIDTH: 4,
      BLADE_HEIGHT: 12,
      BLADE_Y: -8,
      TIP_Y: -11,
      GUARD_WIDTH: 12,
      GUARD_HEIGHT: 2,
      GUARD_Y: 4,
      HANDLE_WIDTH: 2,
      HANDLE_HEIGHT: 4,
      HANDLE_Y: 6,
      POMMEL_RADIUS: 2,
      POMMEL_Y: 10
    },
    // 能量條配置 - Credit正下方
    ENERGY: {
      Y_OFFSET: 25,  // ★調整：減少間距，緊貼Credit下方
      WIDTH: 100,
      HEIGHT: 8,
      BORDER_WIDTH: 1,
      HINT_OFFSET_Y: -15,
      HINT_FONT_SIZE: '14px',
      PULSE_SCALE: 2.2,
      PULSE_DURATION: 200
    },
    // ★階段三：COMBO獎勵系統配置 - 用戶要求調整
    COMBO: {
      X_OFFSET: 0,    // Credit正上方，無水平偏移
      Y: -45,         // ★用戶要求：往上移動，從-30上移到-45
      WIDTH: 120,     // 與Credit同寬，視覺對齊
      HEIGHT: 28,     // ★調整：增加高度容納更大字體
      FONT_SIZE: '24px', // ★用戶要求：字體放大，從18px增加到24px
      PROGRESS_WIDTH: 100,   // 進度條寬度
      PROGRESS_HEIGHT: 3,    // 精緻進度條高度
      PROGRESS_Y_OFFSET: 12, // 進度條與文字間距
      // ★使用配置常數，消除硬編碼
      WARNING_BLINK_MS: GameConfig.comboReward.WARNING_BLINK_MS,
      STREAK_TIMEOUT_MS: GameConfig.comboReward.STREAK_TIMEOUT_MS,
      WARNING_START_MS: GameConfig.comboReward.WARNING_START_MS
    },
    // ★COMBO獎勵里程碑配置：使用GameConfig統一配置
    COMBO_REWARDS: {
      MILESTONES: GameConfig.comboReward.MILESTONES,
      TICKETS: GameConfig.comboReward.REWARDS
    },
    // 顏色配置
    COLORS: {
      BACKGROUND: 0x000000 as const,
      BORDER_GOLD: 0xffd700 as const,
      SWORD_FILL: 0xffca28 as const,
      SWORD_BORDER: 0xffa000 as const,
      FLASH_RED: 0xff3b30 as const,
      FLASH_RED_BORDER: 0xcc0000 as const,
      ENERGY_NORMAL: 0xffd700 as const,
      ENERGY_EMPOWERED: 0xffef99 as const,
      ENERGY_FULL: 0xffe23a as const,
      // ★階段三：COMBO系統顏色
      COMBO_NORMAL: 0x00ff00 as const,        // 正常綠色
      COMBO_WARNING: 0xff6600 as const,       // 警告橙色
      COMBO_CRITICAL: 0xff0000 as const,      // 危險紅色
      COMBO_PROGRESS: 0x00ccff as const,      // 進度條藍色
      TICKET_REWARD: 0xffd700 as const,       // 票券獎勵金色
      WHITE: '#ffffff',
      BLACK: '#000000',
      TEXT_FLASH: '#ff3b30',
      HINT_YELLOW: '#ffe23a',
      // COMBO文字顏色
      COMBO_TEXT_NORMAL: '#00ff00',
      COMBO_TEXT_WARNING: '#ff6600',
      COMBO_TEXT_CRITICAL: '#ff0000'
    }
  } as const;
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
    
    // ★清空並銷毀所有頭上UI容器，防止記憶體洩漏
    this.overheadUIs.forEach((container) => {
      if (container && container.active) {
        container.destroy();
      }
    });
    this.overheadUIs.clear();
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
    
    // ★多角色底部面板替換系統初始化
    this.initMultiPlayerBottomPanelOverlays();

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

    this.aimGraphics = this.add.graphics().setDepth(-1); // 圓盤在角色下方

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

    // ★頭上UI系統：使用角色索引避免重複創建
    for (let i = 0; i < s.chars.length; i++) {
      const character = s.chars[i];
      const charIndex = i; // 使用數組索引作為唯一鍵
      
      // 檢查並創建角色的頭上UI（只創建一次）
      if (!this.overheadUIs.has(charIndex)) {
        const container = this.createOverheadUI(character, charIndex);
        this.overheadUIs.set(charIndex, container);
      }
      
      // 更新頭上UI位置和內容
      const container = this.overheadUIs.get(charIndex);
      if (container && character.alive) {
        // ★關鍵修復：在覆蓋模式下，P1頭頂UI跳過更新和顯示
        if (charIndex === 0 && this.isP1HeadUIHidden) {
          // P1頭頂UI處於覆蓋模式，跳過更新但保持位置同步
          this.updateOverheadUI(character, container, false); // 只更新位置，不強制顯示
          console.log('🎯 [覆蓋模式] P1頭頂UI跳過顯示，僅更新位置');
        } else {
          // 正常模式：更新位置、內容並顯示
          this.updateOverheadUI(character, container);
          this.updateOverheadUIContent(character, container, s);
          container.setVisible(true);
        }
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

    // ★橢圓圓盤：透視地面圓盤效果（腳底位置+放大尺寸）
    const diskY = ay + GameConfig.player.radius + 54; // 圓盤在角色腳底下方54px (總偏移70px)
    const ellipseWidth = cfg.ringRadius * 2.5; // 放大尺寸250%
    const ellipseHeight = cfg.ringRadius * 2.5 * 0.2; // 透視壓縮20%，更扁平的圓盤
    g.lineStyle(cfg.ringThickness, cfg.ringColor, cfg.ringAlpha);
    g.strokeEllipse(ax - 5, diskY, ellipseWidth, ellipseHeight);

    // 箭頭已移除，只保留圓盤
  };

  /** ★頭上UI系統：創建跟隨角色的UI容器 */
  private createOverheadUISystem(): void {
    // 暫時不創建，等待角色數據傳入後再創建
    // 在updateStats中檢測角色並創建對應的頭上UI
  }

  /**
   * 創建單個角色的頭上UI容器
   * 
   * 包含三層UI元素（從上到下）：
   * 1. 編號牌：彩色圓形 + 角色標籤（P1/BOT1/BOT2/BOT3）
   * 2. Credit顯示：劍形圖標 + 五位數Credit數字
   * 3. 能量條：金色進度條（僅慢速模式玩家顯示）
   * 
   * @param _character 角色統計數據（暫未直接使用，預留擴展）
   * @param index 角色索引（0=P1玩家, 1+=BOT）
   * @returns 包含所有UI元素的Phaser容器
   */
  private createOverheadUI(_character: CharStat, index: number): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    container.setDepth(this.OVERHEAD_DEPTH);
    
    // 創建編號牌UI元素
    const { badge, badgeText } = this.createBadgeUI(index);
    
    // 創建Credit顯示UI元素  
    const { creditBg, swordIcon, creditText } = this.createCreditUI();
    
    // 創建能量條UI元素
    const { energyBg, energyBar, energyHint } = this.createEnergyUI();
    
    // ★階段三：創建COMBO獎勵系統UI元素
    const { comboText } = this.createComboUI();
    
    // 添加所有元素到容器（移除進度條元素）
    container.add([badge, badgeText, creditBg, swordIcon, creditText, energyBg, energyBar, energyHint, comboText]);
    
    // 設置子元件引用，便於後續更新
    (container as any).creditText = creditText;
    (container as any).swordIcon = swordIcon;
    (container as any).energyBar = energyBar;
    (container as any).energyHint = energyHint;
    (container as any).energyBg = energyBg;
    // ★階段三：COMBO元件引用（移除進度條引用）
    (container as any).comboText = comboText;
    
    return container;
  }

  /**
   * 創建角色編號牌UI元素
   * 
   * 顯示彩色圓形背景和角色標籤，位於頭上UI最頂層
   * 
   * @param index 角色索引，用於選擇顏色和標籤
   * @returns 包含圓形背景和文字的UI元素
   */
  private createBadgeUI(index: number): { badge: Phaser.GameObjects.Arc; badgeText: Phaser.GameObjects.Text } {
    const config = this.OVERHEAD_UI_CONFIG;
    const badgeColor = GameConfig.characters.colors[index];
    const badgeLabel = GameConfig.characters.labels[index];
    
    // 角色標識圓形背景
    const badge = this.add.circle(
      config.BADGE.X, 
      config.BADGE.Y, 
      config.BADGE.RADIUS, 
      badgeColor
    ).setStrokeStyle(config.BADGE.BORDER_WIDTH, 0xffffff);
    
    // 角色標籤文字
    const badgeText = this.add.text(config.BADGE.X, config.BADGE.Y, badgeLabel, {
      fontFamily: 'monospace',
      fontSize: config.BADGE.FONT_SIZE,
      color: config.COLORS.WHITE,
      stroke: config.COLORS.BLACK,
      strokeThickness: config.BADGE.STROKE_WIDTH,
      fontStyle: 'bold'
    }).setOrigin(0.5, 0.5);
    
    return { badge, badgeText };
  }

  /**
   * 創建Credit點數顯示UI元素
   * 
   * 包含背景框、劍形圖標和數字文字，位於編號牌下方
   * 
   * @returns Credit顯示相關的UI元素
   */
  private createCreditUI(): { 
    creditBg: Phaser.GameObjects.Rectangle; 
    swordIcon: Phaser.GameObjects.Graphics; 
    creditText: Phaser.GameObjects.Text 
  } {
    const config = this.OVERHEAD_UI_CONFIG;
    
    // Credit背景框
    const creditBg = this.add.rectangle(
      config.CREDIT.X, 
      config.CREDIT.Y, 
      config.CREDIT.BG_WIDTH, 
      config.CREDIT.BG_HEIGHT, 
      config.COLORS.BACKGROUND, 
      0.7
    ).setStrokeStyle(config.CREDIT.BORDER_WIDTH, config.COLORS.BORDER_GOLD);
    
    // 劍形圖標
    const swordIcon = this.add.graphics();
    swordIcon.x = config.CREDIT.X + config.CREDIT.ICON_OFFSET_X;
    swordIcon.y = config.CREDIT.Y;
    this.drawSwordIcon(swordIcon, false); // 初始為正常狀態
    
    // Credit數字文字
    const creditText = this.add.text(
      config.CREDIT.X + config.CREDIT.TEXT_OFFSET_X, 
      config.CREDIT.Y, 
      '00000', 
      {
        fontFamily: 'monospace',
        fontSize: config.CREDIT.FONT_SIZE,
        color: config.COLORS.WHITE,
        stroke: config.COLORS.BLACK,
        strokeThickness: config.CREDIT.STROKE_WIDTH,
        fontStyle: 'bold'
      }
    ).setOrigin(0.5, 0.5);
    
    return { creditBg, swordIcon, creditText };
  }

  /**
   * 創建能量條UI元素
   * 
   * 包含背景條、進度條和提示文字，僅在慢速模式對玩家顯示
   * 
   * @returns 能量條相關的UI元素
   */
  private createEnergyUI(): { 
    energyBg: Phaser.GameObjects.Rectangle; 
    energyBar: Phaser.GameObjects.Rectangle; 
    energyHint: Phaser.GameObjects.Text 
  } {
    const config = this.OVERHEAD_UI_CONFIG;
    const energyX = config.CREDIT.X;
    const energyY = config.CREDIT.Y + config.ENERGY.Y_OFFSET;
    
    // 能量條背景框
    const energyBg = this.add.rectangle(
      energyX, 
      energyY, 
      config.ENERGY.WIDTH, 
      config.ENERGY.HEIGHT, 
      config.COLORS.BACKGROUND, 
      0.6
    ).setStrokeStyle(config.ENERGY.BORDER_WIDTH, config.COLORS.BORDER_GOLD);
    
    // 能量進度條（從左邊開始填充）
    const energyBar = this.add.rectangle(
      energyX - config.ENERGY.WIDTH / 2, 
      energyY, 
      0, 
      config.ENERGY.HEIGHT - 2, 
      config.COLORS.ENERGY_NORMAL
    ).setOrigin(0, 0.5);
    
    // 滿能量時的操作提示
    const energyHint = this.add.text(
      energyX, 
      energyY + config.ENERGY.HINT_OFFSET_Y, 
      'Press Z', 
      {
        fontFamily: 'monospace',
        fontSize: config.ENERGY.HINT_FONT_SIZE,
        color: config.COLORS.HINT_YELLOW,
        stroke: config.COLORS.BLACK,
        strokeThickness: 1,
        fontStyle: 'bold'
      }
    ).setOrigin(0.5, 0.5).setVisible(false);
    
    return { energyBg, energyBar, energyHint };
  }

  /**
   * 創建COMBO獎勵系統UI元素
   * 
   * 包含連擊數文字和進度條，顯示Hit streak和距離下個獎勵的進度
   * 位於Credit顯示右側，實現水平擴展佈局
   * 
   * @returns COMBO系統相關的UI元素
   */
  private createComboUI(): {
    comboText: Phaser.GameObjects.Text;
  } {
    const config = this.OVERHEAD_UI_CONFIG;
    // ★修復位置：Credit正上方，使用Credit的X座標
    const comboX = config.CREDIT.X + config.COMBO.X_OFFSET;
    const comboY = config.COMBO.Y;
    
    // ★修復文字：顯示"HIT x0"格式，增大字體
    const comboText = this.add.text(comboX, comboY, 'HIT x0', {
      fontFamily: 'monospace',
      fontSize: config.COMBO.FONT_SIZE,
      color: config.COLORS.COMBO_TEXT_NORMAL,
      stroke: config.COLORS.BLACK,
      strokeThickness: 2,  // ★增加描邊厚度，提高可見性
      fontStyle: 'bold'
    }).setOrigin(0.5, 0.5);
    
    // ★用戶反饋修復：完全移除COMBO進度條創建
    // 不再創建任何進度條元素，避免視覺干擾
    
    return { comboText };
  }

  /**
   * 繪製劍形圖標
   * 
   * 使用Graphics API繪製包含劍身、劍尖、護手、劍柄和底部裝飾的完整劍形
   * 支持正常和閃爍兩種視覺狀態
   * 
   * @param graphics 用於繪製的Graphics對象
   * @param isFlashing 是否為閃爍狀態（Credit耗盡時顯示紅色）
   */
  private drawSwordIcon(graphics: Phaser.GameObjects.Graphics, isFlashing: boolean): void {
    const config = this.OVERHEAD_UI_CONFIG;
    const swordConfig = config.SWORD;
    const colors = config.COLORS;
    
    // 選擇顏色：正常金色或閃爍紅色
    const fillColor = isFlashing ? colors.FLASH_RED : colors.SWORD_FILL;
    const strokeColor = isFlashing ? colors.FLASH_RED_BORDER : colors.SWORD_BORDER;
    
    graphics.clear();
    graphics.lineStyle(2, strokeColor, 1);
    graphics.fillStyle(fillColor, 1);
    
    // 劍身：中央垂直長方形
    graphics.fillRect(
      -swordConfig.BLADE_WIDTH / 2, 
      swordConfig.BLADE_Y, 
      swordConfig.BLADE_WIDTH, 
      swordConfig.BLADE_HEIGHT
    );
    
    // 劍尖：上方三角形
    graphics.fillTriangle(
      0, swordConfig.TIP_Y,                    // 頂點
      -swordConfig.BLADE_WIDTH / 2, swordConfig.BLADE_Y,  // 左下角
      swordConfig.BLADE_WIDTH / 2, swordConfig.BLADE_Y    // 右下角
    );
    
    // 護手：水平長方形
    graphics.fillRect(
      -swordConfig.GUARD_WIDTH / 2, 
      swordConfig.GUARD_Y, 
      swordConfig.GUARD_WIDTH, 
      swordConfig.GUARD_HEIGHT
    );
    
    // 劍柄：細長方形
    graphics.fillRect(
      -swordConfig.HANDLE_WIDTH / 2, 
      swordConfig.HANDLE_Y, 
      swordConfig.HANDLE_WIDTH, 
      swordConfig.HANDLE_HEIGHT
    );
    
    // 劍柄底部：裝飾圓形
    graphics.fillCircle(0, swordConfig.POMMEL_Y, swordConfig.POMMEL_RADIUS);
  }

  /**
   * 更新頭上UI內容：Credit顯示和能量條狀態
   * 
   * 根據角色數據和遊戲狀態實時更新UI顯示：
   * - Credit數字格式化和閃爍特效
   * - 劍形圖標顏色狀態  
   * - 能量條進度和視覺效果
   * - 操作提示的顯示/隱藏
   * 
   * @param character 角色統計數據
   * @param container UI容器，包含所有子元件的引用
   * @param stats 全局遊戲狀態數據
   */
  private updateOverheadUIContent(character: CharStat, container: Phaser.GameObjects.Container, stats: StatsPayload): void {
    // 獲取容器中的UI元件引用
    const creditText = (container as any).creditText as Phaser.GameObjects.Text;
    const swordIcon = (container as any).swordIcon as Phaser.GameObjects.Graphics;
    const energyBar = (container as any).energyBar as Phaser.GameObjects.Rectangle;
    const energyHint = (container as any).energyHint as Phaser.GameObjects.Text;
    const energyBg = (container as any).energyBg as Phaser.GameObjects.Rectangle;
    
    // 安全性檢查：確保所有必要的UI元件存在
    if (!creditText || !swordIcon || !energyBar) return;
    
    // 更新Credit顯示系統
    this.updateCreditDisplay(character, creditText, swordIcon);
    
    // 更新能量條系統（僅慢速模式玩家）
    this.updateEnergyDisplay(character, stats, energyBar, energyBg, energyHint, container);
    
    // ★階段三：更新COMBO獎勵系統
    this.updateComboDisplay(character, container);
  }

  /**
   * 更新Credit點數顯示
   * 
   * 包含數字格式化和耗盡時的閃爍特效
   * 
   * @param character 角色數據
   * @param creditText Credit數字文字對象
   * @param swordIcon 劍形圖標Graphics對象
   */
  private updateCreditDisplay(
    character: CharStat, 
    creditText: Phaser.GameObjects.Text, 
    swordIcon: Phaser.GameObjects.Graphics
  ): void {
    const config = this.OVERHEAD_UI_CONFIG;
    const creditValue = character.credit || 0;
    
    // 格式化為五位數字字串（前置補零）
    const creditStr = creditValue.toString().padStart(5, '0');
    creditText.setText(creditStr);
    
    // Credit耗盡閃爍特效
    if (creditValue === 0) {
      const flashTime = this.time.now % config.CREDIT.FLASH_CYCLE_MS;
      const isFlashing = flashTime < (config.CREDIT.FLASH_CYCLE_MS / 2);
      
      // 重繪劍圖標（閃爍狀態）
      this.drawSwordIcon(swordIcon, isFlashing);
      
      // 文字顏色同步閃爍
      creditText.setColor(isFlashing ? config.COLORS.TEXT_FLASH : config.COLORS.WHITE);
    } else {
      // 正常狀態：金色劍圖標和白色文字
      this.drawSwordIcon(swordIcon, false);
      creditText.setColor(config.COLORS.WHITE);
    }
  }

  /**
   * 更新二段能量條顯示
   * 
   * 包含進度條寬度、狀態顏色、脈動動畫和操作提示
   * 僅在慢速模式對玩家角色顯示
   * 
   * @param character 角色數據
   * @param stats 遊戲狀態數據  
   * @param energyBar 能量進度條對象
   * @param energyBg 能量條背景對象
   * @param energyHint 操作提示文字對象
   * @param container 容器對象（用於存儲上次能量值）
   */
  private updateEnergyDisplay(
    character: CharStat,
    stats: StatsPayload,
    energyBar: Phaser.GameObjects.Rectangle,
    energyBg: Phaser.GameObjects.Rectangle,
    energyHint: Phaser.GameObjects.Text,
    container: Phaser.GameObjects.Container
  ): void {
    const config = this.OVERHEAD_UI_CONFIG;
    const colors = config.COLORS;
    
    // 僅對慢速模式的玩家顯示能量條
    if (stats.controlMode === 'slow' && character.isPlayer) {
      energyBg.setVisible(true);
      energyBar.setVisible(true);
      
      const energy = stats.energy || 0;
      const energyMax = stats.energyMax || 10;
      const energyRatio = Math.max(0, Math.min(1, energy / energyMax));
      
      // 更新進度條寬度（96px = 100px容器 - 4px內邊距）
      const maxBarWidth = config.ENERGY.WIDTH - 4;
      energyBar.width = maxBarWidth * energyRatio;
      
      // 根據能量狀態選擇顏色
      let energyColor: number = colors.ENERGY_NORMAL;
      if (stats.empowered) {
        // 強化中：淺金色
        energyColor = colors.ENERGY_EMPOWERED;
      } else if (energy >= energyMax) {
        // 滿能量：閃爍效果
        const blinkTime = this.time.now % 400;
        energyColor = blinkTime < 200 ? colors.ENERGY_FULL : colors.ENERGY_NORMAL;
      }
      energyBar.setFillStyle(energyColor);
      
      // 能量增加時的脈動動畫效果
      const lastEnergy = (container as any).lastEnergy || 0;
      if (energy > lastEnergy) {
        energyBar.setScale(1, config.ENERGY.PULSE_SCALE);
        this.tweens.add({
          targets: energyBar,
          scaleY: 1,
          duration: config.ENERGY.PULSE_DURATION,
          ease: 'Power2'
        });
      }
      (container as any).lastEnergy = energy;
      
      // 滿能量且未強化時顯示操作提示
      if (energy >= energyMax && !stats.empowered) {
        energyHint.setVisible(true);
        energyHint.setText('Press Z');
        energyHint.setColor(colors.HINT_YELLOW);
      } else {
        energyHint.setVisible(false);
      }
    } else {
      // 非慢速模式或非玩家：隱藏能量條
      energyBg.setVisible(false);
      energyBar.setVisible(false);
      energyHint.setVisible(false);
    }
  }

  /**
   * ★階段三：更新角色頭頂的COMBO顯示（用戶反饋修復版）
   * 
   * **用戶反饋修復**：完全移除進度條邏輯，只保留COMBO數字顯示
   * 
   * 功能簡化：
   * - 顯示當前連擊數（HIT x數字格式）
   * - 警告狀態時文字顏色變化（橙色/紅色閃爍）
   * - 移除所有進度條相關邏輯，避免視覺干擾
   * 
   * @param character 角色數據，包含COMBO狀態
   * @param container 容器對象，包含COMBO UI元件引用
   */
  private updateComboDisplay(
    character: CharStat,
    container: Phaser.GameObjects.Container
  ): void {
    const comboText = (container as any).comboText as Phaser.GameObjects.Text;
    
    // 安全性檢查：只需檢查文字元件
    if (!comboText) return;
    
    const combo = character.combo;
    const config = this.OVERHEAD_UI_CONFIG;
    const colors = config.COLORS;
    
    // ★修復文字格式：使用"HIT x數字"格式
    comboText.setText(`HIT x${combo.currentStreak}`);
    
    // 根據警告狀態設置文字顏色
    if (combo.isWarning) {
      // 警告狀態：橙色和紅色交替閃爍
      const blinkTime = this.time.now % config.COMBO.WARNING_BLINK_MS;
      const isBlinking = blinkTime < (config.COMBO.WARNING_BLINK_MS / 2);
      const warningColor = isBlinking ? colors.COMBO_TEXT_CRITICAL : colors.COMBO_TEXT_WARNING;
      comboText.setColor(warningColor);
    } else if (combo.currentStreak === 0) {
      // 無連擊：隱藏COMBO文字，減少視覺混亂
      comboText.setVisible(false);
      return;
    } else {
      // 正常狀態：綠色文字
      comboText.setColor(colors.COMBO_TEXT_NORMAL);
    }
    
    // 確保文字可見
    comboText.setVisible(true);
  }

  /**
   * 更新頭上UI的螢幕位置
   * 
   * 根據角色的世界座標計算螢幕位置，考慮相機捲動偏移
   * 確保UI容器始終跟隨角色移動並顯示在正確位置
   * 
   * @param character 角色統計數據，包含世界座標
   * @param container UI容器對象
   * @param forceVisible 是否強制設置可見性，默認為true
   */
  private updateOverheadUI(character: CharStat, container: Phaser.GameObjects.Container, forceVisible = true): void {
    // 角色死亡時隱藏UI
    if (!character.alive) {
      container.setVisible(false);
      return;
    }
    
    // ★用戶要求調整：頭頂UI偏移值從-150調整為-130
    const worldX = character.x;
    const worldY = character.y - 130; // ★調整：從-150改為-130，向下移動20px
    
    // 座標系統轉換：世界座標 → 螢幕座標
    // UIScene使用固定相機，需要減去GameScene相機的捲動偏移
    const gameScene = this.scene.get('GameScene') as any;
    const gcam = gameScene?.cameras?.main;
    const screenX = worldX - (gcam?.scrollX || 0);
    const screenY = worldY - (gcam?.scrollY || 0);
    
    // 更新容器位置
    container.setPosition(screenX, screenY);
    
    // ★關鍵修復：只有在forceVisible為true時才設置可見性
    if (forceVisible) {
      container.setVisible(true);
    }
  }

  /**
   * ★場景層級確認：在UIScene中創建華麗彩票特效
   * 
   * 場景層級問題已確認解決，現在實現正式版華麗特效
   * 基於UIScene創建，但使用原始設計的視覺效果和物理模擬
   * 
   * @param worldX 角色世界座標X（需轉換為螢幕座標）
   * @param worldY 角色世界座標Y（需轉換為螢幕座標）
   * @param milestone 里程碑數值
   */
  spawnTicketBurstInUI(worldX: number, worldY: number, milestone: number): void {
    console.log(`🎯 [UIScene正式版] 華麗彩票特效 at world(${worldX}, ${worldY}), milestone: ${milestone}`);
    
    // 轉換世界座標為螢幕座標（考慮相機偏移）
    const gameScene = this.scene.get('GameScene') as any;
    const gcam = gameScene?.cameras?.main;
    const screenX = worldX - (gcam?.scrollX || 0);
    const screenY = worldY - (gcam?.scrollY || 0) - 130; // ★調整：與頭頂UI位置一致，角色頭上130px
    
    // 從配置讀取參數（恢復原始設計）
    const config = GameConfig.ticketEffect;
    
    // 計算彩票數量
    const ticketCount = Math.max(
      config.TIMING.TICKET_COUNT_BASE, 
      Math.min(
        config.TIMING.TICKET_COUNT_MAX, 
        config.TIMING.TICKET_COUNT_BASE + milestone * config.TIMING.TICKET_COUNT_MULTIPLIER
      )
    );
    
    console.log(`💸 [UIScene正式版] ${ticketCount} 華麗彩票 at screen(${screenX}, ${screenY})`);
    
    // 創建華麗彩票特效
    for (let i = 0; i < ticketCount; i++) {
      this.createFinalTicketParticle(screenX, screenY, config, milestone);
    }
    
    // 創建華麗閃光特效
    this.createFinalFlashEffect(screenX, screenY);
  }

  /**
   * 創建正式版華麗彩票粒子
   * 
   * 恢復原始設計：金色外觀、物理軌跡、拋物線運動
   * 但在UIScene中創建確保可見性
   */
  private createFinalTicketParticle(x: number, y: number, config: any, milestone: number): void {
    // 正式版視覺：金色彩票，合適尺寸
    const ticket = this.add.rectangle(
      x + (Math.random() - 0.5) * 20, // 隨機散布起始位置
      y, 
      config.VISUAL.WIDTH,      // 20px正式尺寸
      config.VISUAL.HEIGHT,     // 12px正式尺寸
      config.VISUAL.COLOR       // 0xFFD700金色
    )
      .setStrokeStyle(config.VISUAL.BORDER_WIDTH, config.VISUAL.BORDER_COLOR)
      .setDepth(config.VISUAL.DEPTH)
      .setVisible(true)
      .setAlpha(1);
    
    console.log(`🎫 [UIScene正式版] 金色彩票 ${config.VISUAL.WIDTH}×${config.VISUAL.HEIGHT}px at (${x}, ${y}) depth=${config.VISUAL.DEPTH}`);
    
    // 正式版物理：扇形噴發角度
    const angleRange = config.BURST_ANGLE.MAX - config.BURST_ANGLE.MIN;
    const angle = config.BURST_ANGLE.MIN + Math.random() * angleRange;
    const angleRad = Phaser.Math.DegToRad(angle);
    
    // 正式版速度：根據里程碑調整
    const velocityRange = (config.PHYSICS.MAX_VELOCITY + milestone * config.PHYSICS.VELOCITY_MAX_BONUS) - 
                         (config.PHYSICS.MIN_VELOCITY + milestone * config.PHYSICS.VELOCITY_MILESTONE_BONUS);
    const velocity = (config.PHYSICS.MIN_VELOCITY + milestone * config.PHYSICS.VELOCITY_MILESTONE_BONUS) + 
                    Math.random() * velocityRange;
    
    const vx = Math.cos(angleRad) * velocity;
    const vy = Math.sin(angleRad) * velocity;
    
    console.log(`🚀 [UIScene正式版] 物理參數: angle=${Math.round(angle)}°, velocity=${Math.round(velocity)}, vx=${Math.round(vx)}, vy=${Math.round(vy)}`);
    
    // 正式版生命週期
    const lifetime = config.TIMING.LIFETIME_BASE_MS + Math.random() * config.TIMING.LIFETIME_RANDOM_MS;
    
    // 實現完整物理模擬：拋物線運動 + 重力 + 自轉
    let currentVx = vx;
    let currentVy = vy;
    const startTime = this.time.now;
    
    const updateTicket = () => {
      const elapsed = this.time.now - startTime;
      
      // 生命週期檢查
      if (elapsed >= lifetime || !ticket.scene) {
        ticket.destroy();
        console.log(`🎫 [UIScene正式版] 彩票完成生命週期 ${elapsed}ms`);
        return;
      }
      
      // 重力影響Y軸速度
      const deltaTime = config.PHYSICS.FRAME_RATE_MS * 0.001;
      currentVy += config.PHYSICS.GRAVITY * deltaTime;
      
      // 更新位置（拋物線軌跡）
      ticket.x += currentVx * deltaTime;
      ticket.y += currentVy * deltaTime;
      
      // 自轉動畫
      ticket.rotation += config.PHYSICS.ROTATION_SPEED * 2 * Math.PI * deltaTime;
      
      // 邊界檢查（UIScene螢幕邊界）
      if (ticket.x < -config.BOUNDARIES.MARGIN_X || 
          ticket.x > GameConfig.width + config.BOUNDARIES.MARGIN_X || 
          ticket.y > GameConfig.height + config.BOUNDARIES.MARGIN_Y) {
        ticket.destroy();
        console.log(`🎫 [UIScene正式版] 彩票飛出邊界銷毀`);
        return;
      }
      
      // 繼續物理更新
      this.time.delayedCall(config.PHYSICS.FRAME_RATE_MS, updateTicket);
    };
    
    updateTicket();
  }

  /**
   * 創建正式版華麗閃光特效
   */
  private createFinalFlashEffect(x: number, y: number): void {
    // 正式版閃光：金色，快速擴張
    const flash = this.add.circle(x, y, 8, 0xFFD700, 0.8)
      .setDepth(2001)
      .setStrokeStyle(3, 0xFFFFFF, 1)
      .setVisible(true)
      .setAlpha(0.8);
    
    console.log(`✨ [UIScene正式版] 金色閃光 at (${x}, ${y}) depth=2001`);
    
    // 正式版動畫：快速擴張，華麗效果
    this.tweens.add({
      targets: flash,
      radius: 60,        // 擴張到60px
      alpha: 0,          // 漸變透明
      duration: 400,     // 400ms快速動畫
      ease: 'Power2',    // 自然曲線
      onComplete: () => {
        flash.destroy();
        console.log(`✨ [UIScene正式版] 閃光動畫完成`);
      }
    });
  }

  /**
   * ★正確的P1頭頂UI控制方法
   * 
   * 控制角色頭頂的overheadUI系統（Credit顯示和能量條）
   * 這是用戶看到的黃色"P1 61000"頭頂UI的正確控制方法
   * 
   * @param visible - true顯示P1頭頂UI，false隱藏P1頭頂UI
   */
  setP1HeadUIVisible(visible: boolean): void {
    console.log(`🎯 [頭頂UI控制] setP1HeadUIVisible被調用，visible=${visible}`);
    
    // 設置覆蓋模式標誌，防止updateStats()和updateOverheadUI()干擾
    this.isP1HeadUIHidden = !visible;
    console.log(`🎯 [頭頂UI控制] 覆蓋模式設為: ${this.isP1HeadUIHidden}`);
    
    // 獲取P1的頭頂UI容器 (P1索引為0)
    const p1Container = this.overheadUIs.get(0);
    
    if (p1Container) {
      // 直接設置可見性
      p1Container.setVisible(visible);
      console.log(`✅ [頭頂UI控制] P1頭頂UI已設置為: ${visible ? '顯示' : '隱藏'}`);
      console.log(`🎯 [頭頂UI控制] 實際可見性確認: ${p1Container.visible}`);
    } else {
      console.warn('⚠️ [頭頂UI控制] P1頭頂UI容器不存在，可能尚未創建');
      console.log(`🎯 [頭頂UI控制] 當前overheadUIs大小: ${this.overheadUIs.size}`);
    }
  }

  /**
   * ★多角色底部面板替換系統初始化
   * 
   * 創建1P、2P、3P、4P的底部面板覆蓋UI
   * - 每個角色使用獨立的覆蓋圖片 (1P.png, 2P.png, 3P.png, 4P.png)
   * - 精確定位到對應角色的原始面板位置
   * - 初始隱藏，由F4切換統一控制所有角色
   */
  private initMultiPlayerBottomPanelOverlays(): void {
    console.log('🔧 [多角色底部面板] 開始初始化多角色底部面板替換系統');
    
    const w = GameConfig.width;
    const h = GameConfig.height;
    
    // 🎯 計算所有角色面板的位置參數（與原始面板佈局一致）
    const count = GameConfig.characters.count;
    const panelW = 200;
    const panelH = 60;
    const panelGap = 12;
    const startX = (w - (count * panelW + (count - 1) * panelGap)) / 2; // 居中排列
    const rowTopY = h - 80;
    
    // 角色標籤和資源映射
    const playerLabels = ['1P', '2P', '3P', '4P'];
    const resourceKeys = ['bottom-panel-1P', 'bottom-panel-2P', 'bottom-panel-3P', 'bottom-panel-4P'];
    
    for (let i = 0; i < count; i++) {
      const playerLabel = playerLabels[i];
      const resourceKey = resourceKeys[i];
      
      console.log(`🔧 [多角色底部面板] 處理 ${playerLabel}, 資源key: ${resourceKey}`);
      console.log(`🔧 [多角色底部面板] ${resourceKey}紋理存在:`, this.textures.exists(resourceKey));
      
      if (this.textures.exists(resourceKey)) {
        // 檢查紋理是否成功載入
        const texture = this.textures.get(resourceKey);
        if (texture && texture.key !== '__MISSING') {
          // 🎯 計算當前角色面板的精確位置
          const playerPanelX = startX + i * (panelW + panelGap);
          const playerPanelY = rowTopY;
          const playerCenterX = playerPanelX + panelW / 2; // 面板中心X座標
          const playerCenterY = playerPanelY + panelH / 2; // 面板中心Y座標
          
          // 🎨 根據原始圖片尺寸設定顯示尺寸（假設所有角色UI尺寸一致）
          const originalW = 324; // 基於1P.png的尺寸
          const originalH = 166;
          const displayW = originalW;
          const displayH = originalH;
          
          // 創建角色底部面板覆蓋，精確對準該角色的原始面板位置
          this.bottomPanelOverlays[i] = this.add.image(playerCenterX, playerCenterY, resourceKey)
            .setOrigin(0.5, 0.5)
            .setDepth(1000 + i)  // 每個角色不同深度避免衝突
            .setVisible(false)
            .setScrollFactor(0)  // 固定位置，不隨相機移動
            .setDisplaySize(displayW, displayH);  // 🎨 保持原始尺寸比例
          
          console.log(`✅ [多角色底部面板] ${playerLabel}底部面板覆蓋已創建：位置(${playerCenterX}, ${playerCenterY}) 尺寸(${displayW}x${displayH}) (depth=${1000 + i}, hidden)`);
        } else {
          console.error(`❌ [多角色底部面板] ${playerLabel}紋理載入失敗或損壞`);
          this.bottomPanelOverlays[i] = null;
        }
      } else {
        console.warn(`⚠️ [多角色底部面板] ${playerLabel}底部面板覆蓋資源不存在：${playerLabel}.png`);
        console.log(`💡 [多角色底部面板] 請將${playerLabel}.png文件放入public/assets/目錄`);
        this.bottomPanelOverlays[i] = null;
      }
    }
    
    console.log('🔧 [多角色底部面板] 多角色底部面板替換系統初始化完成');
    console.log(`📐 [多角色底部面板] 面板佈局參數: count=${count}, panelW=${panelW}, panelH=${panelH}, startX=${startX}, rowTopY=${rowTopY}`);
  }

  /**
   * ★多角色底部面板替換控制方法
   * 
   * 控制所有角色底部狀態面板的顯示/隱藏，並切換多角色覆蓋UI
   * 
   * @param useOverlay - true顯示所有覆蓋並隱藏原始面板，false恢復所有原始面板
   */
  setBottomPanelOverlay(useOverlay: boolean): void {
    console.log(`🔧 [多角色底部面板] setBottomPanelOverlay被調用，useOverlay=${useOverlay}`);
    
    // 設置覆蓋模式標誌
    this.isBottomPanelOverlayMode = useOverlay;
    console.log(`🔧 [多角色底部面板] 覆蓋模式設為: ${this.isBottomPanelOverlayMode}`);
    
    const playerLabels = ['1P', '2P', '3P', '4P'];
    const count = GameConfig.characters.count;
    
    if (useOverlay) {
      // 激活所有角色的底部面板覆蓋
      for (let i = 0; i < count; i++) {
        const playerLabel = playerLabels[i];
        const playerOverlay = this.bottomPanelOverlays[i];
        
        if (playerOverlay) {
          playerOverlay.setVisible(true);
          console.log(`✅ [多角色底部面板] ${playerLabel}覆蓋已顯示`);
          
          // 隱藏對應的原始面板
          if (this.rows && this.rows.length > i) {
            const playerPanel = this.rows[i];
            this.setRowPanelVisible(playerPanel, false);
            console.log(`🔒 [多角色底部面板] 原始${playerLabel}底部面板已隱藏`);
          }
        } else {
          console.warn(`⚠️ [多角色底部面板] ${playerLabel}覆蓋不存在，保持原始面板顯示`);
          
          // 如果沒有覆蓋圖片，保持原始面板顯示
          if (this.rows && this.rows.length > i) {
            const playerPanel = this.rows[i];
            this.setRowPanelVisible(playerPanel, true);
            console.log(`✅ [多角色底部面板] 保持原始${playerLabel}底部面板顯示（覆蓋圖片不存在）`);
          }
        }
      }
    } else {
      // 關閉所有角色的底部面板覆蓋
      for (let i = 0; i < count; i++) {
        const playerLabel = playerLabels[i];
        const playerOverlay = this.bottomPanelOverlays[i];
        
        // 隱藏覆蓋UI
        if (playerOverlay) {
          playerOverlay.setVisible(false);
          console.log(`🔒 [多角色底部面板] ${playerLabel}覆蓋已隱藏`);
        }
        
        // 恢復原始底部面板
        if (this.rows && this.rows.length > i) {
          const playerPanel = this.rows[i];
          this.setRowPanelVisible(playerPanel, true);
          console.log(`✅ [多角色底部面板] 原始${playerLabel}底部面板已恢復`);
        }
      }
    }
  }

  /**
   * ★設置底部面板行的可見性（通用方法，適用所有角色）
   * 
   * @param panel - 面板對象 (rows中的元素)
   * @param visible - 是否可見
   */
  private setRowPanelVisible(panel: any, visible: boolean): void {
    if (!panel) return;
    
    // 設置底部面板的所有元素可見性（適用於任何角色）
    const elements = [
      panel.circle,        // 圓形標籤
      panel.labelText,     // 角色文字 (P1/BOT1等)
      panel.killIconText,  // 💀圖案
      panel.killText,      // 擊殺數字
      panel.ticketIconText,// 🎫圖案
      panel.ticketText,    // 彩票數字
      panel.panelBg,       // 背景面板
      panel.killBox,       // 💀小框
      panel.ticketBox      // 🎫彩票數小框
    ];
    
    elements.forEach((element, index) => {
      if (element && typeof element.setVisible === 'function') {
        element.setVisible(visible);
        console.log(`  [底部面板] 元素${index}設置為${visible ? '可見' : '隱藏'}`);
      }
    });
  }
}
