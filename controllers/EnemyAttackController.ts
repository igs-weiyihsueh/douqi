import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Bullet } from '../objects/Bullet';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import { pointInOrientedRect } from '../systems/geometry';
import type { CombatFx } from './CombatFx';

/**
 * EnemyAttackController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface EnemyAttackHost {
  /** 擁有者場景（特效、tween 用） */
  readonly scene: Phaser.Scene;
  /** 全部角色（攻擊判定對象） */
  characters(): ReadonlyArray<Character>;
  /** 敵人物件池（衝鋒怪碰撞） */
  enemies(): Phaser.Physics.Arcade.Group;
  /** 子彈物件池 */
  bullets(): Phaser.Physics.Arcade.Group;
  /** 目前的移動區（子彈出界回收） */
  arena(): Phaser.Geom.Rectangle;
  isGameOver(): boolean;
  /** 時停中（子彈凍結） */
  isTimeStopped(): boolean;
  /** 守護事件中可被攻擊的守護目標；不在守護事件或目標已倒為 null */
  hittableGuardNpc(): Enemy | null;
  /** 守護目標被打中一次（扣血、可能使事件失敗） */
  hitGuardNpc(): void;
  /** 對角色造成傷害（受傷閃紅、陣亡結算由場景處理） */
  damageCharacter(c: Character, amount: number, fromX: number, fromY: number): void;
  /** 戰鬥視覺回饋 */
  fx(): CombatFx;
}

/** 雷射演出：顏色、外框、深度 */
const LASER_COLOR = 0x44ff77;
const LASER_STROKE = 0xccffdd;
const LASER_DEPTH = 19;
/** 投彈：落點預警圈、炸彈本體、爆炸環 */
const BOMB_WARN_COLOR = 0xff4d4d;
const BOMB_WARN_DEPTH = 3;
const BOMB_WARN_BLINK_MS = 200;
const BOMB_RADIUS = 8;
const BOMB_COLOR = 0xe0b0ff;
const BOMB_STROKE = 0x7a3fb0;
const BOMB_DEPTH = 21;
const BOMB_RING_COLOR = 0xff6a3a;
const BOMB_RING_MS = 260;
const BOMB_SHAKE_MS = 80;
const BOMB_SHAKE_INTENSITY = 0.006;

/**
 * 敵人的攻擊（掛在每隻敵人的回呼上）：近戰蓄力發動、射手子彈與雷射、投彈兵炸彈、衝鋒怪衝刺撞擊。
 * 守護事件期間，雷射、炸彈與子彈也會打中守護目標（每隻怪 / 每顆子彈有攻擊冷卻）
 */
export class EnemyAttackController {
  constructor(private readonly host: EnemyAttackHost) {}

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /**
   * 掛上敵人的攻擊回呼（近戰 / 射擊 / 雷射 / 投彈）
   *
   * @param e 剛從物件池取出的敵人
   */
  wire(e: Enemy): void {
    e.onAttackFire = this.onAttackFire;
    e.onShoot = this.onShoot;
    e.onLaserFire = this.onLaserFire;
    e.onBombThrow = this.onBombThrow;
  }

  /**
   * 每幀：子彈前進與出界回收（時停中凍結）；守護事件中子彈碰到守護目標就回收並判傷
   *
   * @param time 目前場景時間
   */
  updateBullets(time: number): void {
    const arena = this.host.arena();
    for (const child of this.host.bullets().getChildren()) {
      const bullet = child as Bullet;
      if (!bullet.active) continue;
      if (this.host.isTimeStopped()) {
        (bullet.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        continue;
      }
      bullet.tick(time, arena);
      const npc = this.host.hittableGuardNpc();
      if (npc && bullet.active) {
        const hitR = GameConfig.enemy.shooter.bulletRadius + npc.getBodyRadius();
        if (Phaser.Math.Distance.Between(bullet.x, bullet.y, npc.x, npc.y) <= hitR) {
          bullet.recycle();
          if (time >= npc.bulletNpcHitAt) {
            npc.bulletNpcHitAt = time + GameConfig.event.guard.npcAttackCooldownMs;
            this.host.hitGuardNpc();
          }
        }
      }
    }
  }

  /**
   * 每幀：衝刺中的衝鋒怪撞到角色造成傷害
   */
  updateChargerCollisions(): void {
    const cfg = GameConfig.enemy.charger;
    const hitR = cfg.dashHitRadius + GameConfig.player.radius;
    for (const child of this.host.enemies().getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.active || !enemy.isChargerDashing()) continue;
      for (const c of this.host.characters()) {
        if (!c.alive) continue;
        if (Phaser.Math.Distance.Between(enemy.x, enemy.y, c.x, c.y) <= hitR) {
          this.host.damageCharacter(c, cfg.dashDamage, enemy.x, enemy.y);
        }
      }
    }
  }

  /** 子彈撞到角色（物理 overlap 回呼）：回收子彈並扣血 */
  readonly onBulletHitCharacter = (
    charObj: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    bulletObj: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ): void => {
    if (this.host.isGameOver()) return;
    const c = charObj as unknown as Character;
    const bullet = bulletObj as unknown as Bullet;
    if (!c.alive || !bullet.active) return;
    bullet.recycle();
    this.host.damageCharacter(c, GameConfig.enemy.shooter.bulletDamage, bullet.x, bullet.y);
  };

  /** 近戰蓄力發動：閃一下攻擊範圍，範圍內所有存活角色受傷 */
  private readonly onAttackFire = (enemy: Enemy): void => {
    if (this.host.isGameOver()) return;
    this.host.fx().attackFlash(enemy.x, enemy.y);
    for (const c of this.host.characters()) {
      if (!c.alive) continue;
      if (Phaser.Math.Distance.Between(enemy.x, enemy.y, c.x, c.y) > GameConfig.enemy.attackRadius) continue;
      this.host.damageCharacter(c, GameConfig.enemy.attackDamage, enemy.x, enemy.y);
    }
  };

  /** 射手發射子彈 */
  private readonly onShoot = (enemy: Enemy, angle: number): void => {
    if (this.host.isGameOver()) return;
    const bullet = this.host.bullets().get(enemy.x, enemy.y) as Bullet | null;
    if (!bullet) return;
    bullet.fire(enemy.x, enemy.y, angle, this.scene.time.now);
  };

  /**
   * 射手雷射：以怪為起點朝 angle 的直線矩形內存活且非無敵的角色受傷（守護目標另有每隻怪的攻擊冷卻），
   * 並畫一道短暫的亮綠雷射
   */
  private readonly onLaserFire = (enemy: Enemy, angle: number): void => {
    if (this.host.isGameOver() || !enemy.active) return;
    const cfg = GameConfig.enemy.shooter;
    const ox = enemy.x, oy = enemy.y;
    const now = this.scene.time.now;
    const inBeam = (x: number, y: number): boolean => pointInOrientedRect(x, y, ox, oy, angle, 0, cfg.laserLength, cfg.laserWidth);
    for (const c of this.host.characters()) {
      if (!c.alive || c.isInvulnerable(now)) continue;
      if (inBeam(c.x, c.y)) this.host.damageCharacter(c, cfg.laserDamage, ox, oy);
    }
    const npc = this.host.hittableGuardNpc();
    if (npc && inBeam(npc.x, npc.y)) this.hitGuardNpcOnce(enemy, now);
    const ex = ox + Math.cos(angle) * cfg.laserLength;
    const ey = oy + Math.sin(angle) * cfg.laserLength;
    const beam = this.scene.add
      .rectangle((ox + ex) / 2, (oy + ey) / 2, cfg.laserLength, cfg.laserWidth, LASER_COLOR, 0.85)
      .setRotation(angle)
      .setDepth(LASER_DEPTH);
    beam.setStrokeStyle(2, LASER_STROKE, 0.9);
    this.scene.tweens.add({ targets: beam, alpha: 0, duration: cfg.laserOnDurationMs, onComplete: () => beam.destroy() });
  };

  /**
   * 投彈兵投彈：落點顯示閃爍預警圈，炸彈飛到落點後爆炸，半徑內存活且非無敵的角色受傷
   * （守護目標另有每隻怪的攻擊冷卻），並有爆炸環與震動
   */
  private readonly onBombThrow = (enemy: Enemy, tx: number, ty: number): void => {
    if (this.host.isGameOver() || !enemy.active) return;
    const cfg = GameConfig.enemy.bomber;
    const warn = this.scene.add.circle(tx, ty, cfg.bombRadius, BOMB_WARN_COLOR, 0.15).setDepth(BOMB_WARN_DEPTH);
    warn.setStrokeStyle(2, BOMB_WARN_COLOR, 0.7);
    const warnTween = this.scene.tweens.add({ targets: warn, alpha: 0.3, duration: BOMB_WARN_BLINK_MS, yoyo: true, repeat: -1 });
    const bomb = this.scene.add.circle(enemy.x, enemy.y, BOMB_RADIUS, BOMB_COLOR, 1).setDepth(BOMB_DEPTH);
    bomb.setStrokeStyle(2, BOMB_STROKE, 1);
    this.scene.tweens.add({
      targets: bomb, x: tx, y: ty, duration: cfg.bombFlightMs, ease: 'Sine.easeIn',
      onComplete: () => {
        bomb.destroy();
        warnTween.remove();
        warn.destroy();
        if (this.host.isGameOver()) return;
        const now = this.scene.time.now;
        for (const c of this.host.characters()) {
          if (!c.alive || c.isInvulnerable(now)) continue;
          if (Phaser.Math.Distance.Between(c.x, c.y, tx, ty) <= cfg.bombRadius) this.host.damageCharacter(c, cfg.bombDamage, tx, ty);
        }
        const npc = this.host.hittableGuardNpc();
        if (npc && Phaser.Math.Distance.Between(npc.x, npc.y, tx, ty) <= cfg.bombRadius) this.hitGuardNpcOnce(enemy, now);
        this.host.fx().expandingRing(tx, ty, cfg.bombRadius, BOMB_RING_COLOR, BOMB_RING_MS);
        this.host.fx().shake(BOMB_SHAKE_MS, BOMB_SHAKE_INTENSITY);
      }
    });
  };

  /** 雷射 / 炸彈打中守護目標：每隻怪有攻擊冷卻 */
  private hitGuardNpcOnce(enemy: Enemy, now: number): void {
    if (now < enemy.nextNpcHitAt) return;
    enemy.nextNpcHitAt = now + GameConfig.event.guard.npcAttackCooldownMs;
    this.host.hitGuardNpc();
  }
}
