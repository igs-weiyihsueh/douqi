import Phaser from 'phaser';
import { GameConfig } from '../config';

/**
 * 波間休息倒數提示（stageMonsters.breakCountdown）：休息剩 fromSec 秒內，畫面中上方顯示提示文字與大數字倒數（3 → 2 → 1），
 * 數字每跳一次彈跳放大；休息結束（下一波湧出）時淡出。固定在畫面上，不隨鏡頭捲動
 */
export class WaveCountdown {
  private readonly title: Phaser.GameObjects.Text;
  private readonly digit: Phaser.GameObjects.Text;
  /** 目前顯示的秒數（0 = 沒有顯示） */
  private shownSec = 0;
  private popTween?: Phaser.Tweens.Tween;

  constructor(private readonly scene: Phaser.Scene) {
    const cfg = GameConfig.stageMonsters.breakCountdown;
    const x = GameConfig.width / 2;
    const y = GameConfig.height * cfg.yRatio;
    // 粗體中文加描邊時字形上緣會超出量到的行高而被切掉，上下留 padding
    const style = (fontSize: number, color: string): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: 'monospace', fontSize: `${fontSize}px`, fontStyle: 'bold', color,
      stroke: cfg.stroke, strokeThickness: cfg.strokeThickness, padding: { top: cfg.paddingY, bottom: cfg.paddingY }
    });
    this.title = scene.add.text(x, y, cfg.text, style(cfg.textFontSize, cfg.color));
    this.digit = scene.add.text(x, y + cfg.digitGap, '', style(cfg.digitFontSize, cfg.digitColor));
    for (const t of [this.title, this.digit]) t.setOrigin(0.5).setScrollFactor(0).setDepth(cfg.depth).setAlpha(0).setVisible(false);
  }

  /**
   * 每幀：依休息剩餘時間顯示、跳秒或隱藏
   *
   * @param remainingMs 波間休息剩餘毫秒（不在休息中傳 0）
   */
  update(remainingMs: number): void {
    const cfg = GameConfig.stageMonsters.breakCountdown;
    const sec = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
    if (sec <= 0 || sec > cfg.fromSec) {
      if (this.shownSec > 0) this.hide();
      return;
    }
    if (sec === this.shownSec) return;
    if (this.shownSec === 0) this.fade(1);
    this.shownSec = sec;
    this.digit.setText(String(sec));
    this.popTween?.stop();
    this.digit.setScale(cfg.popScale);
    this.popTween = this.scene.tweens.add({ targets: this.digit, scale: 1, duration: cfg.popMs, ease: 'Back.easeOut' });
  }

  /** 淡出並隱藏 */
  private hide(): void {
    this.shownSec = 0;
    this.fade(0);
  }

  /**
   * 文字與數字一起淡入（顯示）或淡出（結束後隱藏）
   *
   * @param alpha 目標透明度：1 = 淡入、0 = 淡出
   */
  private fade(alpha: 0 | 1): void {
    const targets = [this.title, this.digit];
    this.scene.tweens.killTweensOf(targets);
    if (alpha === 1) for (const t of targets) t.setVisible(true);
    this.scene.tweens.add({
      targets,
      alpha,
      duration: GameConfig.stageMonsters.breakCountdown.fadeMs,
      onComplete: () => { if (alpha === 0) for (const t of targets) t.setVisible(false); }
    });
  }
}
