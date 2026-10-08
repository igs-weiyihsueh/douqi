import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import { pointInOrientedRect } from '../systems/geometry';
import type { TargetingController } from './TargetingController';

/**
 * ComboSkillController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface ComboSkillHost {
  /** 擁有者場景（特效、計時器、物理暫停用） */
  readonly scene: Phaser.Scene;
  /** 敵人物件池 */
  enemies(): Phaser.Physics.Arcade.Group;
  /** P1 */
  player(): Character;
  isGameOver(): boolean;
  /** 是否為慢速模式（COMBO 與能量兩套獨立系統） */
  isSlowMode(): boolean;
  /** 慢速模式的鎖定範圍圈半徑（變身 AOE 只打圈內） */
  slowLockRadius(): number;
  /** 鎖定與瞄準（變身 AOE 優先打目前鎖定的敵人） */
  targeting(): TargetingController;
  /** 角色對敵人造成傷害（指定爆心，走場景的擊殺結算） */
  damageEnemyFrom(actor: Character, enemy: Enemy, damage: number, knockback: number, fromX: number, fromY: number, time: number): void;
  /** 角色對敵人造成傷害（以角色位置為來源） */
  damageEnemy(actor: Character, enemy: Enemy, damage: number, knockback: number, time: number): void;
  /** 招式 AOE 秒碎可破壞物件（圓形 / 定向矩形） */
  breakInCircle(x: number, y: number, radius: number, time: number): void;
  breakInRect(ox: number, oy: number, dir: number, back: number, length: number, width: number, time: number): void;
  /** COMBO 連擊 +1（一招命中至少一隻算一下） */
  comboRewardHit(c: Character): void;
  /** P1 普攻命中次數 +1（結算統計） */
  countP1AttackHit(): void;
  spawnExpandingRing(x: number, y: number, radius: number, color: number, ms?: number): void;
  shakeOnce(duration: number, intensity: number): void;
  flashWhite(c: Character): void;
  spawnSlashEffect(x: number, y: number): void;
  emitStats(): void;
}

/** 連段技與強化的震動 */
const SKILL_SHAKE_MS = 80;
const SKILL_SHAKE_INTENSITY = 0.006;
/** 爆發每段命中的震動 */
const BURST_TICK_SHAKE_MS = 60;
/** 爆發無敵在連打結束後多留的時間、保底結束的額外時間 */
const BURST_INVULN_EXTRA_MS = 300;
const BURST_FAILSAFE_EXTRA_MS = 500;
/** 圓形斬擴張環 */
const CIRCLE_RING_COLOR = 0x00e5ff;
const CIRCLE_RING_MS = 280;
/** 直線氣波斬擊帶 */
const LINE_BAND_COLOR = 0xff4d6d;
const LINE_BAND_STROKE = 0xffccd5;
const LINE_BAND_DEPTH = 20;
const LINE_BAND_FADE_MS = 300;
/** 強化觸發的擴張環與持續光環 */
const EMPOWER_RING_RADIUS = 120;
const EMPOWER_RING_COLOR = 0xffd700;
const EMPOWER_RING_MS = 400;
const AURA_EXTRA_RADIUS = 16;
const AURA_COLOR = 0xffd700;
const AURA_STROKE = 0xffe066;
const AURA_DEPTH = 8;
const AURA_PULSE_MS = 400;
/** 光環跟隨角色的更新間隔 */
const AURA_FOLLOW_MS = 16;
/** 變身 AOE：內圈擴張環顏色 */
const AOE_INNER_RING_COLOR = 0xfff2a8;

/**
 * 連段技、強化與爆發：
 * - 普攻 / 衝刺命中一次（onComboHit）累積 COMBO：
 *   快速模式一條 COMBO，達門檻依序放圓形斬、直線氣波、爆發，滿 max 進入限時強化並歸零；
 *   慢速模式 COMBO 達門檻放圓形斬、直線氣波（到最高招門檻歸零），能量另外靠擊殺累積、滿了按 Z 手動強化
 * - 強化：快速模式固定時間，慢速模式由能量驅動（能量消退到 0 才解除，在場景 update 處理）；
 *   慢速強化期間攻擊改為以鎖定目標為中心的圓形 AOE，每命中 burstEveryAoeHits 次觸發一次爆發
 * - 爆發：定身無敵連打數段（被打中的怪各自有命中凍結，見 config.hitstop / Enemy.applyKnockback）
 * - 招式期間的「表演時間」：定身並無敵一段時間
 */
export class ComboSkillController {

  constructor(private readonly host: ComboSkillHost) {}

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /** 慢速模式 COMBO 的上限與歸零門檻（= 直線氣波的門檻） */
  get slowComboCap(): number {
    return GameConfig.combo.slowThresholds.line;
  }

  /**
   * 普攻 / 衝刺命中一次：累積 COMBO 並在門檻觸發連段技（P1 另計普攻命中次數）
   *
   * @param c 命中的角色
   * @param time 目前場景時間
   */
  onComboHit(c: Character, time: number): void {
    const isP1 = c === this.host.player();
    if (isP1) this.host.countP1AttackHit();
    const cfg = GameConfig.combo;
    if (this.host.isSlowMode()) {
      // 慢速：COMBO 只管招式（能量改由擊殺累積）
      const cap = this.slowComboCap;
      c.spirit = Math.min(cap, c.spirit + 1);
      const combo = c.spirit;
      if (combo === cfg.slowThresholds.circle) this.comboCircle(c, time);
      if (combo === cfg.slowThresholds.line) this.comboLine(c, time);
      if (combo >= cap) c.spirit = 0;
      if (isP1) this.host.emitStats();
      return;
    }
    // 快速：一條 COMBO，依序圓形斬 / 直線氣波 / 爆發，滿了強化並歸零
    c.spirit = Math.min(cfg.max, c.spirit + 1);
    const combo = c.spirit;
    if (combo === cfg.thresholds.circle) this.comboCircle(c, time);
    if (combo === cfg.thresholds.line) this.comboLine(c, time);
    if (combo === cfg.thresholds.burst) this.triggerBurst(c, time);
    if (combo >= cfg.thresholds.empower) {
      this.comboEmpower(c, time);
      c.spirit = 0;
    }
    if (isP1) this.host.emitStats();
  }

  /**
   * 能量增加（夾在 0 ~ max；強化期間只消退不增加）
   *
   * @param c 角色
   * @param amount 增加量
   */
  gainEnergy(c: Character, amount: number): void {
    if (c.empowered) return;
    c.energy = Math.min(GameConfig.energy.max, c.energy + amount);
    if (c === this.host.player()) this.host.emitStats();
  }

  /**
   * 擊殺獲得能量：依怪種查 perKill 表（未列出的用 default）
   *
   * @param c 角色
   * @param etype 被擊殺的怪種
   */
  grantKillEnergy(c: Character, etype: string): void {
    const ecfg = GameConfig.energy;
    this.gainEnergy(c, ecfg.perKill[etype] ?? ecfg.perKill.default);
  }

  /**
   * 慢速模式按 Z 手動強化（P1 存活、未在強化中、能量達 trigger）
   *
   * @returns 是否觸發
   */
  tryManualEmpower(): boolean {
    if (!this.host.isSlowMode()) return false;
    const c = this.host.player();
    if (!c || !c.alive || c.empowered) return false;
    if (c.energy < GameConfig.energy.trigger) return false;
    this.comboEmpower(c, this.scene.time.now);
    return true;
  }

  /**
   * 慢速強化期間的攻擊目標：範圍圈內的敵人（優先目前鎖定的、否則最近的；只選敵人、不含道具）
   *
   * @param c 施放的角色
   * @returns 目標；圈內沒有可打的敵人時為 null
   */
  pickEmpowerTarget(c: Character): Enemy | null {
    const R = this.host.isSlowMode() ? this.host.slowLockRadius() : GameConfig.lock.searchRadius;
    const targeting = this.host.targeting();
    const cur = targeting.lockedTarget;
    if (cur && !targeting.isItem(cur)) {
      const e = cur as Enemy;
      if (typeof e.isVulnerable === 'function' && targeting.isLockableEnemy(e) &&
          Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y) <= R) {
        return e;
      }
    }
    let target: Enemy | null = null;
    let bestD = R * R;
    for (const child of this.host.enemies().getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead || !e.isVulnerable()) continue;
      const dx = e.x - c.x, dy = e.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD) { bestD = d2; target = e; }
    }
    return target;
  }

  /**
   * 強化衝刺撞到敵人：以撞到的位置為中心炸圓形 AOE（金色擴散圈、輕震），命中時算 COMBO 並累積變身爆發計數
   *
   * @param c 施放的角色
   * @param tx 中心 x（撞到的敵人位置）
   * @param ty 中心 y
   * @param time 目前場景時間
   */
  empowerStrike(c: Character, tx: number, ty: number, time: number): void {
    this.empowerAoeBurst(c, tx, ty, time);
  }

  private empowerAoeBurst(c: Character, tx: number, ty: number, time: number): void {
    const cfg = GameConfig.combo.empower.aoe;
    const radius = cfg.radius;
    const dmg = cfg.damage * GameConfig.combo.empower.damageMult;
    this.host.spawnExpandingRing(tx, ty, radius, cfg.color, cfg.ringMs);
    this.host.spawnExpandingRing(tx, ty, radius * 0.6, AOE_INNER_RING_COLOR, cfg.ringMs * 0.8);
    this.host.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity * 0.5);
    let hitAny = false;
    for (const child of this.host.enemies().getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(tx, ty, enemy.x, enemy.y) <= radius) {
        this.host.damageEnemyFrom(c, enemy, dmg, cfg.knockback, tx, ty, time);
        hitAny = true;
      }
    }
    if (hitAny) {
      this.host.comboRewardHit(c);
      this.registerEmpowerAoeHit(c, time);
    }
  }

  /** 慢速變身專屬爆發：每累積 burstEveryAoeHits 次 AOE 命中觸發一次爆發（爆發中不重複） */
  private registerEmpowerAoeHit(c: Character, time: number): void {
    c.empowerAoeHits++;
    if (c.empowerAoeHits % GameConfig.combo.empower.burstEveryAoeHits !== 0) return;
    if (c.isBursting) return;
    this.triggerBurst(c, time);
  }

  /** 連段技：圓形斬——以角色為中心的圓形 AOE 與擴張環，順手秒碎範圍內的物件，進入表演時間 */
  private comboCircle(c: Character, time: number): void {
    const cfg = GameConfig.combo.circle;
    const radius = cfg.radius;
    const dmg = cfg.damage * (c.isEmpowered(time) ? GameConfig.combo.empower.damageMult : 1);
    this.host.spawnExpandingRing(c.x, c.y, radius, CIRCLE_RING_COLOR, CIRCLE_RING_MS);
    let hitAny = false;
    for (const child of this.host.enemies().getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y) <= radius) {
        this.host.damageEnemyFrom(c, enemy, dmg, cfg.knockback, c.x, c.y, time);
        hitAny = true;
      }
    }
    if (hitAny) this.host.comboRewardHit(c);
    this.host.breakInCircle(c.x, c.y, radius, time);
    this.host.shakeOnce(SKILL_SHAKE_MS, SKILL_SHAKE_INTENSITY);
    this.enterPerformance(c, GameConfig.performanceTime.circle, time);
  }

  /** 連段技：直線氣波——朝 aimAngle 的貫穿矩形，順手秒碎範圍內的物件，進入表演時間 */
  private comboLine(c: Character, time: number): void {
    const cfg = GameConfig.combo.line;
    const length = cfg.length;
    const width = cfg.width;
    const dmg = cfg.damage * (c.isEmpowered(time) ? GameConfig.combo.empower.damageMult : 1);
    const dir = c.aimAngle;
    const ox = c.x, oy = c.y;
    const band = this.scene.add
      .rectangle(ox + Math.cos(dir) * length / 2, oy + Math.sin(dir) * length / 2, length, width, LINE_BAND_COLOR, 0.4)
      .setRotation(dir)
      .setDepth(LINE_BAND_DEPTH);
    band.setStrokeStyle(2, LINE_BAND_STROKE, 0.7);
    this.scene.tweens.add({ targets: band, alpha: 0, duration: LINE_BAND_FADE_MS, onComplete: () => band.destroy() });
    let hitAny = false;
    for (const child of this.host.enemies().getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      if (pointInOrientedRect(enemy.x, enemy.y, ox, oy, dir, 0, length, width)) {
        this.host.damageEnemyFrom(c, enemy, dmg, cfg.knockback, ox, oy, time);
        hitAny = true;
      }
    }
    if (hitAny) this.host.comboRewardHit(c);
    this.host.breakInRect(ox, oy, dir, 0, length, width, time);
    this.host.shakeOnce(SKILL_SHAKE_MS, SKILL_SHAKE_INTENSITY);
    this.enterPerformance(c, GameConfig.performanceTime.line, time);
  }

  /**
   * 進入強化：快速模式固定 durationMs；慢速模式設 empowered（能量消退到 0 才解除，重新累積變身爆發計數）。
   * 觸發時震動與擴張環，並掛上跟隨角色的脈動金色光環，強化結束或角色死亡時自行移除
   */
  private comboEmpower(c: Character, time: number): void {
    if (this.host.isSlowMode()) {
      if (c.empowered) return;
      c.empowered = true;
      c.empowerAoeHits = 0;
    } else {
      c.empowerUntil = time + GameConfig.combo.empower.durationMs;
    }
    this.host.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
    this.host.spawnExpandingRing(c.x, c.y, EMPOWER_RING_RADIUS, EMPOWER_RING_COLOR, EMPOWER_RING_MS);
    const aura = this.scene.add.circle(c.x, c.y, GameConfig.player.radius + AURA_EXTRA_RADIUS, AURA_COLOR, 0.22).setDepth(AURA_DEPTH);
    aura.setStrokeStyle(3, AURA_STROKE, 0.9);
    const pulse = this.scene.tweens.add({
      targets: aura, scale: { from: 1, to: 1.25 }, alpha: 0.12, duration: AURA_PULSE_MS, yoyo: true, repeat: -1
    });
    const follow = this.scene.time.addEvent({
      delay: AURA_FOLLOW_MS,
      loop: true,
      callback: () => {
        if (!c.isEmpowered(this.scene.time.now) || !c.alive) {
          pulse.remove();
          follow.remove();
          aura.destroy();
          return;
        }
        aura.setPosition(c.x, c.y);
      }
    });
    if (c === this.host.player()) this.scene.game.events.emit('empower-start', {});
    this.host.emitStats();
  }

  /**
   * 爆發：定身無敵連打 hits 段（每 intervalMs 一段），整招命中算一次 COMBO；
   * 表演時間延長定身無敵；保底計時確保一定會結束
   */
  private triggerBurst(c: Character, time: number): void {
    const cfg = GameConfig.burst;
    c.isBursting = true;
    if (cfg.invuln) c.invulnUntil = time + cfg.hits * cfg.intervalMs + BURST_INVULN_EXTRA_MS;
    this.enterPerformance(c, GameConfig.performanceTime.burst, time);
    c.stopMoving();
    if (c === this.host.player()) this.scene.game.events.emit('burst-start');
    this.host.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
    let hitCount = 0;
    let comboCounted = false;
    const burstTimer = this.scene.time.addEvent({
      delay: cfg.intervalMs,
      repeat: cfg.hits - 1,
      callback: () => {
        if (this.burstTick(c) && !comboCounted) {
          comboCounted = true;
          this.host.comboRewardHit(c);
        }
        hitCount++;
        if (hitCount >= cfg.hits) this.endBurst(c);
      }
    });
    this.scene.time.delayedCall(cfg.hits * cfg.intervalMs + BURST_FAILSAFE_EXTRA_MS, () => {
      if (c.isBursting) {
        burstTimer.remove(false);
        this.endBurst(c);
      }
    });
  }

  /**
   * 爆發的一段：範圍內敵人受傷、秒碎物件；命中時閃白、小震動（被打的怪各自命中凍結，不再暫停整個物理世界）
   *
   * @returns 這段是否命中至少一隻敵人
   */
  private burstTick(c: Character): boolean {
    if (this.host.isGameOver() || !c.alive) return false;
    const cfg = GameConfig.burst;
    const time = this.scene.time.now;
    const radius = cfg.radius;
    let hitAny = false;
    for (const child of this.host.enemies().getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y) <= radius) {
        this.host.damageEnemy(c, enemy, cfg.damagePerHit, cfg.knockback, time);
        hitAny = true;
      }
    }
    this.host.breakInCircle(c.x, c.y, radius, time);
    if (hitAny) {
      this.host.flashWhite(c);
      this.host.shakeOnce(BURST_TICK_SHAKE_MS, SKILL_SHAKE_INTENSITY);
    }
    const ox = Phaser.Math.Between(-radius / 2, radius / 2);
    const oy = Phaser.Math.Between(-radius / 2, radius / 2);
    this.host.spawnSlashEffect(c.x + ox, c.y + oy);
    return hitAny;
  }

  /** 爆發結束：P1 的 COMBO 由 onComboHit 管理不清除，BOT 歸零 */
  private endBurst(c: Character): void {
    if (!c.isBursting) return;
    c.isBursting = false;
    const isP1 = c === this.host.player();
    if (!isP1) c.spirit = 0;
    c.stopMoving();
    if (isP1) this.scene.game.events.emit('burst-end');
  }


  /**
   * 表演時間：定身並無敵 ms（不縮短既有更長的鎖定，例如爆發連打）；performanceTime.enabled = false 時不鎖
   */
  private enterPerformance(c: Character, ms: number, time: number): void {
    if (!GameConfig.performanceTime.enabled) return;
    c.skillLockUntil = Math.max(c.skillLockUntil, time + ms);
    c.stopMoving();
  }
}
