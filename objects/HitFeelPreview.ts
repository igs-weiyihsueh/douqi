import Phaser from 'phaser';
import { SKIN_TEXTURE } from '../controllers/ArtStyleController';
import { CombatFx } from '../controllers/CombatFx';
import { HitSparks, hitPoseAt } from '../controllers/HitReactionFx';
import { hitFeel } from '../systems/hitFeelParams';

/** 示範用的敵人圖（F4 骷髏兵；原圖面向右） */
const ENEMY_TEXTURE = 'skeleton-warrior';

/** 預覽版面（相對預覽區中心，px） */
const LAYOUT = {
  /** 地面（角色與怪的腳底）y */
  GROUND_Y: 80,
  /** 角色起點 x、怪站立 x */
  ATTACKER_START_X: -170,
  ENEMY_X: 80,
  /** 角色撞到怪時，兩者中心的水平距離 */
  CONTACT_GAP: 60,
  /** 角色與怪的縮放 */
  ATTACKER_SCALE: 0.45,
  ENEMY_SCALE: 0.6,
  /** 地面線半寬、顏色、透明度 */
  GROUND_HALF_WIDTH: 220,
  GROUND_COLOR: 0x94a3b8,
  GROUND_ALPHA: 0.5
} as const;

/** 示範節奏 */
const TIMING = {
  /** 每輪開始前的停頓（毫秒） */
  IDLE_MS: 350,
  /** 角色衝刺速度（px／秒；與慢速模式衝刺速度同量級） */
  DASH_SPEED: 700,
  /** 怪被擊退滑行的距離（px）與時間（毫秒） */
  KNOCKBACK_PX: 70,
  KNOCKBACK_MS: 350,
  /** 擊退結束後停留多久再重播（毫秒） */
  HOLD_MS: 600
} as const;

/** 受擊閃白顏色 */
const FLASH_COLOR = 0xffffff;

/**
 * 打擊感編輯器的即時預覽：循環播放「角色衝刺 → 切入 → 刀光、火花、怪閃白壓扁 → 凍結 → 擊退」。
 * 每幀依 hitFeel() 目前值計算（編輯器以 setHitFeel 套用未儲存的數值），與遊戲中使用同一套火花與受擊變形。
 * 角色與怪放在面板 container 內；火花與刀光畫在場景座標、面板之上
 */
export class HitFeelPreview {
  private readonly attacker: Phaser.GameObjects.Image;
  private readonly enemy: Phaser.GameObjects.Image;
  private readonly ground: Phaser.GameObjects.Rectangle;
  private readonly sparks: HitSparks;
  private readonly fx: CombatFx;
  /** 本輪開始的場景時間 */
  private cycleStart = 0;
  /** 本輪是否已觸發命中特效（火花、刀光只放一次） */
  private hitFired = false;

  /**
   * @param scene 所在場景（主選單）
   * @param container 面板的 container
   * @param x 預覽區中心 x（container 內座標）
   * @param y 預覽區中心 y（container 內座標）
   * @param depth 面板深度（火花與刀光畫在 depth + 2 / + 3）
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly container: Phaser.GameObjects.Container,
    private readonly x: number,
    private readonly y: number,
    private readonly depth: number
  ) {
    this.ground = scene.add.rectangle(x, y + LAYOUT.GROUND_Y, LAYOUT.GROUND_HALF_WIDTH * 2, 2, LAYOUT.GROUND_COLOR, LAYOUT.GROUND_ALPHA);
    // 原點在腳底：壓扁時腳不離地
    this.attacker = scene.add.image(0, 0, SKIN_TEXTURE).setOrigin(0.5, 1).setScale(LAYOUT.ATTACKER_SCALE).setFlipX(true); // 原圖面左 → 翻成面右
    this.enemy = scene.add.image(0, 0, ENEMY_TEXTURE).setOrigin(0.5, 1).setScale(LAYOUT.ENEMY_SCALE).setFlipX(true); // 原圖面右 → 翻成面左
    container.add([this.ground, this.attacker, this.enemy]);
    this.sparks = new HitSparks(scene, depth + 2);
    this.fx = new CombatFx(scene);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.restart();
  }

  /** 重新開始一輪示範（數值改變時呼叫，立即用新參數重播） */
  restart(): void {
    this.cycleStart = this.scene.time.now;
    this.hitFired = false;
    this.enemy.clearTint();
  }

  /** 銷毀（面板關閉時呼叫） */
  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.sparks.destroy();
    this.ground.destroy();
    this.attacker.destroy();
    this.enemy.destroy();
  }

  /** 每幀：依本輪經過時間擺放角色與怪、在命中瞬間放特效，播完自動重播 */
  private tick(): void {
    const p = hitFeel();
    const t = this.scene.time.now - this.cycleStart;
    const groundY = this.y + LAYOUT.GROUND_Y;
    const startX = this.x + LAYOUT.ATTACKER_START_X;
    const enemyX = this.x + LAYOUT.ENEMY_X;
    const contactX = enemyX - LAYOUT.CONTACT_GAP;
    const hitAt = TIMING.IDLE_MS + ((contactX - startX) / TIMING.DASH_SPEED) * 1000;
    const cutInMs = p.cutInEnabled === 1 ? p.cutInMs : 0;
    const freezeMs = p.hitstopEnabled === 1 ? Math.min(p.freezeMs, p.maxFreezeMs) : 0;
    const knockbackAt = hitAt + freezeMs;
    const cycleEnd = Math.max(hitAt + cutInMs, knockbackAt + TIMING.KNOCKBACK_MS, hitAt + p.reactionMs) + TIMING.HOLD_MS;
    if (t >= cycleEnd) {
      this.restart();
      return;
    }

    // 角色：停頓 → 全速衝刺 → 撞到後以切入速度陷入 cutInMs → 停
    let ax = startX;
    if (t >= TIMING.IDLE_MS) {
      const dashT = Math.min(t, hitAt) - TIMING.IDLE_MS;
      ax += (dashT / 1000) * TIMING.DASH_SPEED;
      if (t > hitAt) ax += (Math.min(t - hitAt, cutInMs) / 1000) * TIMING.DASH_SPEED * p.cutInSpeedRatio;
    }
    this.attacker.setPosition(ax, groundY);

    // 命中瞬間：刀光、火花、閃白（只放一次）
    if (!this.hitFired && t >= hitAt) {
      this.hitFired = true;
      const wx = this.container.x + enemyX;
      const wy = this.container.y + groundY - this.enemy.displayHeight / 2;
      if (p.streakEnabled === 1) this.fx.slashStreak(wx, wy, 0, false, this.depth + 3);
      this.sparks.emit(wx, wy, 0, false);
      if (p.enemyFlashMs > 0) this.enemy.setTintFill(FLASH_COLOR);
    }
    if (this.hitFired && t >= hitAt + p.enemyFlashMs) this.enemy.clearTint();

    // 怪：凍結期間原地，之後擊退滑行（ease-out）；受擊變形與遊戲中相同
    let ex = enemyX;
    if (t > knockbackAt) {
      const k = Math.min(1, (t - knockbackAt) / TIMING.KNOCKBACK_MS);
      ex += TIMING.KNOCKBACK_PX * (1 - (1 - k) * (1 - k));
    }
    const pose = t >= hitAt ? hitPoseAt(t - hitAt) : null;
    this.enemy.setPosition(ex + (pose ? pose.jitterX : 0), groundY);
    this.enemy.setScale(LAYOUT.ENEMY_SCALE * (pose ? pose.scaleXMult : 1), LAYOUT.ENEMY_SCALE * (pose ? pose.scaleYMult : 1));
  }
}
