import Phaser from 'phaser';
import { GameConfig } from '../config';

/** GO 指示的方向：左、右出口或上方出口 */
export type GoDirection = 'L' | 'R' | 'U';

/**
 * 出口開啟時的「GO」指示：顯示在對應方向引導箭頭的正上方（世界座標，跟著箭頭），
 * 文字本身持續閃動發光吸引玩家注意。開始轉場時由場景隱藏
 */
export class GoIndicator {
  private readonly labels = new Map<GoDirection, Phaser.GameObjects.Text>();

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * 在引導箭頭正上方顯示某方向的 GO（已顯示則不重建）
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
    const pad = cfg.glowBlur + cfg.strokeThickness;
    const label = this.scene.add.text(arrowX, arrowY - arrowRadius - cfg.gapAboveArrow + pad, 'GO', {
      fontFamily: 'monospace', fontSize: cfg.fontSize, color: cfg.color,
      stroke: cfg.strokeColor, strokeThickness: cfg.strokeThickness, fontStyle: 'bold',
      padding: { x: pad, y: pad }
    })
      .setOrigin(0.5, 1) // 底部置中對齊箭頭上方（底部 padding 已算進位置）
      .setDepth(cfg.depth)
      .setShadow(0, 0, cfg.glowColor, cfg.glowBlur, true, true);
    // 閃動發光：透明度與大小同步脈動
    this.scene.tweens.add({
      targets: label, alpha: { from: 1, to: cfg.blinkMinAlpha }, scale: { from: cfg.pulseScale, to: 1 },
      duration: cfg.blinkMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
    this.labels.set(dir, label);
  }

  /**
   * 隱藏某方向的 GO
   *
   * @param dir 出口方向
   */
  hide(dir: GoDirection): void {
    const label = this.labels.get(dir);
    if (!label) return;
    this.scene.tweens.killTweensOf(label);
    label.destroy();
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
}
