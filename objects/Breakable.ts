import Phaser from 'phaser';
import { GameConfig } from '../config';
import { visibleBounds, type VisibleBounds } from '../systems/spriteFeet';

export type BreakableKind = 'crate' | 'barrel';

/** 一次攻擊命中物件的結果：ignored = 沒算到（已碎 / 倒數中 / 受擊間隔內）、damaged = 扣耐久未碎、broken = 打破 */
export type BreakableHitResult = 'ignored' | 'damaged' | 'broken';

/** 木箱貼圖（WoodenBox.png，BootScene 載入） */
export const CRATE_TEXTURE = 'breakable-crate';
/** 爆炸桶貼圖（BootScene 程式繪製） */
export const BARREL_TEXTURE = 'breakable-barrel';

/**
 * 木箱的碰撞 / 命中範圍（軸對齊矩形，各邊相對物件位置）：WoodenBox 圖片的可見外框，
 * 以外框中心依 crate.bodyScale 縮放（換圖自動跟著變）
 *
 * @param textures 紋理管理器
 */
export function crateBodyBounds(textures: Phaser.Textures.TextureManager): VisibleBounds {
  const b = visibleBounds(textures, CRATE_TEXTURE);
  const scale = GameConfig.breakable.crate.bodyScale;
  const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
  const halfW = (b.right - b.left) / 2 * scale, halfH = (b.bottom - b.top) / 2 * scale;
  return { left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH };
}

/**
 * 點 (px, py) 到「物件位於 (x, y)、範圍 bounds」的碰撞矩形的最短距離（在矩形內為 0）
 *
 * @param px 點 x
 * @param py 點 y
 * @param x 物件位置 x
 * @param y 物件位置 y
 * @param bounds 碰撞範圍（各邊相對物件位置）
 */
export function distanceToBounds(px: number, py: number, x: number, y: number, bounds: VisibleBounds): number {
  const dx = Math.max(x + bounds.left - px, 0, px - (x + bounds.right));
  const dy = Math.max(y + bounds.top - py, 0, py - (y + bounds.bottom));
  return Math.hypot(dx, dy);
}

/**
 * 爆炸桶的碰撞 / 命中範圍：邊長 2 × barrel.radius 的正方形
 */
function barrelBodyBounds(): VisibleBounds {
  const r = GameConfig.breakable.barrel.radius;
  return { left: -r, right: r, top: -r, bottom: r };
}

/**
 * 可打破物件：木箱（crate）與爆炸桶（barrel，打破時範圍爆炸+擊退怪+炸玩家+連鎖；目前由 barrel.enabled 停用）。
 * - 只有【玩家攻擊（普攻揮擊 / 衝刺 / 招式 AOE）】能打，敵人不能破壞，靜止、不攻擊玩家。
 * - 耐久以「被命中次數」計算（不看攻擊力）：每次命中扣 1，歸零才碎；同一物件兩次命中至少相隔 hitIntervalMs
 *   （持續型招式不會每幀都算一下）。受擊時閃白並彈一下。
 * - 碰撞 / 命中範圍是貼合圖片可見外框的軸對齊矩形（getBody）；角色和怪碰到會推動它（systems/bodySeparation），衝刺穿過不擋。
 * - 關卡制從天而降（dropIn）：降落中（landing）不能被打、不參與推擠，落地後才是一般物件。
 * - 命中判定 / 分離都用幾何數學（不依賴 physics body），是純顯示 sprite。
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
  /** 從天而降中（還沒落地）：不能被打、不參與推擠 */
  landing = false;
  /** 碰撞 / 命中範圍各邊相對物件位置（生成時依種類決定） */
  private bodyBounds: VisibleBounds = barrelBodyBounds();
  /** getBody 回傳的矩形（重複使用，不每次配置） */
  private readonly bodyRect = new Phaser.Geom.Rectangle();
  /** 下一次可以再被命中的場景時間（受擊間隔） */
  private hittableAt = 0;
  private flashTimer?: Phaser.Time.TimerEvent;
  private popTween?: Phaser.Tweens.Tween;
  private dropTween?: Phaser.Tweens.Tween;
  private dropShadow?: Phaser.GameObjects.Ellipse;
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
    this.bodyBounds = kind === 'barrel' ? barrelBodyBounds() : crateBodyBounds(this.scene.textures);
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
    this.stopDrop();
  }

  /**
   * 從天而降：本體從目前位置上方 drop.fallHeight 加速直線落回目前位置，落點陰影隨之由小變大；
   * 落地時壓扁彈回並呼叫 onLand（塵土、震動由呼叫端處理）。需在 spawnBreakable 之後呼叫
   *
   * @param onLand 落地時呼叫
   */
  dropIn(onLand: () => void): void {
    const cfg = GameConfig.breakable.drop;
    const b = this.bodyBounds;
    const groundY = this.y;
    const bodyW = b.right - b.left;
    this.landing = true;
    this.dropShadow = this.scene.add
      .ellipse(this.x + (b.left + b.right) / 2, groundY + b.bottom, bodyW * cfg.shadowWidthRatio, bodyW * cfg.shadowHeightRatio, cfg.shadowColor, cfg.shadowAlpha)
      .setDepth(cfg.shadowDepth)
      .setScale(cfg.shadowStartScale);
    this.setY(groundY - cfg.fallHeight);
    this.dropTween = this.scene.tweens.add({
      targets: this,
      y: groundY,
      duration: cfg.fallMs,
      ease: 'Quad.easeIn',
      onUpdate: (tween) => this.dropShadow?.setScale(cfg.shadowStartScale + (1 - cfg.shadowStartScale) * tween.progress),
      onComplete: () => {
        this.dropTween = undefined; // 已播完，不必再停
        this.stopDrop();
        this.setScale(cfg.squashX, cfg.squashY);
        this.popTween = this.scene.tweens.add({ targets: this, scaleX: 1, scaleY: 1, duration: cfg.squashMs, ease: 'Back.easeOut' });
        onLand();
      }
    });
  }

  /**
   * 被玩家攻擊命中：受擊間隔內、已碎或倒數中不算；否則扣 1 耐久，歸零為打破，未碎時閃白並彈一下
   *
   * @param time 目前場景時間
   */
  hit(time: number): BreakableHitResult {
    if (this.dead || this.fusing || this.landing || !this.active || time < this.hittableAt) return 'ignored';
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

  /**
   * 目前位置的碰撞 / 命中矩形（世界座標）。回傳的是共用物件，只在當下讀取，不要保存
   */
  getBody(): Phaser.Geom.Rectangle {
    const b = this.bodyBounds;
    return this.bodyRect.setTo(this.x + b.left, this.y + b.top, b.right - b.left, b.bottom - b.top);
  }

  /** 碰撞範圍各邊相對物件位置（左、上為負值） */
  get bodyLocalBounds(): Readonly<VisibleBounds> {
    return this.bodyBounds;
  }

  /**
   * 點 (px, py) 到碰撞矩形的最短距離（在矩形內為 0）
   *
   * @param px 點 x
   * @param py 點 y
   */
  distanceTo(px: number, py: number): number {
    return distanceToBounds(px, py, this.x, this.y, this.bodyBounds);
  }

  despawn(): void {
    this.resetHitFeedback();
    this.stopDrop();
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

  /** 結束降落狀態：停掉落下動畫、移除陰影 */
  private stopDrop(): void {
    this.dropTween?.stop();
    this.dropTween = undefined;
    this.dropShadow?.destroy();
    this.dropShadow = undefined;
    this.landing = false;
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
