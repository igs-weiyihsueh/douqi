import Phaser from 'phaser';
import { GameConfig } from '../config';

/** GO 指示的方向：左、右出口或上方出口 */
export type GoDirection = 'L' | 'R' | 'U';

/**
 * 出口開啟時的「GO」指示：固定在畫面邊緣（左 / 右 / 上，對應開啟的出口），隨鏡頭移動永遠在視野內，
 * 持續閃動發光吸引玩家注意。開始轉場時由場景隱藏
 */
export class GoIndicator {
  private readonly labels = new Map<GoDirection, Phaser.GameObjects.Text>();

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * 顯示某方向的 GO（已顯示則不重建）
   *
   * @param dir 出口方向
   */
  show(dir: GoDirection): void {
    if (this.labels.has(dir)) return;
    const cfg = GameConfig.stage.goIndicator;
    const pos = dir === 'L' ? { x: cfg.edgeInset, y: GameConfig.height / 2 }
      : dir === 'R' ? { x: GameConfig.width - cfg.edgeInset, y: GameConfig.height / 2 }
        : { x: GameConfig.width / 2, y: cfg.topY };
    const label = this.scene.add.text(pos.x, pos.y, 'GO', {
      fontFamily: 'monospace', fontSize: cfg.fontSize, color: cfg.color,
      stroke: cfg.strokeColor, strokeThickness: cfg.strokeThickness, fontStyle: 'bold'
    })
      .setOrigin(0.5)
      .setScrollFactor(0) // 固定在畫面上，鏡頭移動時仍在同一個螢幕位置
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
