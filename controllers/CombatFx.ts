import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import { hitFeel } from '../systems/hitFeelParams';

/** 擴張環：初始半徑、深度、透明度、邊框粗細 */
const RING_START_RADIUS = 10;
const RING_DEPTH = 20;
/** 衝撞命中衝擊：起始半徑、深度、邊框粗細 */
const IMPACT_START_RADIUS = 8;
const IMPACT_DEPTH = 41;
/** 扇形劍氣深度 */
const ARC_DEPTH = 41;
/** 受傷閃紅的顏色與時間 */
const HURT_TINT = 0xff4444;
const HURT_FLASH_MS = 120;
/** 傷害數字：樣式、深度、往上飄的距離 */
const DAMAGE_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace', fontSize: '18px', color: '#ffe66d', stroke: '#000000', strokeThickness: 3
};
const DAMAGE_TEXT_DEPTH = 50;
/** 斬擊圈：起始 / 結束半徑、深度、時間 */
const SLASH_START_RADIUS = 6;
const SLASH_END_RADIUS = 42;
const SLASH_DEPTH = 40;
const SLASH_MS = 200;
/** 死亡爆散：粒子顏色、深度、存在時間 */
const DEATH_TINT = 0xff5a6e;
const DEATH_DEPTH = 45;
const DEATH_LIFESPAN_MS = 300;
const DEATH_DESTROY_MS = 320;
/** 刀光：深度（火花之下、斬擊圈之上）、外層光暈相對粗細與透明度、內層亮芯顏色 */
const STREAK_DEPTH = 43;
const STREAK_GLOW_WIDTH_MULT = 3;
const STREAK_GLOW_ALPHA = 0.45;
const STREAK_CORE_COLOR = 0xffffff;
/** 敵人近戰發動閃光：顏色、深度、時間 */
const ATTACK_FLASH_COLOR = 0xff3344;
const ATTACK_FLASH_DEPTH = 3;
const ATTACK_FLASH_MS = 160;

/**
 * 戰鬥視覺回饋（不影響判定與數值）：擴張環、衝撞衝擊、扇形劍氣、斬擊圈、傷害數字、死亡爆散、敵人近戰閃光、
 * 角色 / 敵人閃白與受傷閃紅、螢幕震動（同時間只震一個）。
 * 傷害數字與死亡爆散共用存活數量節流：超過 juice.maxActiveFx 時略過新的視覺
 */
export class CombatFx {
  /** 目前存活中的節流特效數 */
  private active = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  /** 目前存活中的節流特效數（除錯用） */
  get activeCount(): number {
    return this.active;
  }

  /**
   * 由小擴張到 radius 並淡出的圓環（招式範圍提示）
   *
   * @param ms 擴張時間
   */
  expandingRing(x: number, y: number, radius: number, color: number, ms = 300): void {
    const ring = this.scene.add.circle(x, y, RING_START_RADIUS, color, 0.35).setDepth(RING_DEPTH);
    ring.setStrokeStyle(4, color, 0.9);
    this.scene.tweens.add({
      targets: ring, radius, alpha: 0, duration: ms, ease: 'Cubic.easeOut',
      onUpdate: () => ring.setRadius(ring.radius),
      onComplete: () => ring.destroy()
    });
  }

  /** 衝撞命中：擴張的衝擊圈 + 命中點亮閃 */
  impact(x: number, y: number): void {
    const cfg = GameConfig.impact;
    const ring = this.scene.add.circle(x, y, IMPACT_START_RADIUS, cfg.ringColor, 0).setDepth(IMPACT_DEPTH);
    ring.setStrokeStyle(5, cfg.ringColor, 0.95);
    this.scene.tweens.add({
      targets: ring, radius: cfg.ringRadius, alpha: 0, duration: cfg.ringMs, ease: 'Cubic.easeOut',
      onUpdate: () => ring.setRadius(ring.radius),
      onComplete: () => ring.destroy()
    });
    const core = this.scene.add.circle(x, y, cfg.ringRadius * 0.35, cfg.coreColor, 0.9).setDepth(IMPACT_DEPTH + 1);
    this.scene.tweens.add({ targets: core, alpha: 0, scale: 1.4, duration: cfg.ringMs * 0.7, onComplete: () => core.destroy() });
  }

  /** 原地扇形劍氣：朝 angle 畫一個帶亮邊的淡出扇形 */
  meleeArc(x: number, y: number, angle: number): void {
    const cfg = GameConfig.melee;
    const half = Phaser.Math.DegToRad(cfg.arcDeg) / 2;
    const g = this.scene.add.graphics().setDepth(ARC_DEPTH);
    g.fillStyle(cfg.arcColor, cfg.arcAlpha);
    g.slice(x, y, cfg.radius, angle - half, angle + half, false);
    g.fillPath();
    g.lineStyle(3, cfg.arcColor, Math.min(1, cfg.arcAlpha + 0.4));
    g.beginPath();
    g.arc(x, y, cfg.radius, angle - half, angle + half);
    g.strokePath();
    this.scene.tweens.add({ targets: g, alpha: 0, duration: cfg.arcFadeMs, onComplete: () => g.destroy() });
  }

  /** 命中點的白色斬擊圈 */
  slash(x: number, y: number): void {
    const ring = this.scene.add.circle(x, y, SLASH_START_RADIUS, 0xffffff, 0.9).setDepth(SLASH_DEPTH);
    this.scene.tweens.add({
      targets: ring, radius: SLASH_END_RADIUS, alpha: 0, duration: SLASH_MS, ease: 'Cubic.easeOut',
      onUpdate: () => ring.setRadius(ring.radius),
      onComplete: () => ring.destroy()
    });
  }

  /**
   * 刀光：穿過命中點、沿攻擊方向的細長亮色斬痕（外層光暈 + 內層亮芯），快速淡出
   *
   * @param x 命中點 x
   * @param y 命中點 y
   * @param angle 斬擊方向（弧度）
   * @param empowered 強化攻擊（金色、加粗）
   */
  slashStreak(x: number, y: number, angle: number, empowered: boolean): void {
    const cfg = GameConfig.cutIn.streak;
    const half = cfg.length / 2;
    const dx = Math.cos(angle) * half, dy = Math.sin(angle) * half;
    const width = empowered ? cfg.empoweredWidth : cfg.width;
    const g = this.scene.add.graphics().setDepth(STREAK_DEPTH);
    g.lineStyle(width * STREAK_GLOW_WIDTH_MULT, empowered ? cfg.empoweredColor : cfg.color, STREAK_GLOW_ALPHA);
    g.lineBetween(x - dx, y - dy, x + dx, y + dy);
    g.lineStyle(width, STREAK_CORE_COLOR, 1);
    g.lineBetween(x - dx, y - dy, x + dx, y + dy);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: cfg.ms, ease: 'Cubic.easeIn', onComplete: () => g.destroy() });
  }

  /** 往上飄的傷害數字（受節流） */
  damageText(x: number, y: number, amount: number): void {
    if (this.active >= GameConfig.juice.maxActiveFx) return;
    this.active++;
    const text = this.scene.add.text(x, y - 10, `${amount}`, DAMAGE_TEXT_STYLE).setOrigin(0.5).setDepth(DAMAGE_TEXT_DEPTH);
    this.scene.tweens.add({
      targets: text, y: y - 48, alpha: 0, duration: GameConfig.juice.damageTextMs, ease: 'Cubic.easeOut',
      onComplete: () => {
        text.destroy();
        this.active--;
      }
    });
  }

  /** 敵人死亡的粒子爆散（受節流） */
  deathBurst(x: number, y: number): void {
    if (this.active >= GameConfig.juice.maxActiveFx) return;
    this.active++;
    const emitter = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 60, max: 220 }, angle: { min: 0, max: 360 }, scale: { start: 1, end: 0 },
      lifespan: DEATH_LIFESPAN_MS, quantity: GameConfig.juice.deathBurstParticles, tint: DEATH_TINT
    });
    emitter.setDepth(DEATH_DEPTH);
    this.scene.time.delayedCall(DEATH_DESTROY_MS, () => {
      emitter.destroy();
      this.active--;
    });
  }

  /** 敵人近戰發動：攻擊範圍閃一下紅圈 */
  attackFlash(x: number, y: number): void {
    const ring = this.scene.add.circle(x, y, GameConfig.enemy.attackRadius, ATTACK_FLASH_COLOR, 0.35).setDepth(ATTACK_FLASH_DEPTH);
    this.scene.tweens.add({ targets: ring, alpha: 0, scale: 1.15, duration: ATTACK_FLASH_MS, onComplete: () => ring.destroy() });
  }

  /** 螢幕震動：鏡頭正在震動時忽略新的（不疊加） */
  shake(duration: number, intensity: number): void {
    const cam = this.scene.cameras.main;
    if (cam.shakeEffect && cam.shakeEffect.isRunning) return;
    cam.shake(duration, intensity);
  }

  /** 角色出手閃白 */
  flashWhite(c: Character): void {
    c.setTintFill(0xffffff);
    this.scene.time.delayedCall(GameConfig.juice.flashMs, () => {
      if (c.active && c.alive) c.clearTint();
    });
  }

  /** 角色受傷閃紅 */
  flashHurt(c: Character): void {
    c.setTint(HURT_TINT);
    this.scene.time.delayedCall(HURT_FLASH_MS, () => {
      if (c.active && c.alive) c.clearTint();
    });
  }

  /** 敵人受擊閃白 */
  flashEnemy(enemy: Enemy): void {
    const ms = hitFeel().enemyFlashMs;
    if (ms <= 0) return;
    enemy.setTintFill(0xffffff);
    this.scene.time.delayedCall(ms, () => {
      if (enemy.active) enemy.clearTint();
    });
  }
}
