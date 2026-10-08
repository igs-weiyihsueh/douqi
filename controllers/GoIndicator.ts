import Phaser from 'phaser';
import { GameConfig } from '../config';

/** GO 指示的方向：左、右出口或上方出口 */
export type GoDirection = 'L' | 'R' | 'U';

/** 一個方向的 GO：箭頭圖示、對應的出口標記，以及目前是否貼在出口旁 */
interface GoLabel {
  icon: Phaser.GameObjects.Image;
  /** 出口標記圓心（世界座標）與半徑 */
  targetX: number;
  targetY: number;
  targetRadius: number;
  /** true = 出口完整在畫面內，GO 在出口上方；false = GO 貼在畫面對應邊緣 */
  onTarget: boolean;
}

/** GO 箭頭紋理（朝右繪製，依方向旋轉） */
const ARROW_TEXTURE_KEY = 'go-arrow';
/** 各方向箭頭的旋轉角度 */
const DIRECTION_ANGLE: Record<GoDirection, number> = { R: 0, L: Math.PI, U: -Math.PI / 2 };

/**
 * 出口開啟時的 GO 指示：一個指向出口方向、閃動發光的箭頭圖示（三角 + 白圈）。每幀依出口是否在畫面內決定位置：
 * - 出口完整在畫面內 → GO 在出口上方（上方會碰到 HUD 時改放出口下方）
 * - 出口在畫面外 → GO 貼在畫面對應邊緣（左 / 右緣在出口高度、上緣在出口水平位置，皆夾在 HUD 之間），保持可見
 *
 * 兩種位置之間平滑移動；進出畫面的判斷有容差，避免出口剛好在畫面邊緣時來回跳。開始轉場時由場景隱藏
 */
export class GoIndicator {
  private readonly labels = new Map<GoDirection, GoLabel>();

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * 顯示某方向的 GO（已顯示則不重建），之後由 update() 決定位置
   *
   * @param dir 出口方向
   * @param targetX 出口標記圓心 x（世界座標）
   * @param targetY 出口標記圓心 y（世界座標）
   * @param targetRadius 出口標記半徑
   */
  show(dir: GoDirection, targetX: number, targetY: number, targetRadius: number): void {
    if (this.labels.has(dir)) return;
    const cfg = GameConfig.stage.goIndicator;
    this.ensureArrowTexture();
    const icon = this.scene.add.image(0, 0, ARROW_TEXTURE_KEY).setRotation(DIRECTION_ANGLE[dir]).setDepth(cfg.depth);
    // 閃動發光：透明度與大小同步脈動
    this.scene.tweens.add({
      targets: icon, alpha: { from: 1, to: cfg.blinkMinAlpha }, scale: { from: cfg.pulseScale, to: 1 },
      duration: cfg.blinkMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
    const label: GoLabel = { icon, targetX, targetY, targetRadius, onTarget: false };
    label.onTarget = this.targetFullyVisible(label, 0);
    const pos = this.targetPosition(dir, label);
    icon.setPosition(pos.x, pos.y); // 第一次直接放到位，不從原點滑過來
    this.labels.set(dir, label);
  }

  /**
   * 每幀更新：判斷出口是否在畫面內並決定目標位置，GO 平滑移過去
   *
   * @param delta 本幀毫秒
   */
  update(delta: number): void {
    if (this.labels.size === 0) return;
    const cfg = GameConfig.stage.goIndicator;
    const t = Math.min(1, delta / cfg.followMs);
    for (const [dir, label] of this.labels) {
      // 進畫面要完整進入才切到出口上方；離開要超出容差才切回邊緣，避免在邊界來回跳
      label.onTarget = label.onTarget
        ? this.targetFullyVisible(label, -cfg.hysteresisPx)
        : this.targetFullyVisible(label, 0);
      const pos = this.targetPosition(dir, label);
      label.icon.setPosition(label.icon.x + (pos.x - label.icon.x) * t, label.icon.y + (pos.y - label.icon.y) * t);
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
    this.scene.tweens.killTweensOf(label.icon);
    label.icon.destroy();
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

  /** 箭頭外圈半徑（三角半邊長 + 外圈留白） */
  private ringRadius(): number {
    const a = GameConfig.stage.guideArrow;
    return a.size + a.ringPad;
  }

  /**
   * 產生朝右的箭頭紋理（只產生一次）：外圍光暈 + 三角形 + 白色外圈
   */
  private ensureArrowTexture(): void {
    if (this.scene.textures.exists(ARROW_TEXTURE_KEY)) return;
    const a = GameConfig.stage.guideArrow;
    const glow = GameConfig.stage.goIndicator;
    const ring = this.ringRadius();
    const half = ring + glow.glowRadius;
    const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
    // 光暈：由外往內疊幾層半透明圓，越靠近外圈越亮
    for (let i = glow.glowLayers; i >= 1; i--) {
      g.fillStyle(glow.glowColor, glow.glowAlpha / glow.glowLayers);
      g.fillCircle(half, half, ring + (glow.glowRadius * i) / glow.glowLayers);
    }
    // 三角形（尖端朝右）
    g.fillStyle(a.color, 0.95);
    g.fillTriangle(half + a.size, half, half - a.size, half - a.size, half - a.size, half + a.size);
    // 白色外圈
    g.lineStyle(4, 0xffffff, 0.9);
    g.strokeCircle(half, half, ring);
    g.generateTexture(ARROW_TEXTURE_KEY, half * 2, half * 2);
    g.destroy();
  }

  /**
   * 出口標記是否完整在畫面內
   *
   * @param label GO 與其出口
   * @param margin 畫面範圍往外放寬的像素（負值 = 允許超出畫面這麼多仍算在內）
   */
  private targetFullyVisible(label: GoLabel, margin: number): boolean {
    const view = this.scene.cameras.main.worldView;
    const r = label.targetRadius;
    return label.targetX - r >= view.left + margin && label.targetX + r <= view.right - margin &&
      label.targetY - r >= view.top + margin && label.targetY + r <= view.bottom - margin;
  }

  /**
   * GO 箭頭中心應在的世界座標：出口在畫面內時在出口上方（上方空間不足就放出口下方）；
   * 否則貼畫面對應邊緣，夾在上方 HUD 與下方面板之間
   */
  private targetPosition(dir: GoDirection, label: GoLabel): { x: number; y: number } {
    const cfg = GameConfig.stage.goIndicator;
    const ring = this.ringRadius();
    const view = this.scene.cameras.main.worldView;
    const minY = view.top + cfg.edgeMinY + ring, maxY = view.bottom - cfg.edgeBottomMargin - ring;
    const offset = label.targetRadius + cfg.gapFromTarget + ring;
    const aboveY = label.targetY - offset;
    if (label.onTarget) {
      return { x: label.targetX, y: aboveY >= minY ? aboveY : label.targetY + offset };
    }
    if (dir === 'U') {
      return { x: Phaser.Math.Clamp(label.targetX, view.left + cfg.edgeInset, view.right - cfg.edgeInset), y: minY };
    }
    const x = dir === 'L' ? view.left + cfg.edgeInset : view.right - cfg.edgeInset;
    return { x, y: Phaser.Math.Clamp(aboveY, minY, maxY) };
  }
}
