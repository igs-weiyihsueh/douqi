import Phaser from 'phaser';
import { GameConfig } from '../config';

/** GO 指示的方向：左、右出口或上方出口 */
export type GoDirection = 'L' | 'R' | 'U';

/** 一個方向的 GO：文字物件、對應的引導箭頭，以及目前是否貼在箭頭上方 */
interface GoLabel {
  text: Phaser.GameObjects.Text;
  /** 引導箭頭圓心（世界座標）與外圈半徑 */
  arrowX: number;
  arrowY: number;
  arrowRadius: number;
  /** true = 箭頭完整在畫面內，GO 在箭頭上方；false = GO 貼在畫面對應邊緣 */
  onArrow: boolean;
}

/**
 * 出口開啟時的「GO」指示（文字本身閃動發光）。每幀依引導箭頭是否在畫面內決定位置：
 * - 箭頭完整在畫面內 → GO 在箭頭正上方（上方會碰到 HUD 時改放箭頭下方）
 * - 箭頭在畫面外 → GO 貼在畫面對應邊緣（左 / 右緣在箭頭高度、上緣在箭頭水平位置，皆夾在 HUD 之間），保持可見
 *
 * 兩種位置之間平滑移動；進出畫面的判斷有容差，避免箭頭剛好在畫面邊緣時來回跳。開始轉場時由場景隱藏
 */
export class GoIndicator {
  private readonly labels = new Map<GoDirection, GoLabel>();

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * 顯示某方向的 GO（已顯示則不重建），之後由 update() 決定位置
   *
   * @param dir 出口方向
   * @param arrowX 引導箭頭圓心 x（世界座標）
   * @param arrowY 引導箭頭圓心 y（世界座標）
   * @param arrowRadius 引導箭頭外圈半徑
   */
  show(dir: GoDirection, arrowX: number, arrowY: number, arrowRadius: number): void {
    if (this.labels.has(dir)) return;
    const cfg = GameConfig.stage.goIndicator;
    // 文字畫布四周留出光暈半徑的空間，避免陰影被畫布邊界切掉而出現方框
    const pad = this.padding();
    const text = this.scene.add.text(0, 0, 'GO', {
      fontFamily: 'monospace', fontSize: cfg.fontSize, color: cfg.color,
      stroke: cfg.strokeColor, strokeThickness: cfg.strokeThickness, fontStyle: 'bold',
      padding: { x: pad, y: pad }
    })
      .setOrigin(0.5, 1) // 以文字底部中央定位（位置計算會補回底部 padding）
      .setDepth(cfg.depth)
      .setShadow(0, 0, cfg.glowColor, cfg.glowBlur, true, true);
    // 閃動發光：透明度與大小同步脈動
    this.scene.tweens.add({
      targets: text, alpha: { from: 1, to: cfg.blinkMinAlpha }, scale: { from: cfg.pulseScale, to: 1 },
      duration: cfg.blinkMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
    const label: GoLabel = { text, arrowX, arrowY, arrowRadius, onArrow: false };
    label.onArrow = this.arrowFullyVisible(label, 0);
    const target = this.targetAnchor(dir, label);
    text.setPosition(target.x, target.y + pad); // 第一次直接放到位，不從原點滑過來
    this.labels.set(dir, label);
  }

  /**
   * 每幀更新：判斷箭頭是否在畫面內並決定目標位置，GO 平滑移過去
   *
   * @param delta 本幀毫秒
   */
  update(delta: number): void {
    if (this.labels.size === 0) return;
    const cfg = GameConfig.stage.goIndicator;
    const pad = this.padding();
    const t = Math.min(1, delta / cfg.followMs);
    for (const [dir, label] of this.labels) {
      // 進畫面要完整進入才切到箭頭上方；離開要超出容差才切回邊緣，避免在邊界來回跳
      label.onArrow = label.onArrow
        ? this.arrowFullyVisible(label, -cfg.hysteresisPx)
        : this.arrowFullyVisible(label, 0);
      const target = this.targetAnchor(dir, label);
      const tx = target.x, ty = target.y + pad;
      label.text.setPosition(label.text.x + (tx - label.text.x) * t, label.text.y + (ty - label.text.y) * t);
    }
  }

  /**
   * 隱藏某方向的 GO
   *
   * @param dir 出口方向
   */
  hide(dir: GoDirection): void {
    const label = this.labels.get(dir);
    if (!label) return;
    this.scene.tweens.killTweensOf(label.text);
    label.text.destroy();
    this.labels.delete(dir);
  }

  /** 隱藏全部 GO（開始轉場、重開時） */
  hideAll(): void {
    for (const dir of [...this.labels.keys()]) this.hide(dir);
  }

  /** 目前顯示中的方向（測試與除錯用） */
  get visibleDirections(): GoDirection[] {
    return [...this.labels.keys()];
  }

  /** 文字畫布四周的留白（光暈 + 描邊） */
  private padding(): number {
    const cfg = GameConfig.stage.goIndicator;
    return cfg.glowBlur + cfg.strokeThickness;
  }

  /**
   * 箭頭（含外圈）是否完整在畫面內
   *
   * @param label GO 與其箭頭
   * @param margin 畫面範圍往外放寬的像素（負值 = 允許超出畫面這麼多仍算在內）
   */
  private arrowFullyVisible(label: GoLabel, margin: number): boolean {
    const view = this.scene.cameras.main.worldView;
    const r = label.arrowRadius;
    return label.arrowX - r >= view.left + margin && label.arrowX + r <= view.right - margin &&
      label.arrowY - r >= view.top + margin && label.arrowY + r <= view.bottom - margin;
  }

  /**
   * GO 文字底部中央應在的世界座標：箭頭在畫面內時在箭頭外圈上方（上方空間不足就放箭頭下方）；
   * 否則貼畫面對應邊緣，夾在上方 HUD 與下方面板之間
   */
  private targetAnchor(dir: GoDirection, label: GoLabel): { x: number; y: number } {
    const cfg = GameConfig.stage.goIndicator;
    const view = this.scene.cameras.main.worldView;
    const minY = view.top + cfg.edgeMinY, maxY = view.bottom - cfg.edgeBottomMargin;
    const aboveY = label.arrowY - label.arrowRadius - cfg.gapAboveArrow;
    if (label.onArrow) {
      // 箭頭上方會進到上方 HUD 時（例如上方出口箭頭貼近畫面頂），改放在箭頭正下方
      if (aboveY >= minY) return { x: label.arrowX, y: aboveY };
      const glyphH = label.text.height - this.padding() * 2;
      return { x: label.arrowX, y: label.arrowY + label.arrowRadius + cfg.gapAboveArrow + glyphH };
    }
    if (dir === 'U') {
      return { x: Phaser.Math.Clamp(label.arrowX, view.left + cfg.edgeInset, view.right - cfg.edgeInset), y: minY };
    }
    const x = dir === 'L' ? view.left + cfg.edgeInset : view.right - cfg.edgeInset;
    return { x, y: Phaser.Math.Clamp(aboveY, minY, maxY) };
  }
}
