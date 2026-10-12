import Phaser from 'phaser';

/** 多投多送量條的排版與動態 */
const COIN_BAR_CONFIG = {
  /** 格子尺寸與間距：5 格總寬 = 5 × 46 + 4 × 6 = 254，與 HIT 底圖同寬 */
  CELL_WIDTH: 46,
  CELL_HEIGHT: 36,
  CELL_GAP: 6,
  /** 格子底色 / 外框：未亮與已亮 */
  CELL_FILL: 0x000000,
  CELL_FILL_ALPHA: 0.55,
  CELL_LIT_FILL: 0xffc107,
  CELL_LIT_ALPHA: 0.95,
  CELL_BORDER: 0x8a6d1f,
  CELL_LIT_BORDER: 0xfff3b0,
  CELL_BORDER_WIDTH: 2,
  /** 格內劍圖示與數字：劍在左、數字在右（相對格子中心） */
  ICON_OFFSET_X: -12,
  ICON_SCALE: 0.85,
  TEXT_OFFSET_X: 8,
  FONT_SIZE: '18px',
  TEXT_COLOR: '#ffffff',
  TEXT_LIT_COLOR: '#3a2600',
  TEXT_STROKE: '#000000',
  TEXT_STROKE_WIDTH: 3,
  /** 未亮格整體透明度 */
  DIM_ALPHA: 0.6,
  /** 亮起時格子從 POP_SCALE 彈回原尺寸 */
  POP_SCALE: 1.35,
  POP_MS: 260,
  /** 投滿最後一格：整條閃 FLASH_TIMES 次（每次單程 FLASH_MS）後清空 */
  FLASH_TIMES: 3,
  FLASH_MS: 110
} as const;

/** 一格的顯示物件 */
interface CoinCell {
  /** 格子容器（中心在格子中心，彈跳縮放這一組） */
  root: Phaser.GameObjects.Container;
  box: Phaser.GameObjects.Rectangle;
  icon: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

/**
 * 下方面板的多投多送量條：一格代表一次投幣，格內標示該次贈送的額外 CREDIT（劍圖示 + 「+N」）。
 *
 * - 容器位置 = 量條左下角（對齊面板的 COMBO 錨點）
 * - setLit 直接設定亮了幾格；lightCell 亮起一格並彈跳；flashAndClear 投滿時閃爍後清空
 * - 彈跳時間 popMs 供呼叫端安排投滿閃爍的時機
 * - cellCenter 取得某格中心的螢幕座標（投幣光效的起點）
 */
export class CoinBonusBar extends Phaser.GameObjects.Container {
  private readonly cells: CoinCell[] = [];
  /** 目前亮了幾格 */
  private litCount = 0;
  /** 投滿閃爍中（閃完才清空，期間不接受 setLit） */
  private flashing = false;

  /**
   * @param scene 場景
   * @param bonuses 每格標示的額外 CREDIT（格數 = 長度）
   * @param drawIcon 在指定 Graphics 上畫劍圖示（以原點為中心）
   */
  constructor(scene: Phaser.Scene, bonuses: ReadonlyArray<number>, drawIcon: (g: Phaser.GameObjects.Graphics) => void) {
    super(scene, 0, 0);
    const cfg = COIN_BAR_CONFIG;
    bonuses.forEach((bonus, i) => {
      const cx = i * (cfg.CELL_WIDTH + cfg.CELL_GAP) + cfg.CELL_WIDTH / 2;
      const box = scene.add.rectangle(0, 0, cfg.CELL_WIDTH, cfg.CELL_HEIGHT, cfg.CELL_FILL, cfg.CELL_FILL_ALPHA)
        .setStrokeStyle(cfg.CELL_BORDER_WIDTH, cfg.CELL_BORDER);
      const icon = scene.add.graphics({ x: cfg.ICON_OFFSET_X, y: 0 }).setScale(cfg.ICON_SCALE);
      drawIcon(icon);
      const label = scene.add.text(cfg.TEXT_OFFSET_X, 0, `+${bonus}`, {
        fontFamily: 'monospace', fontSize: cfg.FONT_SIZE, fontStyle: 'bold', color: cfg.TEXT_COLOR,
        stroke: cfg.TEXT_STROKE, strokeThickness: cfg.TEXT_STROKE_WIDTH
      }).setOrigin(0.5);
      const root = scene.add.container(cx, -cfg.CELL_HEIGHT / 2, [box, icon, label]);
      this.add(root);
      this.cells.push({ root, box, icon, label });
    });
    this.applyLit();
    scene.add.existing(this);
  }

  /** 格數 */
  get cellCount(): number {
    return this.cells.length;
  }

  /** 量條高度（像素） */
  get barHeight(): number {
    return COIN_BAR_CONFIG.CELL_HEIGHT;
  }

  /** 亮格彈跳的時間（毫秒） */
  get popMs(): number {
    return COIN_BAR_CONFIG.POP_MS;
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
   * 直接設定亮了幾格（同步狀態用；投滿閃爍中不處理）
   *
   * @param count 亮的格數
   */
  setLit(count: number): void {
    if (this.flashing || count === this.litCount) return;
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
    this.flashing = false;
    this.scene.tweens.killTweensOf(this);
    this.setAlpha(1);
    this.litCount = Phaser.Math.Clamp(index + 1, 0, this.cells.length);
    this.applyLit();
    const root = this.cells[Phaser.Math.Clamp(index, 0, this.cells.length - 1)].root;
    this.scene.tweens.killTweensOf(root);
    root.setScale(cfg.POP_SCALE);
    this.scene.tweens.add({ targets: root, scale: 1, duration: cfg.POP_MS, ease: 'Back.easeOut' });
  }

  /**
   * 投滿：delayMs 後整條閃爍數次再清空（呼叫起就不接受 setLit，避免同步狀態先把格子清掉）
   *
   * @param delayMs 開始閃爍前的等待（例如等最後一格彈完）
   */
  flashAndClear(delayMs = 0): void {
    const cfg = COIN_BAR_CONFIG;
    this.flashing = true;
    this.scene.tweens.add({
      targets: this,
      delay: delayMs,
      alpha: 0.2,
      duration: cfg.FLASH_MS,
      yoyo: true,
      repeat: cfg.FLASH_TIMES - 1,
      onComplete: () => {
        this.setAlpha(1);
        this.flashing = false;
        this.litCount = 0;
        this.applyLit();
      }
    });
  }

  /** 依 litCount 套用每格亮 / 暗的外觀 */
  private applyLit(): void {
    const cfg = COIN_BAR_CONFIG;
    this.cells.forEach((cell, i) => {
      const lit = i < this.litCount;
      cell.box.setFillStyle(lit ? cfg.CELL_LIT_FILL : cfg.CELL_FILL, lit ? cfg.CELL_LIT_ALPHA : cfg.CELL_FILL_ALPHA)
        .setStrokeStyle(cfg.CELL_BORDER_WIDTH, lit ? cfg.CELL_LIT_BORDER : cfg.CELL_BORDER);
      cell.label.setColor(lit ? cfg.TEXT_LIT_COLOR : cfg.TEXT_COLOR);
      cell.root.setAlpha(lit ? 1 : cfg.DIM_ALPHA);
    });
  }
}
