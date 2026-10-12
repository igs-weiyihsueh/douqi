import Phaser from 'phaser';

/** HIT 連擊顯示用到的貼圖 key（BootScene 載入） */
export const HIT_COUNTER_TEXTURES = {
  /** 紅色筆刷底圖 */
  BG: 'hit-counter-bg',
  /** 「HIT」字樣 */
  LABEL: 'hit-counter-label',
  /** 數字 0～9，索引即數字 */
  DIGITS: Array.from({ length: 10 }, (_, d) => `hit-counter-num-${d}`)
} as const;

/** HIT 連擊顯示的排版與動態 */
const HIT_COUNTER_CONFIG = {
  /** 相鄰數字的間距（數字圖為斜體且左右有留白，負值讓數字靠緊） */
  DIGIT_SPACING: -6,
  /** 數字與「HIT」字樣的間距 */
  LABEL_GAP: 4,
  /** 「HIT」字樣下緣相對數字列中心的位置：對齊數字字形下緣（數字圖 60 高、字形下緣在 57） */
  LABEL_BASELINE_Y: 27,
  /** 連擊數改變時的彈跳：數字與字樣先放大到 POP_SCALE，再於 POP_DURATION_MS 內縮回原尺寸 */
  POP_SCALE: 1.4,
  POP_DURATION_MS: 180
} as const;

/**
 * 下方面板的 HIT 連擊顯示：紅色筆刷底圖上排「數字圖 + HIT 字樣」，連擊數改變時彈跳放大。
 *
 * - 容器位置 = 底圖右下角（對齊面板的 COMBO 錨點）
 * - 數字與字樣整組置中於底圖，彈跳以底圖中心為基準縮放
 * - 連擊數為 0 時隱藏
 */
export class HitCounter extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Image;
  /** 數字與字樣的群組（位於底圖中心，彈跳縮放這一組） */
  private readonly group: Phaser.GameObjects.Container;
  private readonly label: Phaser.GameObjects.Image;
  /** 數字圖物件池（依位數增加，不用的隱藏） */
  private readonly digits: Phaser.GameObjects.Image[] = [];
  private hitCount = 0;
  private popTween?: Phaser.Tweens.Tween;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.bg = scene.add.image(0, 0, HIT_COUNTER_TEXTURES.BG).setOrigin(1, 1);
    this.group = scene.add.container(-this.bg.width / 2, -this.bg.height / 2);
    this.label = scene.add.image(0, HIT_COUNTER_CONFIG.LABEL_BASELINE_Y, HIT_COUNTER_TEXTURES.LABEL).setOrigin(0, 1);
    this.group.add(this.label);
    this.add([this.bg, this.group]);
    this.setVisible(false);
    scene.add.existing(this);
  }

  /** 底圖中心的螢幕座標（報獎特效以此為基準） */
  get centerX(): number {
    return this.x - this.bg.width / 2;
  }

  /** 底圖中心的螢幕座標（報獎特效以此為基準） */
  get centerY(): number {
    return this.y - this.bg.height / 2;
  }

  /**
   * 設定連擊數：0 隱藏；改變時重排數字並彈跳
   *
   * @param count 目前連擊數
   */
  setCount(count: number): void {
    if (count === this.hitCount) return;
    this.hitCount = count;
    this.setVisible(count > 0);
    if (count <= 0) return;
    this.layout(String(count));
    this.pop();
  }

  /**
   * 依數字字串排出數字圖與字樣，整組水平置中於群組原點
   *
   * @param text 連擊數字串
   */
  private layout(text: string): void {
    const cfg = HIT_COUNTER_CONFIG;
    while (this.digits.length < text.length) {
      const digit = this.scene.add.image(0, 0, HIT_COUNTER_TEXTURES.DIGITS[0]).setOrigin(0, 0.5);
      this.digits.push(digit);
      this.group.add(digit);
    }
    const shown = this.digits.slice(0, text.length);
    shown.forEach((digit, i) => digit.setTexture(HIT_COUNTER_TEXTURES.DIGITS[Number(text[i])]).setVisible(true));
    this.digits.slice(text.length).forEach((digit) => digit.setVisible(false));

    const digitsWidth = shown.reduce((w, d) => w + d.width, 0) + cfg.DIGIT_SPACING * (shown.length - 1);
    let x = -(digitsWidth + cfg.LABEL_GAP + this.label.width) / 2;
    for (const digit of shown) {
      digit.x = x;
      x += digit.width + cfg.DIGIT_SPACING;
    }
    this.label.x = x - cfg.DIGIT_SPACING + cfg.LABEL_GAP;
  }

  /** 彈跳：數字與字樣從放大縮回原尺寸（連續命中時從頭再彈） */
  private pop(): void {
    this.popTween?.stop();
    this.group.setScale(HIT_COUNTER_CONFIG.POP_SCALE);
    this.popTween = this.scene.tweens.add({
      targets: this.group,
      scale: 1,
      duration: HIT_COUNTER_CONFIG.POP_DURATION_MS,
      ease: 'Back.easeOut'
    });
  }
}
