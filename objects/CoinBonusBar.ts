import Phaser from 'phaser';

/** 多投多送膠囊量條的排版與動態 */
const COIN_BAR_CONFIG = {
  /** 膠囊：高度（兩端半圓半徑 = 高度一半）、底色、描邊 */
  HEIGHT: 46,
  CAPSULE_FILL: 0x1a1206,
  CAPSULE_FILL_ALPHA: 0.8,
  CAPSULE_BORDER: 0xffc107,
  CAPSULE_BORDER_WIDTH: 3,
  /** 最左側硬幣：中心離膠囊左緣的距離、半徑、顏色（外圈 / 幣面 / 內圈線 / 反光） */
  COIN_CENTER_X: 20,
  COIN_RADIUS: 16,
  COIN_RIM: 0xe0a000,
  COIN_FACE: 0xffd54f,
  COIN_INNER_LINE: 0xb07800,
  COIN_INNER_RADIUS: 11,
  COIN_SHINE: 0xfff8d0,
  /** 格子：從 CELLS_LEFT 開始排，寬 CELL_WIDTH、間隔 CELL_GAP、高 CELL_HEIGHT、圓角 CELL_RADIUS；膠囊右側留 RIGHT_PADDING */
  CELLS_LEFT: 38,
  CELL_WIDTH: 43,
  CELL_GAP: 2,
  CELL_HEIGHT: 36,
  CELL_RADIUS: 7,
  RIGHT_PADDING: 8,
  /** 格子底色：未亮 / 已亮 */
  CELL_FILL: 0x000000,
  CELL_FILL_ALPHA: 0.55,
  CELL_LIT_FILL: 0xffc107,
  CELL_LIT_ALPHA: 1,
  /**
   * 每一格：劍圖示在左、這次投幣得到的 CREDIT 數字在右（相對格子中心）。未亮時金色劍 + 深色外框（深色劍放大 ICON_OUTLINE_SCALE 墊在後面），
   * 亮格（金色底）時改成深色劍
   */
  ICON_OFFSET_X: -14,
  ICON_SCALE: 1,
  ICON_OUTLINE_SCALE: 1.3,
  ICON_DARK: 0x3a2600,
  TEXT_OFFSET_X: 7,
  FONT_SIZE: '16px',
  TEXT_COLOR: '#ffffff',
  TEXT_LIT_COLOR: '#3a2600',
  TEXT_STROKE: '#000000',
  TEXT_STROKE_WIDTH: 3,
  /** 未亮格內容的透明度 */
  DIM_ALPHA: 0.6,
  /** 亮起時格子從 POP_SCALE 彈回原尺寸 */
  POP_SCALE: 1.35,
  POP_MS: 260,
  /** 投滿最後一格：等最後一格彈完，整條蓋上白光（GLOW_ALPHA，費時 GLOW_MS），再 BURST_FADE_MS 淡出並清空（化成飛光由呼叫端處理） */
  GLOW_COLOR: 0xfff3b0,
  GLOW_ALPHA: 0.9,
  GLOW_MS: 250,
  BURST_FADE_MS: 200,
  /** 顯示 / 隱藏的淡入淡出時間 */
  FADE_MS: 200
} as const;

/** 一格的顯示物件 */
interface CoinCell {
  /** 格子容器（中心在格子中心，彈跳縮放這一組） */
  root: Phaser.GameObjects.Container;
  /** 格子底（圓角矩形，亮 / 暗時重畫） */
  box: Phaser.GameObjects.Graphics;
  /** 未亮時的金色劍與其深色外框、亮格時的深色劍、CREDIT 數字 */
  icon: Phaser.GameObjects.Graphics;
  iconOutline: Phaser.GameObjects.Graphics;
  iconLit: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

/**
 * 下方面板的多投多送膠囊量條：最左側一枚硬幣，後面一格代表一次投幣，每格標示劍圖示 + 這次投幣得到的 CREDIT。
 *
 * - 容器位置 = 膠囊左下角（對齊面板的 COMBO 錨點）
 * - setShown 淡入 / 淡出；setLit 直接設定亮了幾格；lightCell 亮起一格並彈跳；completeRound 投滿時整條發光後化成飛光消失
 * - cellCenter / center 取得某格 / 整條中心的螢幕座標（投幣光效的起點）
 */
export class CoinBonusBar extends Phaser.GameObjects.Container {
  private readonly cells: CoinCell[] = [];
  /** 投滿時整條蓋上的白光（平時透明） */
  private readonly glow: Phaser.GameObjects.Graphics;
  /** 膠囊寬度 */
  private readonly capsuleWidth: number;
  /** 目前亮了幾格 */
  private litCount = 0;
  /** 投滿演出中（演出完才清空並隱藏，期間不接受 setLit / setShown） */
  private completing = false;
  /** setShown 最後要求的狀態（避免每幀重開淡入淡出） */
  private shown = false;

  /**
   * @param scene 場景
   * @param gains 每格（每次投幣）得到的 CREDIT（格數 = 長度）
   * @param drawIcon 在指定 Graphics 上畫劍圖示（以原點為中心）；fill 有給時整把劍用這個顏色，否則用原本的金色
   */
  constructor(scene: Phaser.Scene, gains: ReadonlyArray<number>, drawIcon: (g: Phaser.GameObjects.Graphics, fill?: number) => void) {
    super(scene, 0, 0);
    const cfg = COIN_BAR_CONFIG;
    const width = cfg.CELLS_LEFT + gains.length * cfg.CELL_WIDTH + (gains.length - 1) * cfg.CELL_GAP + cfg.RIGHT_PADDING;
    this.capsuleWidth = width;
    const midY = -cfg.HEIGHT / 2;
    this.add([this.createCapsule(width), this.createCoin(midY)]);
    this.glow = scene.add.graphics().fillStyle(cfg.GLOW_COLOR, 1)
      .fillRoundedRect(0, -cfg.HEIGHT, width, cfg.HEIGHT, cfg.HEIGHT / 2).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    const icon = (scale: number, fill?: number): Phaser.GameObjects.Graphics => {
      const g = scene.add.graphics({ x: cfg.ICON_OFFSET_X, y: 0 }).setScale(scale);
      drawIcon(g, fill);
      return g;
    };
    gains.forEach((gain, i) => {
      const cx = cfg.CELLS_LEFT + i * (cfg.CELL_WIDTH + cfg.CELL_GAP) + cfg.CELL_WIDTH / 2;
      const cell: CoinCell = {
        root: scene.add.container(cx, midY),
        box: scene.add.graphics(),
        iconOutline: icon(cfg.ICON_SCALE * cfg.ICON_OUTLINE_SCALE, cfg.ICON_DARK),
        icon: icon(cfg.ICON_SCALE),
        iconLit: icon(cfg.ICON_SCALE, cfg.ICON_DARK),
        label: scene.add.text(cfg.TEXT_OFFSET_X, 0, `${gain}`, {
          fontFamily: 'monospace', fontSize: cfg.FONT_SIZE, fontStyle: 'bold', color: cfg.TEXT_COLOR,
          stroke: cfg.TEXT_STROKE, strokeThickness: cfg.TEXT_STROKE_WIDTH
        }).setOrigin(0.5)
      };
      cell.root.add([cell.box, cell.iconOutline, cell.icon, cell.iconLit, cell.label]);
      this.add(cell.root);
      this.cells.push(cell);
    });
    this.add(this.glow);
    this.applyLit();
    scene.add.existing(this);
  }

  /** 格數 */
  get cellCount(): number {
    return this.cells.length;
  }

  /** 量條高度（像素） */
  get barHeight(): number {
    return COIN_BAR_CONFIG.HEIGHT;
  }

  /** 整條中心的螢幕座標（量條不縮放、不旋轉） */
  center(): { x: number; y: number } {
    return { x: this.x + this.capsuleWidth / 2, y: this.y - COIN_BAR_CONFIG.HEIGHT / 2 };
  }

  /**
   * 顯示 / 隱藏（淡入淡出；投滿演出中不處理）
   *
   * @param shown 是否顯示
   */
  setShown(shown: boolean): void {
    if (this.completing || shown === this.shown) return;
    this.shown = shown;
    const fadeMs = COIN_BAR_CONFIG.FADE_MS;
    this.scene.tweens.killTweensOf(this);
    if (shown) {
      if (!this.visible) this.setVisible(true).setAlpha(0);
      this.scene.tweens.add({ targets: this, alpha: 1, duration: fadeMs });
    } else {
      this.scene.tweens.add({ targets: this, alpha: 0, duration: fadeMs, onComplete: () => this.setVisible(false) });
    }
  }

  /**
   * 第 index 格中心的螢幕座標（量條不縮放、不旋轉）
   *
   * @param index 格子索引
   */
  cellCenter(index: number): { x: number; y: number } {
    const root = this.cells[Phaser.Math.Clamp(index, 0, this.cells.length - 1)].root;
    return { x: this.x + root.x, y: this.y + root.y };
  }

  /**
   * 直接設定亮了幾格（同步狀態用；投滿演出中不處理）
   *
   * @param count 亮的格數
   */
  setLit(count: number): void {
    if (this.completing || count === this.litCount) return;
    this.litCount = Phaser.Math.Clamp(count, 0, this.cells.length);
    this.applyLit();
  }

  /**
   * 亮起第 index 格（含之前的格子）並彈跳
   *
   * @param index 格子索引
   */
  lightCell(index: number): void {
    const cfg = COIN_BAR_CONFIG;
    this.litCount = Phaser.Math.Clamp(index + 1, 0, this.cells.length);
    this.applyLit();
    const root = this.cells[Phaser.Math.Clamp(index, 0, this.cells.length - 1)].root;
    this.scene.tweens.killTweensOf(root);
    root.setScale(cfg.POP_SCALE);
    this.scene.tweens.add({ targets: root, scale: 1, duration: cfg.POP_MS, ease: 'Back.easeOut' });
  }

  /**
   * 投滿一輪：等最後一格彈完，整條蓋上白光，接著呼叫 onBurst（呼叫端從整條中心放出飛光）並淡出，結束後清空格子並隱藏。
   * 呼叫起就不接受 setLit / setShown，避免同步狀態先把格子清掉或提早隱藏
   *
   * @param onBurst 化成飛光的時機（傳入整條中心的螢幕座標）
   */
  completeRound(onBurst: (center: { x: number; y: number }) => void): void {
    const cfg = COIN_BAR_CONFIG;
    this.completing = true;
    this.scene.tweens.killTweensOf(this);
    this.setVisible(true).setAlpha(1);
    this.scene.tweens.chain({
      tweens: [
        { targets: this.glow, alpha: cfg.GLOW_ALPHA, delay: cfg.POP_MS, duration: cfg.GLOW_MS, ease: 'Quad.easeIn' },
        { targets: this, alpha: 0, duration: cfg.BURST_FADE_MS, onStart: () => onBurst(this.center()) }
      ],
      onComplete: () => {
        this.glow.setAlpha(0);
        this.setVisible(false);
        this.completing = false;
        this.shown = false;
        this.litCount = 0;
        this.applyLit();
      }
    });
  }

  /**
   * 膠囊外框：兩端半圓的長條
   *
   * @param width 膠囊寬度
   */
  private createCapsule(width: number): Phaser.GameObjects.Graphics {
    const cfg = COIN_BAR_CONFIG;
    const r = cfg.HEIGHT / 2;
    return this.scene.add.graphics()
      .fillStyle(cfg.CAPSULE_FILL, cfg.CAPSULE_FILL_ALPHA)
      .fillRoundedRect(0, -cfg.HEIGHT, width, cfg.HEIGHT, r)
      .lineStyle(cfg.CAPSULE_BORDER_WIDTH, cfg.CAPSULE_BORDER, 1)
      .strokeRoundedRect(0, -cfg.HEIGHT, width, cfg.HEIGHT, r);
  }

  /**
   * 膠囊最左側的硬幣：金色外圈 + 幣面 + 內圈線 + 左上反光
   *
   * @param midY 膠囊垂直中心
   */
  private createCoin(midY: number): Phaser.GameObjects.Graphics {
    const cfg = COIN_BAR_CONFIG;
    const x = cfg.COIN_CENTER_X;
    return this.scene.add.graphics()
      .fillStyle(cfg.COIN_RIM, 1).fillCircle(x, midY, cfg.COIN_RADIUS)
      .fillStyle(cfg.COIN_FACE, 1).fillCircle(x, midY, cfg.COIN_RADIUS - 2)
      .lineStyle(2, cfg.COIN_INNER_LINE, 1).strokeCircle(x, midY, cfg.COIN_INNER_RADIUS)
      .fillStyle(cfg.COIN_SHINE, 0.8).fillEllipse(x - 5, midY - 6, 7, 4);
  }

  /** 依 litCount 套用每格亮 / 暗的外觀 */
  private applyLit(): void {
    const cfg = COIN_BAR_CONFIG;
    this.cells.forEach((cell, i) => {
      const lit = i < this.litCount;
      cell.box.clear()
        .fillStyle(lit ? cfg.CELL_LIT_FILL : cfg.CELL_FILL, lit ? cfg.CELL_LIT_ALPHA : cfg.CELL_FILL_ALPHA)
        .fillRoundedRect(-cfg.CELL_WIDTH / 2, -cfg.CELL_HEIGHT / 2, cfg.CELL_WIDTH, cfg.CELL_HEIGHT, cfg.CELL_RADIUS);
      cell.label.setColor(lit ? cfg.TEXT_LIT_COLOR : cfg.TEXT_COLOR).setAlpha(lit ? 1 : cfg.DIM_ALPHA);
      cell.icon.setVisible(!lit).setAlpha(cfg.DIM_ALPHA);
      cell.iconOutline.setVisible(!lit).setAlpha(cfg.DIM_ALPHA);
      cell.iconLit.setVisible(lit);
    });
  }
}
