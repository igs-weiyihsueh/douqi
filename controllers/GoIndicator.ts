import Phaser from 'phaser';
import { GameConfig } from '../config';

/** GO 指示的方向：左、右出口或上方出口 */
export type GoDirection = 'L' | 'R' | 'U';

/** 一個方向的 GO：「GO」字與箭頭的組合、對應的出口標記，以及目前是否貼在出口旁 */
interface GoLabel {
  group: Phaser.GameObjects.Container;
  /** 組合的半寬 / 半高（定位與夾限用） */
  halfW: number;
  halfH: number;
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
 * 出口開啟時的 GO 指示：發光的「GO」字加上同色調、同樣發光的方向箭頭（純三角形），
 * 排列為 右：GO ▶、左：◀ GO、上：▲ 疊在 GO 上方，整組一起閃動。每幀依出口是否在畫面內決定位置：
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
    const { group, halfW, halfH } = this.buildGroup(dir);
    group.setDepth(cfg.depth);
    // 閃動發光：整組的透明度與大小同步脈動
    this.scene.tweens.add({
      targets: group, alpha: { from: 1, to: cfg.blinkMinAlpha }, scale: { from: cfg.pulseScale, to: 1 },
      duration: cfg.blinkMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
    const label: GoLabel = { group, halfW, halfH, targetX, targetY, targetRadius, onTarget: false };
    label.onTarget = this.targetFullyVisible(label, 0);
    const pos = this.targetPosition(dir, label);
    group.setPosition(pos.x, pos.y); // 第一次直接放到位，不從原點滑過來
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
      label.group.setPosition(label.group.x + (pos.x - label.group.x) * t, label.group.y + (pos.y - label.group.y) * t);
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
    this.scene.tweens.killTweensOf(label.group);
    label.group.destroy();
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

  /**
   * 建立「GO」字 + 箭頭的組合（容器原點在組合中心）
   *
   * @param dir 出口方向（決定箭頭朝向與排列）
   */
  private buildGroup(dir: GoDirection): { group: Phaser.GameObjects.Container; halfW: number; halfH: number } {
    const cfg = GameConfig.stage.goIndicator;
    // 文字畫布四周留出光暈半徑的空間，避免陰影被畫布邊界切掉而出現方框
    const pad = cfg.glowBlur + cfg.strokeThickness;
    const text = this.scene.add.text(0, 0, 'GO', {
      fontFamily: 'monospace', fontSize: cfg.fontSize, color: cfg.color,
      stroke: cfg.strokeColor, strokeThickness: cfg.strokeThickness, fontStyle: 'bold',
      padding: { x: pad, y: pad }
    }).setOrigin(0.5).setShadow(0, 0, cfg.glowColor, cfg.glowBlur, true, true);
    this.ensureArrowTexture();
    const arrow = this.scene.add.image(0, 0, ARROW_TEXTURE_KEY).setRotation(DIRECTION_ANGLE[dir]);
    // 實際字形大小（扣掉畫布留白）與箭頭大小（不含光暈）
    const textW = text.width - pad * 2, textH = text.height - pad * 2;
    const arrowLen = cfg.arrowSize * 2;
    if (dir === 'U') {
      // 箭頭疊在字的上方
      const totalH = arrowLen + cfg.arrowGap + textH;
      arrow.setPosition(0, -totalH / 2 + arrowLen / 2);
      text.setPosition(0, totalH / 2 - textH / 2);
      return { group: this.scene.add.container(0, 0, [text, arrow]), halfW: Math.max(textW, arrowLen) / 2, halfH: totalH / 2 };
    }
    // 左右：箭頭在字的外側（右出口 GO ▶、左出口 ◀ GO）
    const totalW = textW + cfg.arrowGap + arrowLen;
    const side = dir === 'R' ? 1 : -1;
    text.setPosition(-side * (totalW / 2 - textW / 2), 0);
    arrow.setPosition(side * (totalW / 2 - arrowLen / 2), 0);
    return { group: this.scene.add.container(0, 0, [text, arrow]), halfW: totalW / 2, halfH: Math.max(textH, arrowLen) / 2 };
  }

  /**
   * 產生朝右的箭頭紋理（只產生一次）：與 GO 同色調的實心三角形，外圍由大到小疊幾層半透明三角形做光暈
   */
  private ensureArrowTexture(): void {
    if (this.scene.textures.exists(ARROW_TEXTURE_KEY)) return;
    const cfg = GameConfig.stage.goIndicator;
    const s = cfg.arrowSize;
    const half = s + cfg.arrowGlowSpread;
    const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
    const triangle = (k: number): void => {
      g.fillTriangle(half + k, half, half - k, half - k, half - k, half + k);
    };
    for (let i = cfg.arrowGlowLayers; i >= 1; i--) {
      g.fillStyle(cfg.arrowGlowColor, cfg.arrowGlowAlpha / cfg.arrowGlowLayers);
      triangle(s + (cfg.arrowGlowSpread * i) / cfg.arrowGlowLayers);
    }
    g.fillStyle(cfg.arrowColor, 1);
    triangle(s);
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
   * GO 組合中心應在的世界座標：出口在畫面內時在出口上方（上方空間不足就放出口下方）；
   * 否則貼畫面對應邊緣，夾在上方 HUD 與下方面板之間
   */
  private targetPosition(dir: GoDirection, label: GoLabel): { x: number; y: number } {
    const cfg = GameConfig.stage.goIndicator;
    const view = this.scene.cameras.main.worldView;
    const minY = view.top + cfg.edgeMinY + label.halfH, maxY = view.bottom - cfg.edgeBottomMargin - label.halfH;
    const minX = view.left + cfg.edgeInset + label.halfW, maxX = view.right - cfg.edgeInset - label.halfW;
    const offset = label.targetRadius + cfg.gapFromTarget + label.halfH;
    const aboveY = label.targetY - offset;
    if (label.onTarget) {
      // 出口貼近畫面邊緣時，組合仍夾在畫面內
      return { x: Phaser.Math.Clamp(label.targetX, minX, maxX), y: aboveY >= minY ? aboveY : label.targetY + offset };
    }
    if (dir === 'U') return { x: Phaser.Math.Clamp(label.targetX, minX, maxX), y: minY };
    return { x: dir === 'L' ? minX : maxX, y: Phaser.Math.Clamp(aboveY, minY, maxY) };
  }
}
