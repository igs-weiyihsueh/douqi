import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import type { CombatFx } from './CombatFx';

/**
 * EnemyAttackController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface EnemyAttackHost {
  /** 擁有者場景（特效、tween 用） */
  readonly scene: Phaser.Scene;
  /** 全部角色（攻擊判定對象） */
  characters(): ReadonlyArray<Character>;
  isGameOver(): boolean;
  /** 守護事件中可被攻擊的守護目標；不在守護事件或目標已倒為 null */
  hittableGuardNpc(): Enemy | null;
  /** 守護目標被打中一次（扣血、可能使事件失敗） */
  hitGuardNpc(): void;
  /** 對角色造成傷害（受傷閃紅、陣亡結算由場景處理） */
  damageCharacter(c: Character, amount: number, fromX: number, fromY: number): void;
  /** 戰鬥視覺回饋 */
  fx(): CombatFx;
}

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
 * 敵人的攻擊（掛在每隻敵人的回呼上）：近戰蓄力發動、投彈兵炸彈。
 * 守護事件期間，炸彈也會打中守護目標（每隻怪有攻擊冷卻）
 */
export class EnemyAttackController {
  constructor(private readonly host: EnemyAttackHost) {}

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /**
   * 掛上敵人的攻擊回呼（近戰 / 投彈）
   *
   * @param e 剛從物件池取出的敵人
   */
  wire(e: Enemy): void {
    e.onAttackFire = this.onAttackFire;
    e.onBombThrow = this.onBombThrow;
  }

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

  /** 炸彈打中守護目標：每隻怪有攻擊冷卻 */
  private hitGuardNpcOnce(enemy: Enemy, now: number): void {
    if (now < enemy.nextNpcHitAt) return;
    enemy.nextNpcHitAt = now + GameConfig.event.guard.npcAttackCooldownMs;
    this.host.hitGuardNpc();
  }
}
