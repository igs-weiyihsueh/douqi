import Phaser from 'phaser';

/** 多投多送量條的排版與動態 */
const COIN_BAR_CONFIG = {
  /** 膠囊：高度（兩端半圓半徑 = 高度一半）、底色、描邊 */
  HEIGHT: 28,
  CAPSULE_FILL: 0x1a1206,
  CAPSULE_FILL_ALPHA: 0.8,
  CAPSULE_BORDER: 0xffc107,
  CAPSULE_BORDER_WIDTH: 2,
  /** 最左側硬幣：中心離膠囊左緣的距離、半徑、顏色（外圈 / 幣面 / 內圈線 / 反光） */
  COIN_CENTER_X: 14,
  COIN_RADIUS: 10,
  COIN_RIM: 0xe0a000,
  COIN_FACE: 0xffd54f,
  COIN_INNER_LINE: 0xb07800,
  COIN_INNER_RADIUS: 6,
  COIN_SHINE: 0xfff8d0,
  /** 投幣點：第一顆中心離膠囊左緣 DOTS_LEFT、間距 DOT_SPACING、半徑 DOT_RADIUS；未亮 = 深色底 + 金色細框，已亮 = 金色 */
  DOTS_LEFT: 34,
  DOT_SPACING: 14,
  DOT_RADIUS: 5,
  DOT_FILL: 0x000000,
  DOT_FILL_ALPHA: 0.6,
  DOT_BORDER: 0xffc107,
  DOT_BORDER_ALPHA: 0.7,
  DOT_LIT_FILL: 0xffc107,
  /** 獎勵（劍 + 「+N」）：與最後一顆點的間隔、劍縮放、劍與文字的間隔、文字寬度預留（以最長的獎勵計）、膠囊右側留白 */
  REWARD_GAP: 10,
  ICON_SCALE: 0.8,
  /** 縮放後劍圖示的半寬（護手寬 12 × ICON_SCALE ÷ 2，取整） */
  ICON_HALF_WIDTH: 5,
  ICON_TEXT_GAP: 4,
  CHAR_WIDTH: 10,
  RIGHT_PADDING: 10,
  FONT_SIZE: '17px',
  TEXT_COLOR: '#ffe066',
  TEXT_STROKE: '#000000',
  TEXT_STROKE_WIDTH: 3,
  /** 還沒投到這一段時（這一段 0 顆）獎勵的透明度 */
  DIM_ALPHA: 0.55,
  /** 亮起時投幣點從 POP_SCALE 彈回原尺寸 */
  POP_SCALE: 1.6,
  POP_MS: 220,
  /** 投滿一段：獎勵放大 REWARD_POP_SCALE 並閃 FLASH_TIMES 次（每次單程 FLASH_MS），停留 HOLD_MS 後換成下一段 */
  REWARD_POP_SCALE: 1.4,
  FLASH_TIMES: 3,
  FLASH_MS: 90,
  HOLD_MS: 700
} as const;

/** 一段 = 連續幾次投幣，最後一次有加贈 */
interface CoinStage {
  /** 第一次 / 最後一次投幣在 coinCycle 中的位置 */
  start: number;
  end: number;
  /** 投滿這一段加贈的 CREDIT（0 = 沒有加贈，例如循環尾端沒有加贈的投幣） */
  bonus: number;
}

/**
 * 多投多送量條（精簡版，投幣後短暫顯示在角色面板上方）：硬幣 + 這一段的投幣點 + 投滿送的 CREDIT（劍圖示與 CREDIT 欄相同）。
 *
 * 一段 = 到下一次加贈為止的投幣次數（coinCycle 5,10,5,15,5,20 → 每段 2 次，送 +5 / +10 / +15），一次只顯示目前這一段：
 * - 投幣時亮一顆點並彈跳；投滿時獎勵放大閃爍，停留一下後換成下一段（最後一段之後回到第一段）
 * - 容器位置 = 膠囊左下角
 * - setLit 依目前在 coinCycle 的位置同步顯示；rewardCenter 取得獎勵的螢幕座標（加贈光效的起點）
 */
export class CoinBonusBar extends Phaser.GameObjects.Container {
  private readonly stages: CoinStage[] = [];
  private readonly dots: Phaser.GameObjects.Graphics[] = [];
  private readonly reward: Phaser.GameObjects.Container;
  private readonly rewardText: Phaser.GameObjects.Text;
  /** coinCycle 長度 */
  private readonly cycleLength: number;
  /** 膠囊寬度（像素） */
  private readonly capsuleWidth: number;
  /** 這一輪已投幾次（0 ~ cycleLength） */
  private litCount = 0;
  /** 剛投滿一段、停留展示中（期間顯示投滿的那一段，不接受 setLit） */
  private holding = false;

  /**
   * @param scene 場景
   * @param bonuses coinCycle 每次投幣的加贈 CREDIT（0 = 沒有加贈）；有加贈的那一次是一段的結尾
   * @param drawIcon 在指定 Graphics 上畫劍圖示（以原點為中心）
   */
  constructor(scene: Phaser.Scene, bonuses: ReadonlyArray<number>, drawIcon: (g: Phaser.GameObjects.Graphics) => void) {
    super(scene, 0, 0);
    const cfg = COIN_BAR_CONFIG;
    this.cycleLength = bonuses.length;
    let start = 0;
    bonuses.forEach((bonus, i) => {
      if (bonus <= 0 && i < bonuses.length - 1) return;
      this.stages.push({ start, end: i, bonus });
      start = i + 1;
    });
    const maxDots = Math.max(...this.stages.map((s) => s.end - s.start + 1));
    const longestLabel = Math.max(...this.stages.map((s) => CoinBonusBar.labelOf(s.bonus).length));
    const midY = -cfg.HEIGHT / 2;
    const rewardLeft = cfg.DOTS_LEFT + (maxDots - 1) * cfg.DOT_SPACING + cfg.DOT_RADIUS + cfg.REWARD_GAP;
    const iconHalf = cfg.ICON_HALF_WIDTH;
    this.capsuleWidth = rewardLeft + iconHalf * 2 + cfg.ICON_TEXT_GAP + longestLabel * cfg.CHAR_WIDTH + cfg.RIGHT_PADDING;
    this.add([this.createCapsule(this.capsuleWidth), this.createCoin(midY)]);
    for (let i = 0; i < maxDots; i++) {
      const dot = scene.add.graphics({ x: cfg.DOTS_LEFT + i * cfg.DOT_SPACING, y: midY });
      this.dots.push(dot);
      this.add(dot);
    }
    // 獎勵容器的原點在劍的中心（放大閃爍以劍為中心）
    const icon = scene.add.graphics().setScale(cfg.ICON_SCALE);
    drawIcon(icon);
    this.rewardText = scene.add.text(iconHalf + cfg.ICON_TEXT_GAP, 0, '', {
      fontFamily: 'monospace', fontSize: cfg.FONT_SIZE, fontStyle: 'bold', color: cfg.TEXT_COLOR,
      stroke: cfg.TEXT_STROKE, strokeThickness: cfg.TEXT_STROKE_WIDTH
    }).setOrigin(0, 0.5);
    this.reward = scene.add.container(rewardLeft + iconHalf, midY, [icon, this.rewardText]);
    this.add(this.reward);
    this.applyLit();
    scene.add.existing(this);
  }

  /** 量條寬度（像素） */
  get barWidth(): number {
    return this.capsuleWidth;
  }

  /**
   * coinCycle 第 index 次投幣是否有加贈（投滿一段）
   *
   * @param index 在 coinCycle 中的位置
   */
  hasBonus(index: number): boolean {
    const stage = this.stageAt(index);
    return !!stage && stage.end === index && stage.bonus > 0;
  }

  /** 獎勵（劍）中心的螢幕座標（量條不縮放、不旋轉） */
  rewardCenter(): { x: number; y: number } {
    return { x: this.x + this.reward.x, y: this.y + this.reward.y };
  }

  /**
   * 依這一輪已投幾次同步顯示（投滿展示中不處理）
   *
   * @param count 這一輪已投幾次（= CreditController.coinCycleStep）
   */
  setLit(count: number): void {
    if (this.holding || count === this.litCount) return;
    this.litCount = Phaser.Math.Clamp(count, 0, this.cycleLength);
    this.applyLit();
  }

  /**
   * 投幣：亮起這一次的點並彈跳；投滿一段時獎勵放大閃爍，停留 HOLD_MS 後換成下一段
   *
   * @param index 這次投幣在 coinCycle 中的位置
   */
  lightCell(index: number): void {
    const cfg = COIN_BAR_CONFIG;
    const stage = this.stageAt(index);
    if (!stage) return;
    this.scene.tweens.killTweensOf(this.reward);
    this.reward.setScale(1).setAlpha(1);
    this.litCount = index + 1;
    const completed = index === stage.end;
    this.holding = completed;
    this.applyLit();
    const dot = this.dots[index - stage.start];
    if (dot) {
      this.scene.tweens.killTweensOf(dot);
      dot.setScale(cfg.POP_SCALE);
      this.scene.tweens.add({ targets: dot, scale: 1, duration: cfg.POP_MS, ease: 'Back.easeOut' });
    }
    if (!completed) return;
    this.scene.tweens.add({
      targets: this.reward, scale: cfg.REWARD_POP_SCALE, alpha: 0.3, duration: cfg.FLASH_MS,
      yoyo: true, repeat: cfg.FLASH_TIMES - 1, onComplete: () => this.reward.setScale(1).setAlpha(1)
    });
    this.scene.time.delayedCall(cfg.HOLD_MS, () => {
      if (!this.holding || this.litCount !== index + 1) return;
      this.holding = false;
      this.litCount %= this.cycleLength;
      this.applyLit();
    });
  }

  /**
   * coinCycle 第 index 次投幣所在的段
   *
   * @param index 在 coinCycle 中的位置
   */
  private stageAt(index: number): CoinStage | undefined {
    return this.stages.find((s) => index >= s.start && index <= s.end);
  }

  /** 獎勵文字：「+N」，沒有加贈時空白 */
  private static labelOf(bonus: number): string {
    return bonus > 0 ? `+${bonus}` : '';
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
      .lineStyle(1.5, cfg.COIN_INNER_LINE, 1).strokeCircle(x, midY, cfg.COIN_INNER_RADIUS)
      .fillStyle(cfg.COIN_SHINE, 0.8).fillEllipse(x - 3, midY - 4, 5, 3);
  }

  /**
   * 依 litCount 顯示目前這一段：展示中顯示剛投滿的那一段（全亮），否則顯示下一次投幣所在的段；
   * 點數 = 這一段的投幣次數（多出來的點隱藏），獎勵在這一段還沒投時半透明
   */
  private applyLit(): void {
    const cfg = COIN_BAR_CONFIG;
    const stage = this.stageAt(this.holding ? this.litCount - 1 : this.litCount % this.cycleLength);
    if (!stage) return;
    const lit = this.holding ? stage.end - stage.start + 1 : (this.litCount % this.cycleLength) - stage.start;
    this.dots.forEach((dot, i) => {
      dot.setVisible(i <= stage.end - stage.start).clear();
      if (i < lit) {
        dot.fillStyle(cfg.DOT_LIT_FILL, 1).fillCircle(0, 0, cfg.DOT_RADIUS);
      } else {
        dot.fillStyle(cfg.DOT_FILL, cfg.DOT_FILL_ALPHA).fillCircle(0, 0, cfg.DOT_RADIUS)
          .lineStyle(1, cfg.DOT_BORDER, cfg.DOT_BORDER_ALPHA).strokeCircle(0, 0, cfg.DOT_RADIUS);
      }
    });
    this.rewardText.setText(CoinBonusBar.labelOf(stage.bonus));
    this.reward.setVisible(stage.bonus > 0).setAlpha(lit > 0 ? 1 : cfg.DIM_ALPHA);
  }
}
