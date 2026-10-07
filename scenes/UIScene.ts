import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { StageNodeKind } from '../systems/stageQueue';

/** 卷軸 HUD 節點狀態類型 */
type StageNodeState = 'current' | 'pending' | 'done';

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

/** 頭上能量條的 UI 元件組（由 createEnergyUI 建立、updateEnergyDisplay 更新） */
interface EnergyUIElements {
  /** 背景框（半透明黑底 + 金色外框） */
  bg: Phaser.GameObjects.Rectangle;
  /** 進度條（從左往右填充） */
  bar: Phaser.GameObjects.Rectangle;
  /** 集滿時在進度條上來回掃過的亮光 */
  shine: Phaser.GameObjects.Rectangle;
  /** 集滿時顯示在量條右方的操作提示 */
  hint: Phaser.GameObjects.Text;
  /** 進度條外發光（WebGL postFX；Canvas 渲染時為 null，僅少了光暈） */
  glowFx: Phaser.FX.Glow | null;
}

interface StatsPayload {
  chars: CharStat[];
  teamKills: number;
  survivalMs: number;
  playerBurstReady: boolean;
  count: number;
  maxCount: number;
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
  /** 小關卡卷軸 HUD：目前關卡編號、擊殺進度、本關起的寶箱階級（長度 = waveHud.visibleStages） */
  stage?: number;
  stageKilled?: number;
  stageQuota?: number;
  stageChests?: StageNodeKind[];
  progressPhase?: string;
  crossingOpen?: boolean;
  /** v31/v55 連段(招式)系統 */
  controlMode: string;
  combo: number;
  comboMax: number;
  comboThresholds: { circle: number; line: number; burst: number; empower: number };
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
  /** 小關卡卷軸 HUD（4 圓點 + 量條）：Graphics 每幀重繪 */
  private waveHudGfx!: Phaser.GameObjects.Graphics;
  /** 卷軸 HUD 是否顯示（關卡制才顯示） */
  private stageHudShow = false;
  /** 卷軸 HUD 目前顯示的關卡編號（變大 = 進入下一關，觸發遞補動畫） */
  private stageHudStage = 0;
  /** 本關擊殺進度：目前畫出的比例（每幀平滑逼近 target）與目標比例，0..1 */
  private stageHudFill = 0;
  private stageHudFillTarget = 0;
  /** 位置標記右邊的寶箱階級：[0] = 本關獎勵（下一個要獲得的寶箱） */
  private stageHudChests: StageNodeKind[] = [];
  /** 剛獲得的寶箱階級（遞補動畫中，該寶箱在位置標記處淡出、轉為新的位置標記） */
  private stageHudPrevChest: StageNodeKind | null = null;
  /** 問號揭曉動畫開始時間（目前關卡的「?」翻成寶箱）；動畫時長見 waveHud.revealMs */
  private stageHudRevealAt = -Infinity;
  /** 問號節點的「?」文字（Graphics 畫不了字，每幀依序取用、未用到的隱藏） */
  private stageHudMysteryTexts: Phaser.GameObjects.Text[] = [];
  private stageHudMysteryUsed = 0;
  /** 遞補動畫開始時間（scene time）；動畫時長見 waveHud.shiftMs */
  private stageHudShiftAt = -Infinity;
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

  /** 下方面板 COMBO 文字（HIT xN），每個角色一個，索引對應 rows */
  private panelComboTexts: Phaser.GameObjects.Text[] = [];
  /** 下方面板 COMBO 顯示設定：文字右下角對齊面板右上角（加偏移），原版色塊面板與 F4 面板圖各有一組偏移 */
  private readonly PANEL_COMBO_CONFIG = {
    FONT_SIZE: '36px',
    STROKE_WIDTH: 4,
    /** 原版色塊面板：相對面板右上角的偏移（貼在面板右上方） */
    CLASSIC_OFFSET_X: 0,
    CLASSIC_OFFSET_Y: -2,
    /** F4 面板圖：相對面板圖右上角的偏移（面板圖上緣有透明留白，文字落在寶箱上方） */
    OVERLAY_OFFSET_X: -8,
    OVERLAY_OFFSET_Y: 30,
    /** 高於 F4 面板圖（depth 1000+i） */
    DEPTH: 1010,
    /** 警告狀態橙紅交替閃爍週期 */
    WARNING_BLINK_MS: GameConfig.comboReward.WARNING_BLINK_MS,
    /** 報獎特效（彩票噴發/閃光/獲得文字）相對 COMBO 文字錨點（面板右上角）的偏移：往左移到文字中央附近、往上一點 */
    REWARD_FX_OFFSET_X: -60,
    REWARD_FX_OFFSET_Y: -20,
    /** 「獲得N票券！」文字樣式與動畫 */
    REWARD_TEXT_FONT_SIZE: '42px',
    REWARD_TEXT_STROKE_WIDTH: 4,
    REWARD_TEXT_DEPTH: 1500,
    REWARD_TEXT_RISE: 90,
    REWARD_TEXT_SCALE_TO: 1.3,
    REWARD_TEXT_DURATION_MS: 2000,
    /** 報獎閃光起始半徑（像素） */
    REWARD_FLASH_START_RADIUS: 12,
    /** 報獎閃光擴張最大半徑（像素） */
    REWARD_FLASH_END_RADIUS: 90
  } as const;
  
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
      Y_OFFSET: 27,         // 量條中心距 Credit 中心的垂直距離（緊貼 Credit 下方）
      WIDTH: 140,
      HEIGHT: 14,
      BORDER_WIDTH: 2,
      /** 背景框底色透明度 */
      BG_ALPHA: 0.6,
      /** 進度條相對外框的內縮（=外框粗細），集滿時剛好填滿框內 */
      BAR_INSET: 2,
      /** 提示文字與量條右緣的水平間距 */
      HINT_GAP_X: 8,
      HINT_FONT_SIZE: '18px',
      HINT_STROKE_WIDTH: 3,
      HINT_TEXT: '按Z變身',
      /** 提示文字脈動縮放幅度（1 ± 此值） */
      HINT_PULSE_AMPLITUDE: 0.12,
      /** 能量增加時進度條的縱向脈動倍率與時長 */
      PULSE_SCALE: 1.6,
      PULSE_DURATION: 200,
      /** 集滿特效（光暈/外框/提示）的脈動週期 */
      GLOW_CYCLE_MS: 600,
      /** 外發光強度：集滿時在 MIN~MAX 間脈動，強化中（能量倒退）固定 EMPOWERED */
      GLOW_STRENGTH_MIN: 2,
      GLOW_STRENGTH_MAX: 10,
      GLOW_STRENGTH_EMPOWERED: 2,
      /** 外發光的取樣品質與擴散距離（postFX Glow 參數） */
      GLOW_QUALITY: 0.1,
      GLOW_DISTANCE: 16,
      /** 掃光寬度、掃過一次的時間、透明度 */
      SHINE_WIDTH: 20,
      SHINE_CYCLE_MS: 900,
      SHINE_ALPHA: 0.75
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
      ENERGY_GLOW: 0xfff3a0 as const,
      ENERGY_SHINE: 0xffffff as const,
      ENERGY_BORDER_GLOW: 0xffffff as const,
      // ★階段三：COMBO系統顏色
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
    // F4 覆蓋模式隨 GameScene 重開回到預設(關閉),否則重開後 P1 頭頂 UI 會維持隱藏
    this.isP1HeadUIHidden = false;
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

    // 小關卡卷軸 HUD（4 圓點 + 量條）：固定螢幕、每幀依 stats 重繪，預設隱藏
    this.waveHudGfx = this.add.graphics()
      .setScrollFactor(0)
      .setDepth(25)
      .setVisible(false);
    // 「?」文字池：最多同時畫 visibleStages + 1 個（含揭曉動畫中的那一個）
    this.stageHudMysteryTexts = Array.from({ length: GameConfig.waveHud.visibleStages + 1 }, () =>
      this.add.text(0, 0, '?', {
        fontFamily: 'monospace', fontSize: GameConfig.waveHud.mysteryFontSize, color: GameConfig.waveHud.mysteryTextColor, fontStyle: 'bold'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(26).setVisible(false)
    );

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
    
    // 原始狀態列使用較小的尺寸（保持原有設計）
    const statusPanelW = 200; 
    const statusPanelH = 60;
    
    // 計算適當間距，讓4個狀態面板平均分佈
    const availableWidth = w - 100;
    const totalStatusPanelWidth = count * statusPanelW;
    const totalGapWidth = availableWidth - totalStatusPanelWidth;
    const statusPanelGap = Math.max(20, totalGapWidth / (count + 1));
    
    const statusStartX = (w - (count * statusPanelW + (count - 1) * statusPanelGap)) / 2;
    const rowTopY = h - 130; // 向上調整：從h-100改為h-130
    
    // 🎨 移除黑色統一底圖 - 根據用戶要求
    // this.add
    //   .rectangle(statusStartX - 8, rowTopY - 8, count * statusPanelW + (count - 1) * statusPanelGap + 16, statusPanelH + 16, 0x000000, 0.6)
    //   .setOrigin(0, 0)
    //   .setStrokeStyle(2, 0x444444, 0.8)
    //   .setDepth(18); // 在所有元素下方
    
    for (let i = 0; i < count; i++) {
      const x = statusStartX + i * (statusPanelW + statusPanelGap);
      const color = GameConfig.characters.colors[i];
      const label = GameConfig.characters.labels[i];
      
      // 🎨 個別角色狀態背景 - 配合角色顏色，不透明
      const panelBg = this.add
        .rectangle(x, rowTopY, statusPanelW, statusPanelH, color, 1.0) // 使用角色顏色，完全不透明
        .setOrigin(0, 0)
        .setStrokeStyle(1, 0xffffff, 0.8) // 白色邊框
        .setDepth(19);
      
      // 🔵 左側圓形標籤 (24px半徑，白邊框，角色識別色填充)
      const circleX = x + 24;
      const circleY = rowTopY + statusPanelH / 2;
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

    // 下方面板 COMBO 文字（需在 rows 與 F4 面板圖建立後，才能對齊兩種面板）
    this.createPanelComboTexts();

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
    // 卷軸 HUD：這裡只記錄狀態，實際繪製在 update() 每幀跑（脈動、量條平滑、遞補動畫）
    this.updateStageHudState(s);

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
      this.updatePanelCombo(i, s.chars[i]);
      
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
    if (!this.stageHudShow) return;
    // 量條平滑推進：每殺一隻怪目標前進一點，畫面以 lineFillMs 填滿一整段的速率逼近
    const rate = delta / Math.max(1, GameConfig.waveHud.lineFillMs);
    if (this.stageHudFill < this.stageHudFillTarget) {
      this.stageHudFill = Math.min(this.stageHudFillTarget, this.stageHudFill + rate);
    } else {
      this.stageHudFill = this.stageHudFillTarget;
    }
    this.drawStageHud();
    this.waveHudGfx.setVisible(true);
  }

  /**
   * 依 stats 更新卷軸 HUD 狀態：關卡編號變大時記下剛完成的寶箱並啟動遞補動畫、量條歸零
   *
   * @param s 遊戲狀態
   */
  private updateStageHudState(s: StatsPayload): void {
    this.stageHudShow = !!(GameConfig.waveHud.enabled && s.levelMode && s.stage && s.stageChests);
    if (!this.stageHudShow) {
      this.waveHudGfx.setVisible(false);
      for (const t of this.stageHudMysteryTexts) t.setVisible(false);
      return;
    }
    const stage = s.stage!;
    if (stage > this.stageHudStage) {
      // 獲得寶箱、進入下一關：全部左移一格，剛獲得的寶箱轉為位置標記、最右生成新寶箱
      if (this.stageHudStage > 0) {
        this.stageHudPrevChest = this.stageHudChests[0] ?? null;
        this.stageHudShiftAt = this.time.now;
      }
      this.stageHudFill = 0;
    }
    else if (this.stageHudChests[0] === 'mystery' && s.stageChests![0] !== 'mystery') {
      // 同一關內目前關卡的「?」變成寶箱 → 問號揭曉動畫
      this.stageHudRevealAt = this.time.now;
    }
    this.stageHudStage = stage;
    this.stageHudChests = s.stageChests!;
    // 過場（尚未開打）時 waveKilled 可能殘留上一關的值，只有在生怪/清場階段才採計進度
    const active = s.waveState === 'spawning' || s.waveState === 'clearing';
    const quota = s.stageQuota ?? 0;
    this.stageHudFillTarget = active && quota > 0 ? Phaser.Math.Clamp((s.stageKilled ?? 0) / quota, 0, 1) : 0;
  }

  /**
   * 繪製小關卡卷軸 HUD（地圖式進度）：最左 = 目前位置標記，右邊依序為接下來的寶箱
   * （第 1 個 = 本關獎勵，脈動高亮；共 visibleStages 個，涵蓋一整輪所以永遠看得到一個高階）。
   * 位置標記 → 第 1 個寶箱之間的量條 = 本關擊殺進度，填滿即獲得該寶箱。
   * 遞補動畫：全部往左滑一格，舊位置標記淡出、剛獲得的寶箱淡出並轉為新的位置標記、最右新寶箱淡入。
   */
  private drawStageHud(): void {
    const cfg = GameConfig.waveHud;
    const g = this.waveHudGfx;
    g.clear();
    this.stageHudMysteryUsed = 0;
    const chestCount = this.stageHudChests.length;
    const nodeCount = chestCount + 1; // 位置標記 + 寶箱
    const gap = cfg.nodeGap;
    const startX = cfg.x - ((nodeCount - 1) * gap) / 2;
    const y = cfg.y;
    // 遞補動畫進度 e：0 = 剛獲得寶箱（圓點還在右邊一格）→ 1 = 到定位
    const e = Phaser.Math.Easing.Cubic.Out(Phaser.Math.Clamp((this.time.now - this.stageHudShiftAt) / cfg.shiftMs, 0, 1));
    const slide = (1 - e) * gap;
    const xAt = (slot: number): number => startX + slot * gap + slide;
    const animating = e < 1;

    // 1) 量條：slot -1→0 為剛走完的那段（動畫中淡出）；0→1 為本關進度；最右段隨新寶箱淡入
    for (let i = -1; i < nodeCount - 1; i++) {
      if (i === -1 && !animating) continue;
      const alpha = i === -1 ? 1 - e : i === nodeCount - 2 ? e : 1;
      const x1 = xAt(i), x2 = xAt(i + 1);
      g.lineStyle(cfg.lineThickness, cfg.lineColor, cfg.pulse.lineAlpha * alpha);
      g.lineBetween(x1, y, x2, y);
      const fill = i === -1 ? 1 : i === 0 ? this.stageHudFill : 0;
      if (fill > 0) {
        g.lineStyle(cfg.lineThickness, cfg.lineFillColor, alpha);
        g.lineBetween(x1, y, x1 + (x2 - x1) * fill, y);
      }
    }

    // 2) 位置標記：舊標記在最左淡出；新標記在剛獲得的寶箱位置淡入
    if (animating) this.drawStageMarker(xAt(-1), y, 1 - e);
    this.drawStageMarker(xAt(0), y, animating ? e : 1);
    if (animating && this.stageHudPrevChest) this.drawStageNode(xAt(0), y, this.stageHudPrevChest, 'done', 1 - e);

    // 3) 寶箱：第 1 個 = 本關獎勵（高亮），最右（新生成）淡入
    const revealT = Phaser.Math.Clamp((this.time.now - this.stageHudRevealAt) / cfg.revealMs, 0, 1);
    for (let i = 0; i < chestCount; i++) {
      const alpha = i === chestCount - 1 ? e : 1;
      const state: StageNodeState = i === 0 ? 'current' : 'pending';
      if (i === 0 && revealT < 1 && this.stageHudChests[0] !== 'mystery') {
        this.drawRevealNode(xAt(1), y, this.stageHudChests[0], revealT, alpha);
        continue;
      }
      this.drawStageNode(xAt(i + 1), y, this.stageHudChests[i], state, alpha);
    }
    // 本幀沒用到的「?」文字隱藏
    for (let i = this.stageHudMysteryUsed; i < this.stageHudMysteryTexts.length; i++) this.stageHudMysteryTexts[i].setVisible(false);
  }

  /**
   * 畫卷軸 HUD 的目前位置標記：不透明底盤 + 實心亮點 + 脈動外環
   *
   * @param x 圓心 x（螢幕座標）
   * @param y 圓心 y（螢幕座標）
   * @param alpha 整體透明度（遞補動畫淡入淡出）
   */
  private drawStageMarker(x: number, y: number, alpha: number): void {
    if (alpha <= 0) return;
    const cfg = GameConfig.waveHud;
    const g = this.waveHudGfx;
    const r = cfg.nodeRadius;
    const pulse = cfg.pulse.base + cfg.pulse.amplitude * Math.abs(Math.sin(this.time.now / cfg.pulse.period));
    g.fillStyle(cfg.nodeBgColor, alpha);
    g.fillCircle(x, y, r + cfg.nodePadding.base);
    g.fillStyle(cfg.markerColor, alpha);
    g.fillCircle(x, y, r * cfg.markerDotScale);
    g.lineStyle(cfg.nodeStrokeWidth.current, cfg.markerColor, pulse * alpha);
    g.strokeCircle(x, y, r);
  }

  /**
   * 畫一個卷軸 HUD 圓點與其中的寶箱圖示
   *
   * @param x 圓心 x（螢幕座標）
   * @param y 圓心 y（螢幕座標）
   * @param chest 寶箱階級
   * @param state 'current' 本關獎勵（脈動高亮）/ 'pending' 之後的關卡 / 'done' 剛獲得（轉為位置標記時淡出）
   * @param alpha 整體透明度（遞補動畫淡入淡出）
   */
  private drawStageNode(x: number, y: number, chest: StageNodeKind, state: StageNodeState, alpha: number): void {
    if (alpha <= 0) return;
    const cfg = GameConfig.waveHud;
    const g = this.waveHudGfx;
    const r = cfg.nodeRadius;
    if (chest === 'mystery') {
      this.drawMysteryNode(x, y, state, alpha);
      return;
    }
    const high = chest === 'high';
    const pulse = cfg.pulse.base + cfg.pulse.amplitude * Math.abs(Math.sin(this.time.now / cfg.pulse.period));
    // 不透明底盤蓋住量條端點
    g.fillStyle(cfg.nodeBgColor, alpha);
    g.fillCircle(x, y, r + cfg.nodePadding.base);
    if (state === 'current') {
      g.fillStyle(this.mixColor(cfg.nodeBgColor, cfg.currentColor, pulse * cfg.pulse.currentMix), alpha);
      g.fillCircle(x, y, r);
      g.lineStyle(cfg.nodeStrokeWidth.current, cfg.currentColor, (0.5 + 0.5 * pulse) * alpha);
      g.strokeCircle(x, y, r + cfg.nodePadding.currentPulse);
    } else {
      g.fillStyle(0x000000, alpha);
      g.fillCircle(x, y, r);
      g.lineStyle(cfg.nodeStrokeWidth.normal, state === 'done' ? cfg.doneColor : cfg.pendingColor, alpha);
      g.strokeCircle(x, y, r);
    }
    // 高階寶箱：外圈金色光暈（脈動）
    if (high) {
      g.lineStyle(cfg.nodeStrokeWidth.normal, cfg.highChestColor, (cfg.pulse.haloAlphaBase + cfg.pulse.haloAlphaAmplitude * pulse) * alpha);
      g.strokeCircle(x, y, r + cfg.nodePadding.highHalo);
    }
    this.drawChestIcon(x, y, chest, alpha);
  }

  /**
   * 畫寶箱圖示：箱體 + 箱蓋 + 鎖扣（高階較大、金色）
   *
   * @param x 中心 x（螢幕座標）
   * @param y 中心 y（螢幕座標）
   * @param tier 寶箱階級
   * @param alpha 透明度
   * @param scaleX 水平縮放（揭曉翻轉動畫用；1 = 原寬）
   */
  private drawChestIcon(x: number, y: number, tier: 'low' | 'high', alpha: number, scaleX = 1): void {
    const cfg = GameConfig.waveHud;
    const g = this.waveHudGfx;
    const high = tier === 'high';
    const size = cfg.nodeRadius * (high ? cfg.highChestScale : cfg.lowChestScale);
    const w = size * cfg.chestRatios.aspectRatio * scaleX, h = size;
    const bodyColor = high ? cfg.highChestColor : cfg.lowChestColor;
    g.fillStyle(bodyColor, alpha);
    g.fillRect(x - w / 2, y - h / 2 + h * cfg.chestRatios.bodyStart, w, h * cfg.chestRatios.bodyHeight);      // 箱體
    g.fillStyle(this.mixColor(bodyColor, 0xffffff, cfg.chestRatios.lidBrighten), alpha);
    g.fillRect(x - w / 2, y - h / 2, w, h * cfg.chestRatios.lidHeight);                   // 箱蓋（略亮）
    g.lineStyle(cfg.nodeStrokeWidth.chest, cfg.chestOutlineColor, alpha);
    g.strokeRect(x - w / 2, y - h / 2, w, h);
    g.fillStyle(cfg.chestOutlineColor, alpha);
    g.fillRect(x - w * cfg.chestRatios.lockOffsetX, y - h * cfg.chestRatios.lockOffsetY, w * cfg.chestRatios.lockWidth, h * cfg.chestRatios.lockHeight);      // 鎖扣
  }

  /**
   * 問號揭曉動畫：先「圓圈亮起來」（白光漲滿 + 外環擴散），再水平翻轉——「?」壓扁消失、寶箱從中間展開；
   * 揭曉為高階時翻開後多一圈金色光環
   *
   * @param x 圓心 x（螢幕座標）
   * @param y 圓心 y（螢幕座標）
   * @param tier 揭曉結果
   * @param t 動畫進度 0..1（revealMs 內）
   * @param alpha 整體透明度
   */
  private drawRevealNode(x: number, y: number, tier: StageNodeKind, t: number, alpha: number): void {
    if (tier === 'mystery') return;
    const cfg = GameConfig.waveHud;
    const g = this.waveHudGfx;
    const r = cfg.nodeRadius;
    const glowEnd = cfg.revealGlowPortion;
    g.fillStyle(cfg.nodeBgColor, alpha);
    g.fillCircle(x, y, r + cfg.nodePadding.base);
    if (t < glowEnd) {
      // 1) 亮起來：問號圓 + 白光由弱到強、外環擴散
      const p = t / glowEnd;
      this.drawMysteryNode(x, y, 'current', alpha);
      g.fillStyle(0xffffff, alpha * p * cfg.revealGlowAlpha);
      g.fillCircle(x, y, r);
      g.lineStyle(cfg.nodeStrokeWidth.current, cfg.mysteryRingColor, alpha * (1 - p));
      g.strokeCircle(x, y, r * (1 + p * cfg.revealRingScale));
      return;
    }
    // 2) 翻轉：寬度依 |cos| 收縮再展開，前半段是「?」、後半段是寶箱
    const u = (t - glowEnd) / (1 - glowEnd);
    const sx = Math.max(0.02, Math.abs(Math.cos(u * Math.PI)));
    if (u < 0.5) {
      g.fillStyle(cfg.mysteryColor, alpha);
      g.fillEllipse(x, y, r * 2 * sx, r * 2);
      g.fillStyle(0xffffff, alpha * cfg.revealGlowAlpha);
      g.fillEllipse(x, y, r * 2 * sx, r * 2);
      const text = this.stageHudMysteryTexts[this.stageHudMysteryUsed++];
      if (text) text.setPosition(x, y).setAlpha(alpha).setScale(sx, 1).setVisible(true);
      return;
    }
    const pulse = cfg.pulse.base + cfg.pulse.amplitude * Math.abs(Math.sin(this.time.now / cfg.pulse.period));
    g.fillStyle(this.mixColor(cfg.nodeBgColor, cfg.currentColor, pulse * cfg.pulse.currentMix), alpha);
    g.fillEllipse(x, y, r * 2 * sx, r * 2);
    this.drawChestIcon(x, y, tier, alpha, sx);
    if (tier === 'high') {
      g.lineStyle(cfg.nodeStrokeWidth.current, cfg.highChestColor, alpha * (u - 0.5) * 2);
      g.strokeCircle(x, y, r + cfg.nodePadding.highHalo);
    }
  }

  /**
   * 畫問號節點：紫色圓 + 「?」文字（揭曉前不知道是低階或高階）
   *
   * @param x 圓心 x（螢幕座標）
   * @param y 圓心 y（螢幕座標）
   * @param state 節點狀態（current 有脈動外框）
   * @param alpha 整體透明度
   */
  private drawMysteryNode(x: number, y: number, state: StageNodeState, alpha: number): void {
    const cfg = GameConfig.waveHud;
    const g = this.waveHudGfx;
    const r = cfg.nodeRadius;
    const pulse = cfg.pulse.base + cfg.pulse.amplitude * Math.abs(Math.sin(this.time.now / cfg.pulse.period));
    g.fillStyle(cfg.nodeBgColor, alpha);
    g.fillCircle(x, y, r + cfg.nodePadding.base);
    g.fillStyle(cfg.mysteryColor, alpha);
    g.fillCircle(x, y, r);
    g.lineStyle(cfg.nodeStrokeWidth.normal, cfg.mysteryRingColor, alpha);
    g.strokeCircle(x, y, r);
    if (state === 'current') {
      g.lineStyle(cfg.nodeStrokeWidth.current, cfg.mysteryRingColor, pulse * alpha);
      g.strokeCircle(x, y, r + cfg.nodePadding.currentPulse);
    }
    const text = this.stageHudMysteryTexts[this.stageHudMysteryUsed++];
    if (text) text.setPosition(x, y).setAlpha(alpha).setScale(1).setVisible(true);
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

    // 純圓盤，無方向指示
  };

  /** ★頭上UI系統：創建跟隨角色的UI容器 */
  private createOverheadUISystem(): void {
    // 暫時不創建，等待角色數據傳入後再創建
    // 在updateStats中檢測角色並創建對應的頭上UI
  }

  /**
   * 創建單個角色的頭上UI容器
   * 
   * 包含兩層UI元素（從上到下）：
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
    const energyUI = this.createEnergyUI();
    
    // 添加所有元素到容器
    container.add([
      badge, badgeText, creditBg, swordIcon, creditText,
      energyUI.bg, energyUI.bar, energyUI.shine, energyUI.hint
    ]);
    
    // 設置子元件引用，便於後續更新
    (container as any).creditText = creditText;
    (container as any).swordIcon = swordIcon;
    (container as any).energyUI = energyUI;
    
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
   * 由下到上：背景框 → 進度條（含外發光）→ 掃光，提示文字在量條右方；僅在慢速模式對玩家顯示
   *
   * @returns 能量條相關的UI元素
   */
  private createEnergyUI(): EnergyUIElements {
    const config = this.OVERHEAD_UI_CONFIG;
    const e = config.ENERGY;
    const colors = config.COLORS;
    const energyX = config.CREDIT.X;
    const energyY = config.CREDIT.Y + e.Y_OFFSET;
    const barLeft = energyX - e.WIDTH / 2 + e.BAR_INSET;
    const barHeight = e.HEIGHT - e.BAR_INSET * 2;

    // 能量條背景框
    const bg = this.add.rectangle(energyX, energyY, e.WIDTH, e.HEIGHT, colors.BACKGROUND, e.BG_ALPHA)
      .setStrokeStyle(e.BORDER_WIDTH, colors.BORDER_GOLD);

    // 能量進度條（從框內左緣開始填充）
    const bar = this.add.rectangle(barLeft, energyY, 0, barHeight, colors.ENERGY_NORMAL)
      .setOrigin(0, 0.5);
    // 外發光：強度 0 = 不發光，由 updateEnergyDisplay 依狀態調整（postFX 只在 WebGL 可用）
    const glowFx = bar.postFX?.addGlow(colors.ENERGY_GLOW, 0, 0, false, e.GLOW_QUALITY, e.GLOW_DISTANCE) ?? null;

    // 集滿掃光（ADD 混色，平時隱藏）
    const shine = this.add.rectangle(barLeft, energyY, e.SHINE_WIDTH, barHeight, colors.ENERGY_SHINE, e.SHINE_ALPHA)
      .setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);

    // 滿能量時的操作提示（量條右方）
    const hint = this.add.text(
      energyX + e.WIDTH / 2 + e.HINT_GAP_X,
      energyY,
      e.HINT_TEXT,
      {
        fontFamily: 'monospace',
        fontSize: e.HINT_FONT_SIZE,
        color: colors.HINT_YELLOW,
        stroke: colors.BLACK,
        strokeThickness: e.HINT_STROKE_WIDTH,
        fontStyle: 'bold'
      }
    ).setOrigin(0, 0.5).setVisible(false);

    return { bg, bar, shine, hint, glowFx };
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
    const energyUI = (container as any).energyUI as EnergyUIElements | undefined;
    
    // 安全性檢查：確保所有必要的UI元件存在
    if (!creditText || !swordIcon || !energyUI) return;
    
    // 更新Credit顯示系統
    this.updateCreditDisplay(character, creditText, swordIcon);
    
    // 更新能量條系統（僅慢速模式玩家）
    this.updateEnergyDisplay(character, stats, energyUI, container);
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
   * 包含進度條寬度、狀態顏色、能量增加脈動，以及集滿時的光暈/掃光/外框發亮/操作提示；
   * 僅在慢速模式對玩家角色顯示
   *
   * @param character 角色數據
   * @param stats 遊戲狀態數據
   * @param ui 能量條 UI 元件組
   * @param container 容器對象（用於存儲上次能量值）
   */
  private updateEnergyDisplay(
    character: CharStat,
    stats: StatsPayload,
    ui: EnergyUIElements,
    container: Phaser.GameObjects.Container
  ): void {
    const config = this.OVERHEAD_UI_CONFIG;
    const e = config.ENERGY;
    const colors = config.COLORS;

    // 僅對慢速模式的玩家顯示能量條
    if (stats.controlMode !== 'slow' || !character.isPlayer) {
      for (const obj of [ui.bg, ui.bar, ui.shine, ui.hint]) obj.setVisible(false);
      return;
    }
    ui.bg.setVisible(true);
    ui.bar.setVisible(true);

    const energy = stats.energy || 0;
    const energyMax = stats.energyMax || 1;
    const energyRatio = Phaser.Math.Clamp(energy / energyMax, 0, 1);
    // 集滿（可按 Z 變身）：達觸發門檻且尚未強化
    const ready = energy >= (stats.energyTrigger || energyMax) && !stats.empowered;

    // 進度條寬度：框內寬度 × 比例（集滿時剛好填滿框內，不留黑邊）
    const maxBarWidth = e.WIDTH - e.BAR_INSET * 2;
    ui.bar.width = maxBarWidth * energyRatio;
    ui.bar.setFillStyle(stats.empowered ? colors.ENERGY_EMPOWERED : ready ? colors.ENERGY_FULL : colors.ENERGY_NORMAL);

    // 能量增加時的脈動動畫效果
    const lastEnergy = (container as any).lastEnergy || 0;
    if (energy > lastEnergy) {
      ui.bar.setScale(1, e.PULSE_SCALE);
      this.tweens.add({ targets: ui.bar, scaleY: 1, duration: e.PULSE_DURATION, ease: 'Power2' });
    }
    (container as any).lastEnergy = energy;

    // 集滿特效：以時間驅動的正弦波（-1~1）同步光暈、外框、提示的脈動
    const wave = Math.sin((this.time.now / e.GLOW_CYCLE_MS) * Math.PI * 2);
    if (ready) {
      const t = (wave + 1) / 2;
      if (ui.glowFx) ui.glowFx.outerStrength = e.GLOW_STRENGTH_MIN + (e.GLOW_STRENGTH_MAX - e.GLOW_STRENGTH_MIN) * t;
      ui.bg.setStrokeStyle(e.BORDER_WIDTH, wave > 0 ? colors.ENERGY_BORDER_GLOW : colors.BORDER_GOLD);
      this.updateEnergyShine(ui.shine, ui.bar.x, maxBarWidth);
      ui.hint.setVisible(true).setScale(1 + e.HINT_PULSE_AMPLITUDE * wave);
    } else {
      // 強化中保留微弱光暈表示能量正在消耗；其餘狀態關閉特效
      if (ui.glowFx) ui.glowFx.outerStrength = stats.empowered ? e.GLOW_STRENGTH_EMPOWERED : 0;
      ui.bg.setStrokeStyle(e.BORDER_WIDTH, colors.BORDER_GOLD);
      ui.shine.setVisible(false);
      ui.hint.setVisible(false);
    }
  }

  /**
   * 更新集滿掃光：亮光從進度條左緣掃到右緣後循環，超出進度條的部分裁掉
   *
   * @param shine 掃光矩形（origin 0, 0.5）
   * @param barLeft 進度條左緣 x（容器座標）
   * @param barWidth 進度條滿格寬度
   */
  private updateEnergyShine(shine: Phaser.GameObjects.Rectangle, barLeft: number, barWidth: number): void {
    const e = this.OVERHEAD_UI_CONFIG.ENERGY;
    const phase = (this.time.now % e.SHINE_CYCLE_MS) / e.SHINE_CYCLE_MS;
    // 掃光左緣從 -SHINE_WIDTH 移動到 barWidth，讓亮光完整進場、出場
    const x = -e.SHINE_WIDTH + (barWidth + e.SHINE_WIDTH) * phase;
    const left = Math.max(0, x);
    const right = Math.min(barWidth, x + e.SHINE_WIDTH);
    if (right <= left) {
      shine.setVisible(false);
      return;
    }
    shine.setVisible(true).setPosition(barLeft + left, shine.y);
    shine.width = right - left;
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
   * 在下方面板播放 COMBO 報獎特效：彩票噴發 + 閃光 + 「獲得N票券！」文字
   *
   * 位置以該角色的面板 COMBO 文字錨點（面板右上角，已隨 F4 面板模式定位）為基準
   *
   * @param index 角色索引（對應 panelComboTexts）
   * @param tickets 獲得的票券數量
   * @param milestone 達成的里程碑（連擊數，決定彩票數量與噴發速度）
   */
  playComboRewardFx(index: number, tickets: number, milestone: number): void {
    const anchor = this.panelComboTexts[index];
    if (!anchor) return;
    const cfg = this.PANEL_COMBO_CONFIG;
    const x = anchor.x + cfg.REWARD_FX_OFFSET_X;
    const y = anchor.y + cfg.REWARD_FX_OFFSET_Y;

    const config = GameConfig.ticketEffect;
    const ticketCount = Math.max(
      config.TIMING.TICKET_COUNT_BASE,
      Math.min(
        config.TIMING.TICKET_COUNT_MAX,
        config.TIMING.TICKET_COUNT_BASE + milestone * config.TIMING.TICKET_COUNT_MULTIPLIER
      )
    );
    for (let i = 0; i < ticketCount; i++) {
      this.createFinalTicketParticle(x, y, config, milestone);
    }
    this.createFinalFlashEffect(x, y);
    this.spawnRewardText(x, y, tickets);
  }

  /**
   * 「獲得N票券！」金色文字：往上飄、放大、淡出後銷毀
   *
   * @param x 螢幕座標 X
   * @param y 螢幕座標 Y
   * @param tickets 票券數量
   */
  private spawnRewardText(x: number, y: number, tickets: number): void {
    const cfg = this.PANEL_COMBO_CONFIG;
    const rewardText = this.add.text(x, y, `獲得${tickets}票券！`, {
      fontSize: cfg.REWARD_TEXT_FONT_SIZE,
      fontFamily: 'Arial Black',
      color: '#FFD700',
      stroke: '#FFFFFF',
      strokeThickness: cfg.REWARD_TEXT_STROKE_WIDTH,
      shadow: { offsetX: 2, offsetY: 2, color: '#000000', blur: 4, fill: true }
    }).setOrigin(0.5, 0.5).setDepth(cfg.REWARD_TEXT_DEPTH).setScrollFactor(0);
    this.tweens.add({
      targets: rewardText,
      y: y - cfg.REWARD_TEXT_RISE,
      scale: cfg.REWARD_TEXT_SCALE_TO,
      alpha: 0,
      duration: cfg.REWARD_TEXT_DURATION_MS,
      ease: 'Power2',
      onComplete: () => rewardText.destroy()
    });
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
    const cfg = this.PANEL_COMBO_CONFIG;
    // 正式版閃光：金色，快速擴張
    const flash = this.add.circle(x, y, cfg.REWARD_FLASH_START_RADIUS, 0xFFD700, 0.8)
      .setDepth(2001)
      .setStrokeStyle(3, 0xFFFFFF, 1)
      .setVisible(true)
      .setAlpha(0.8);
    
    // 正式版動畫：快速擴張，華麗效果
    this.tweens.add({
      targets: flash,
      radius: cfg.REWARD_FLASH_END_RADIUS,
      alpha: 0,          // 漸變透明
      duration: 400,     // 400ms快速動畫
      ease: 'Power2',    // 自然曲線
      onComplete: () => {
        flash.destroy();
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
    // 設置覆蓋模式標誌，防止updateStats()和updateOverheadUI()干擾
    this.isP1HeadUIHidden = !visible;
    
    // 獲取P1的頭頂UI容器 (P1索引為0)
    const p1Container = this.overheadUIs.get(0);
    
    if (p1Container) {
      // 直接設置可見性
      p1Container.setVisible(visible);
    } else {
      console.warn('⚠️ [頭頂UI控制] P1頭頂UI容器不存在，可能尚未創建');
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
    const w = GameConfig.width;
    const h = GameConfig.height;
    
    // 🎯 計算所有角色面板的位置參數（基於實際圖片尺寸）
    const count = GameConfig.characters.count;
    const actualPanelW = 324; // 實際面板圖片寬度
    const actualPanelH = 166; // 實際面板圖片高度
    
    // 計算適當的間距，讓4個面板平均分佈在螢幕寬度上
    const availableWidth = w - 100; // 留出左右邊距各50px
    const totalPanelWidth = count * actualPanelW;
    const totalGapWidth = availableWidth - totalPanelWidth;
    const panelGap = Math.max(20, totalGapWidth / (count + 1)); // 最小間距20px，或自動計算
    
    const startX = (w - (count * actualPanelW + (count - 1) * panelGap)) / 2; // 居中排列
    const rowTopY = h - 150; // 向上調整：與原始狀態列保持協調，從h-120改為h-150
    
    // 角色標籤和資源映射
    const playerLabels = ['1P', '2P', '3P', '4P'];
    const resourceKeys = ['bottom-panel-1P', 'bottom-panel-2P', 'bottom-panel-3P', 'bottom-panel-4P'];
    
    for (let i = 0; i < count; i++) {
      const playerLabel = playerLabels[i];
      const resourceKey = resourceKeys[i];
      
      if (this.textures.exists(resourceKey)) {
        // 檢查紋理是否成功載入
        const texture = this.textures.get(resourceKey);
        if (texture && texture.key !== '__MISSING') {
          // 🎯 計算當前角色面板的精確位置
          const playerPanelX = startX + i * (actualPanelW + panelGap);
          const playerPanelY = rowTopY;
          const playerCenterX = playerPanelX + actualPanelW / 2; // 面板中心X座標
          const playerCenterY = playerPanelY + actualPanelH / 2; // 面板中心Y座標
          
          // 🎨 使用實際圖片尺寸
          const displayW = actualPanelW;
          const displayH = actualPanelH;
          
          // 創建角色底部面板覆蓋，精確對準該角色的原始面板位置
          this.bottomPanelOverlays[i] = this.add.image(playerCenterX, playerCenterY, resourceKey)
            .setOrigin(0.5, 0.5)
            .setDepth(1000 + i)  // 每個角色不同深度避免衝突
            .setVisible(false)
            .setScrollFactor(0)  // 固定位置，不隨相機移動
            .setDisplaySize(displayW, displayH);  // 🎨 保持原始尺寸比例
          
        } else {
          console.error(`❌ [多角色底部面板] ${playerLabel}紋理載入失敗或損壞`);
          this.bottomPanelOverlays[i] = null;
        }
      } else {
        console.warn(`⚠️ [多角色底部面板] ${playerLabel}底部面板覆蓋資源不存在：${playerLabel}.png`);
        this.bottomPanelOverlays[i] = null;
      }
    }
    
  }

  /**
   * 建立下方面板的 COMBO 文字（每個角色一個，預設隱藏），先對齊原版色塊面板；
   * F4 切換時由 setBottomPanelOverlay → positionPanelComboTexts 重新定位
   */
  private createPanelComboTexts(): void {
    const cfg = this.PANEL_COMBO_CONFIG;
    const colors = this.OVERHEAD_UI_CONFIG.COLORS;
    this.panelComboTexts = this.rows.map(() =>
      this.add.text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: cfg.FONT_SIZE,
        color: colors.COMBO_TEXT_NORMAL,
        stroke: colors.BLACK,
        strokeThickness: cfg.STROKE_WIDTH,
        fontStyle: 'bold'
      }).setOrigin(1, 1).setDepth(cfg.DEPTH).setScrollFactor(0).setVisible(false)
    );
    this.positionPanelComboTexts(false);
  }

  /**
   * 依面板模式把 COMBO 文字移到對應面板的右上角
   *
   * @param useOverlay - true = F4 面板圖；false = 原版色塊面板（該角色沒有面板圖時也退回原版位置）
   */
  private positionPanelComboTexts(useOverlay: boolean): void {
    const cfg = this.PANEL_COMBO_CONFIG;
    this.panelComboTexts.forEach((text, i) => {
      const overlay = this.bottomPanelOverlays[i];
      if (useOverlay && overlay) {
        // 面板圖 origin 為中心 → 右上角 = 中心 + (寬/2, -高/2)
        text.setPosition(
          overlay.x + overlay.displayWidth / 2 + cfg.OVERLAY_OFFSET_X,
          overlay.y - overlay.displayHeight / 2 + cfg.OVERLAY_OFFSET_Y
        );
        return;
      }
      // 原版色塊面板 origin 為左上 → 右上角 = (x + 寬, y)
      const panelBg = this.rows[i]?.panelBg;
      if (panelBg) text.setPosition(panelBg.x + panelBg.width + cfg.CLASSIC_OFFSET_X, panelBg.y + cfg.CLASSIC_OFFSET_Y);
    });
  }

  /**
   * 更新下方面板的 COMBO 顯示：HIT xN；警告狀態橙紅交替閃爍；
   * 連擊為 0、角色未加入或陣亡時隱藏
   *
   * @param index 角色索引（對應 rows / panelComboTexts）
   * @param character 角色數據（未加入時為 undefined）
   */
  private updatePanelCombo(index: number, character: CharStat | undefined): void {
    const text = this.panelComboTexts[index];
    if (!text) return;
    const combo = character?.alive ? character.combo : undefined;
    if (!combo || combo.currentStreak === 0) {
      text.setVisible(false);
      return;
    }
    const cfg = this.PANEL_COMBO_CONFIG;
    const colors = this.OVERHEAD_UI_CONFIG.COLORS;
    let color: string = colors.COMBO_TEXT_NORMAL;
    if (combo.isWarning) {
      const blinkOn = this.time.now % cfg.WARNING_BLINK_MS < cfg.WARNING_BLINK_MS / 2;
      color = blinkOn ? colors.COMBO_TEXT_CRITICAL : colors.COMBO_TEXT_WARNING;
    }
    text.setText(`HIT x${combo.currentStreak}`).setColor(color).setVisible(true);
  }

  /**
   * ★多角色底部面板替換控制方法
   * 
   * 控制所有角色底部狀態面板的顯示/隱藏，並切換多角色覆蓋UI
   * 
   * @param useOverlay - true顯示所有覆蓋並隱藏原始面板，false恢復所有原始面板
   */
  setBottomPanelOverlay(useOverlay: boolean): void {
    this.positionPanelComboTexts(useOverlay);
    const playerLabels = ['1P', '2P', '3P', '4P'];
    const count = GameConfig.characters.count;
    
    if (useOverlay) {
      // 激活所有角色的底部面板覆蓋
      for (let i = 0; i < count; i++) {
        const playerLabel = playerLabels[i];
        const playerOverlay = this.bottomPanelOverlays[i];
        
        if (playerOverlay) {
          playerOverlay.setVisible(true);
          
          // 隱藏對應的原始面板
          if (this.rows && this.rows.length > i) {
            const playerPanel = this.rows[i];
            this.setRowPanelVisible(playerPanel, false);
          }
        } else {
          console.warn(`⚠️ [多角色底部面板] ${playerLabel}覆蓋不存在，保持原始面板顯示`);
          
          // 如果沒有覆蓋圖片，保持原始面板顯示
          if (this.rows && this.rows.length > i) {
            const playerPanel = this.rows[i];
            this.setRowPanelVisible(playerPanel, true);
          }
        }
      }
    } else {
      // 關閉所有角色的底部面板覆蓋
      for (let i = 0; i < count; i++) {
        const playerOverlay = this.bottomPanelOverlays[i];
        
        // 隱藏覆蓋UI
        if (playerOverlay) {
          playerOverlay.setVisible(false);
        }
        
        // 恢復原始底部面板
        if (this.rows && this.rows.length > i) {
          const playerPanel = this.rows[i];
          this.setRowPanelVisible(playerPanel, true);
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
    
    elements.forEach((element) => {
      if (element && typeof element.setVisible === 'function') {
        element.setVisible(visible);
      }
    });
  }
}
