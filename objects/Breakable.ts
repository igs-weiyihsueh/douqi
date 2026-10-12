import Phaser from 'phaser';
import { GameConfig } from '../config';
import { visibleHalfWidth } from '../systems/spriteFeet';

export type BreakableKind = 'crate' | 'barrel';

/** 一次攻擊命中物件的結果：ignored = 沒算到（已碎 / 倒數中 / 受擊間隔內）、damaged = 扣耐久未碎、broken = 打破 */
export type BreakableHitResult = 'ignored' | 'damaged' | 'broken';

/** 木箱貼圖（WoodenBox.png，BootScene 載入） */
export const CRATE_TEXTURE = 'breakable-crate';
/** 爆炸桶貼圖（BootScene 程式繪製） */
export const BARREL_TEXTURE = 'breakable-barrel';

/**
 * 木箱的碰撞 / 命中半徑：WoodenBox 圖片可見寬度的一半乘上 crate.bodyRadiusRatio（換圖自動跟著變）
 *
 * @param textures 紋理管理器
 */
export function crateBodyRadius(textures: Phaser.Textures.TextureManager): number {
  return visibleHalfWidth(textures, CRATE_TEXTURE) * GameConfig.breakable.crate.bodyRadiusRatio;
}

/**
 * 可打破物件：木箱（crate）與爆炸桶（barrel，打破時範圍爆炸+擊退怪+炸玩家+連鎖；目前由 barrel.enabled 停用）。
 * - 只有【玩家攻擊（普攻揮擊 / 衝刺 / 招式 AOE）】能打，敵人不能破壞，靜止、不攻擊玩家。
 * - 耐久以「被命中次數」計算（不看攻擊力）：每次命中扣 1，歸零才碎；同一物件兩次命中至少相隔 hitIntervalMs
 *   （持續型招式不會每幀都算一下）。受擊時閃白並彈一下。
 * - 帶「碰撞」擋角色+怪（不可穿越）——用 GameScene 每幀【手動分離】（Arcade collider 會 creep）。衝刺穿過不擋。
 * - 命中判定 / 分離都用距離數學（不依賴 physics body），是純顯示 sprite。
 */
export class Breakable extends Phaser.GameObjects.Sprite {
  /** 剩餘耐久（命中次數） */
  hp: number = GameConfig.breakable.crate.hp;
  dead = false;
  kind: BreakableKind = 'crate';
  /** 可推動——被撞時的速度(像素/秒)，每幀由 GameScene 整合+摩擦衰減+邊界/物件分離。 */
  vx = 0;
  vy = 0;
  /** 爆炸桶已打破進入 fuse 倒數(等待爆炸)——期間不再被打、地面警示圈跟隨。 */
  fusing = false;
  /** 碰撞 / 命中半徑（生成時依種類決定） */
  private bodyRadius: number = GameConfig.breakable.barrel.radius;
  /** 下一次可以再被命中的場景時間（受擊間隔） */
  private hittableAt = 0;
  private flashTimer?: Phaser.Time.TimerEvent;
  private popTween?: Phaser.Tweens.Tween;
  get explosive(): boolean { return this.kind === 'barrel'; }

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, CRATE_TEXTURE);
    scene.add.existing(this);
    this.setDepth(5);
  }

  spawnBreakable(x: number, y: number, kind: BreakableKind = 'crate'): void {
    const cfg = GameConfig.breakable;
    this.kind = kind;
    this.hp = kind === 'barrel' ? cfg.barrel.hp : cfg.crate.hp;
    this.bodyRadius = kind === 'barrel' ? cfg.barrel.radius : crateBodyRadius(this.scene.textures);
    this.dead = false;
    this.fusing = false;
    this.hittableAt = 0;
    this.vx = 0; this.vy = 0;
    this.setTexture(kind === 'barrel' ? BARREL_TEXTURE : CRATE_TEXTURE);
    this.setPosition(x, y);
    this.setActive(true);
    this.setVisible(true);
    this.setAlpha(1);
    this.resetHitFeedback();
  }

  /**
   * 被玩家攻擊命中：受擊間隔內、已碎或倒數中不算；否則扣 1 耐久，歸零為打破，未碎時閃白並彈一下
   *
   * @param time 目前場景時間
   */
  hit(time: number): BreakableHitResult {
    if (this.dead || this.fusing || !this.active || time < this.hittableAt) return 'ignored';
    const cfg = GameConfig.breakable;
    this.hittableAt = time + cfg.hitIntervalMs;
    this.hp -= 1;
    if (this.hp <= 0) {
      this.dead = true;
      return 'broken';
    }
    this.playHitFeedback();
    return 'damaged';
  }

  /** 半徑(命中/碰撞分離判定用) */
  getBodyRadius(): number {
    return this.bodyRadius;
  }

  despawn(): void {
    this.resetHitFeedback();
    this.setAlpha(1);
    this.setActive(false);
    this.setVisible(false);
  }

  /** 受擊回饋：整個閃白 hitFlashMs，同時放大到 hitPopScale 再縮回 */
  private playHitFeedback(): void {
    const fb = GameConfig.breakable.hitFeedback;
    this.resetHitFeedback();
    this.setTintFill(0xffffff);
    this.flashTimer = this.scene.time.delayedCall(fb.flashMs, () => this.clearTint());
    this.setScale(fb.popScale);
    this.popTween = this.scene.tweens.add({ targets: this, scale: 1, duration: fb.popMs, ease: 'Back.easeOut' });
  }

  /** 停掉進行中的受擊回饋，恢復原色、原尺寸 */
  private resetHitFeedback(): void {
    this.flashTimer?.remove();
    this.flashTimer = undefined;
    this.popTween?.stop();
    this.popTween = undefined;
    this.clearTint();
    this.setScale(1);
  }
}
