import Phaser from 'phaser';
import { GameConfig } from '../config';

/** 隱藏入口拱門紋理 key（有正式素材時由 BootScene 載入；沒有時用程式畫的替代圖） */
export const HIDDEN_GATE_TEXTURE_KEY = 'hidden-gate';
/** 開啟時的光暈紋理 key */
const GLOW_TEXTURE_KEY = 'hidden-gate-glow';

/**
 * 隱藏入口（熔岩拱門）：每個區域開打時依 spawnChance 在上方邊界隨機位置出現，平常是灰暗的裝飾；
 * 開啟後恢復原色並加上脈動的熔岩光暈，成為可進入的入口（進入與獎勵關由場景處理）。
 */
export class HiddenGateController {
  private gate: Phaser.GameObjects.Image | null = null;
  private glow: Phaser.GameObjects.Image | null = null;
  private opened = false;

  constructor(private readonly scene: Phaser.Scene) {}

  /** 這一區是否有拱門 */
  get exists(): boolean {
    return this.gate !== null;
  }

  /** 拱門是否已開啟 */
  get isOpen(): boolean {
    return this.opened;
  }

  /** 拱門入口位置（拱門底部中央，世界座標；也是觸發點）；沒有拱門時為 null */
  get entrance(): { x: number; y: number } | null {
    return this.gate ? { x: this.gate.x, y: this.gate.y } : null;
  }

  /** 拱門洞口中心與大致半徑（GO 指向的目標）；沒有拱門時為 null */
  get doorway(): { x: number; y: number; radius: number } | null {
    const gate = this.gate;
    if (!gate) return null;
    const cfg = GameConfig.stage.hiddenGate;
    return { x: gate.x, y: gate.y - gate.displayHeight * cfg.glowCenterRatio, radius: gate.displayWidth * cfg.doorwayRadiusRatio };
  }

  /**
   * 新區域開打：清掉上一區的拱門，依 spawnChance 決定這一區是否出現
   *
   * @param zone 這一區的移動區
   * @param force true = 一定出現（除錯用）
   */
  spawnFor(zone: Phaser.Geom.Rectangle, force = false): void {
    this.clear();
    const cfg = GameConfig.stage.hiddenGate;
    if (!force && Math.random() >= cfg.spawnChance) return;
    this.ensureTextures();
    // 上方邊界隨機位置：離左右邊 edgeMargin，並避開中央的上方出口
    let x = zone.centerX;
    for (let tries = 0; tries < 20 && Math.abs(x - zone.centerX) < cfg.centerExclusion; tries++) {
      x = Phaser.Math.Between(zone.left + cfg.edgeMargin, zone.right - cfg.edgeMargin);
    }
    const y = zone.top + cfg.topInset;
    const gate = this.scene.add.image(x, y, HIDDEN_GATE_TEXTURE_KEY).setOrigin(0.5, 1).setDepth(cfg.depth);
    gate.setScale(cfg.displayHeight / gate.height);
    this.gate = gate;
    this.opened = false;
    this.applyClosedLook();
  }

  /** 開啟拱門：恢復原色、加上脈動的熔岩光暈 */
  open(): void {
    const gate = this.gate;
    if (!gate || this.opened) return;
    const cfg = GameConfig.stage.hiddenGate;
    this.opened = true;
    gate.clearTint().setAlpha(1);
    // 光暈在拱門洞口中央，疊在拱門後方
    const glow = this.scene.add.image(gate.x, gate.y - gate.displayHeight * cfg.glowCenterRatio, GLOW_TEXTURE_KEY)
      .setDepth(cfg.depth - 0.1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(cfg.glowMinAlpha);
    this.scene.tweens.add({
      targets: glow, alpha: cfg.glowMaxAlpha, scale: { from: 1, to: cfg.glowPulseScale },
      duration: cfg.glowPulseMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
    // 拱門本體跟著微微明暗閃爍（符文發光感）
    this.scene.tweens.add({
      targets: gate, alpha: { from: 1, to: cfg.openFlickerAlpha },
      duration: cfg.glowPulseMs * 0.5, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
    this.glow = glow;
  }

  /**
   * 除錯：這一區沒有拱門就先生成（之後由呼叫端開啟）
   *
   * @param zone 這一區的移動區
   */
  ensureSpawned(zone: Phaser.Geom.Rectangle): void {
    if (!this.gate) this.spawnFor(zone, true);
  }

  /** 移除拱門與光暈 */
  clear(): void {
    if (this.glow) { this.scene.tweens.killTweensOf(this.glow); this.glow.destroy(); this.glow = null; }
    if (this.gate) { this.scene.tweens.killTweensOf(this.gate); this.gate.destroy(); this.gate = null; }
    this.opened = false;
  }

  /** 未開啟：灰暗 */
  private applyClosedLook(): void {
    const cfg = GameConfig.stage.hiddenGate;
    this.gate?.setTint(cfg.closedTint).setAlpha(cfg.closedAlpha);
  }

  /** 確保拱門與光暈紋理存在：沒有正式素材時畫替代圖 */
  private ensureTextures(): void {
    if (!this.scene.textures.exists(HIDDEN_GATE_TEXTURE_KEY)) this.makePlaceholderGate();
    if (!this.scene.textures.exists(GLOW_TEXTURE_KEY)) this.makeGlow();
  }

  /**
   * 替代拱門圖：石造拱圈（暗灰石塊 + 拱心石）、洞口內熔岩漸層、中央符文圓（正式素材到位後不再使用）
   */
  private makePlaceholderGate(): void {
    const w = 240, h = 260, cx = w / 2;
    const outerR = 110, innerR = 70, baseY = h, archY = 120; // 拱圈圓心高度
    const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
    // 洞口：熔岩由下往上漸亮
    g.fillGradientStyle(0x3a0a00, 0x3a0a00, 0xff7a1a, 0xff7a1a, 1);
    g.fillRect(cx - innerR, archY, innerR * 2, baseY - archY);
    g.fillStyle(0x3a0a00, 1);
    g.slice(cx, archY, innerR, Math.PI, 0, false);
    g.fillPath();
    // 拱圈石塊：半圓環分 9 塊 + 兩側柱
    const stones = 9;
    for (let i = 0; i < stones; i++) {
      const a0 = Math.PI + (i / stones) * Math.PI, a1 = Math.PI + ((i + 1) / stones) * Math.PI;
      g.fillStyle(i === Math.floor(stones / 2) ? 0x8a7a6a : 0x5c5248, 1); // 拱心石較亮
      g.beginPath();
      g.arc(cx, archY, outerR, a0, a1, false);
      g.arc(cx, archY, innerR, a1, a0, true);
      g.closePath();
      g.fillPath();
      g.lineStyle(2, 0x2a2420, 1);
      g.strokePath();
    }
    g.fillStyle(0x5c5248, 1);
    g.fillRect(cx - outerR, archY, outerR - innerR, baseY - archY);
    g.fillRect(cx + innerR, archY, outerR - innerR, baseY - archY);
    g.lineStyle(2, 0x2a2420, 1);
    g.strokeRect(cx - outerR, archY, outerR - innerR, baseY - archY);
    g.strokeRect(cx + innerR, archY, outerR - innerR, baseY - archY);
    // 熔岩裂縫
    g.lineStyle(3, 0xff6a1a, 0.9);
    g.lineBetween(cx - outerR + 12, archY + 30, cx - innerR - 8, archY + 90);
    g.lineBetween(cx + outerR - 10, archY + 60, cx + innerR + 8, archY + 120);
    // 中央符文：發光圓 + 十字星
    g.lineStyle(4, 0xffd27a, 0.95);
    g.strokeCircle(cx, archY + 40, 26);
    g.lineBetween(cx, archY + 14, cx, archY + 66);
    g.lineBetween(cx - 26, archY + 40, cx + 26, archY + 40);
    g.generateTexture(HIDDEN_GATE_TEXTURE_KEY, w, h);
    g.destroy();
  }

  /** 開啟光暈：中心亮、往外漸淡的圓（疊加混色） */
  private makeGlow(): void {
    const cfg = GameConfig.stage.hiddenGate;
    const r = cfg.glowRadius, layers = 12;
    const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
    for (let i = layers; i >= 1; i--) {
      g.fillStyle(cfg.glowColor, 1 / layers);
      g.fillCircle(r, r, (r * i) / layers);
    }
    g.generateTexture(GLOW_TEXTURE_KEY, r * 2, r * 2);
    g.destroy();
  }
}
