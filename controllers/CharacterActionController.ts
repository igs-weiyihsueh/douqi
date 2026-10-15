import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Breakable } from '../objects/Breakable';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import type { CharacterParams } from '../systems/characterParams';
import { hitFeel } from '../systems/hitFeelParams';
import { standCharacterOutside } from '../systems/bodySeparation';
import { isStructureEnemy } from '../systems/enemyKinds';
import type { EdgeMargins } from '../systems/spriteFeet';
import type { LockTarget, TargetingController } from './TargetingController';

/** 慢速模式八方向移動鍵（方向鍵 + WASD） */
export interface SlowMoveKeys {
  up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key;
  w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key;
}

/** 衝刺 / 慢速移動可調參數（遊戲中可調） */
export interface SlowTuning {
  dashDistance: number;
  dashSpeed: number;
}

/**
 * CharacterActionController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface CharacterActionHost {
  /** 敵人物件池（扇形劍氣判定） */
  enemies(): Phaser.Physics.Arcade.Group;
  /** P1 */
  player(): Character;
  /** 目前的移動區 */
  arena(): Phaser.Geom.Rectangle;
  /** 角色可活動範圍（左右出口開放時放寬到開放側） */
  walkBounds(): Phaser.Geom.Rectangle;
  /** 角色位置離可活動範圍各邊要留的距離（新美術皮膚依圖片大小，否則為 player.radius） */
  edgeMargins(c: Character): EdgeMargins;
  /** 鎖定與瞄準 */
  targeting(): TargetingController;
  /** 是否為慢速模式 */
  isSlowMode(): boolean;
  /** 慢速模式的衝刺距離 / 速度 */
  slowTuning(): SlowTuning;
  /** 角色編輯器參數（慢速模式的移動速度與普攻冷卻） */
  charParams(): CharacterParams;
  /** 慢速模式移動鍵 */
  slowKeys(): SlowMoveKeys;
  /** 時停期間此角色是否被凍結（施放者以外都凍結） */
  isFrozenByTimestop(c: Character): boolean;
  /** 目前普攻傷害 */
  attackDamage(): number;
  /** 角色對敵人造成傷害（走場景的擊殺結算） */
  damageEnemy(actor: Character, enemy: Enemy, damage: number, knockback: number, time: number): void;
  /**
   * 範圍內打可破壞物件（useArc = true 時只打 aimAngle 扇形內；alreadyHit 內的跳過、命中的加進去），回傳命中數
   */
  hitBreakablesInRange(c: Character, radius: number, half: number, useArc: boolean, time: number, alreadyHit?: Set<Breakable>): number;
  /** 衝刺撞到敵人時的攻擊（含特效與連段） */
  performAttackOn(actor: Character, primary: Enemy, time: number): void;
  /** 普攻命中：連段累積 */
  onComboHit(c: Character, time: number): void;
  /** 按攻擊時放出準備好的連段技，回傳是否有放出 */
  releaseReadyCombo(c: Character, time: number): boolean;
  /** 普攻命中：COMBO 獎勵累積 */
  triggerComboHit(c: Character): void;
  /** 角色出手（開始一招；CREDIT 以此計算「一招」） */
  onAttackStart(c: Character, time: number): void;
  /** 慢速模式強化期間的唯一招式（目標中心圓形 AOE） */
  /** 慢速強化攻擊的目標（範圍圈內，優先鎖定的；沒有為 null） */
  pickEmpowerTarget(c: Character): Enemy | null;
  /** 強化衝刺撞到敵人：以 (x, y) 為中心炸圓形 AOE */
  empowerStrike(c: Character, x: number, y: number, time: number): void;
  flashWhite(c: Character): void;
  spawnMeleeArcEffect(x: number, y: number, angle: number): void;
  /** 衝刺切入的刀光（穿過被砍的怪、沿衝刺方向的斬痕；大小依怪的顯示尺寸） */
  spawnSlashStreak(target: Enemy, angle: number, empowered: boolean): void;
}

/** 對 BOSS / 塔停外緣時，與目標外緣多留的距離 */
const STANDOFF_MARGIN = 6;
/** 衝刺到點的最小判定距離 */
const DASH_ARRIVE_MIN = 12;
/** 衝刺到點距離 = 速度 × 此秒數（約兩幀），避免高速衝刺越過終點後反向、在牆邊來回震盪 */
const DASH_ARRIVE_LOOKAHEAD_SEC = 0.032;

/**
 * 角色行動（P1 與 BOT 共用）：
 * - 出手 tryAct：依鎖定目標決定 → 近距離小位移貼身 + 扇形劍氣、遠距離衝刺（撞到敵人停下攻擊）、
 *   道具衝過去撿、BOSS / 塔停在外緣原地揮擊、沒有目標朝面向空衝
 * - 快速模式 P1 走融合瞄準 actByAim（滑鼠方向錐形內的目標）；慢速模式 P1 強化期間改放圓形 AOE
 * - 衝刺推進 handleDash、移動範圍夾限、慢速模式鍵盤八方向移動
 * - BOT AI：選目標、沒目標朝敵群游走、依出手間隔行動
 */
export class CharacterActionController {
  /** 各角色這一次衝刺已撞過的可破壞物件（衝刺每幀判定，一次衝刺每個物件只算一下；開始衝刺時清空） */
  private readonly dashHitBreakables = new Map<Character, Set<Breakable>>();
  /** 二段強化衝刺衝向的木箱（衝到木箱外緣時以木箱為中心炸強化 AOE；結束衝刺時清除） */
  private readonly empowerCrateTargets = new Map<Character, Breakable>();
  /**
   * 普攻衝向的鎖定敵人：衝刺途中沒撞到（例如敵人被擠到場地邊緣、角色腳底被夾住碰不到）時，
   * 到點後敵人仍在劍氣範圍內就補一刀（finishAttackDash）；結束衝刺時清除
   */
  private readonly attackDashTargets = new Map<Character, Enemy>();

  constructor(private readonly host: CharacterActionHost) {}

  private get targeting(): TargetingController {
    return this.host.targeting();
  }

  /**
   * BOT 每幀決策：選目標（最近敵人或想搶的道具）並面向它；沒目標時朝敵群中心游走；到出手時間才出手
   *
   * @param bot BOT 角色
   * @param time 目前場景時間
   */
  updateBot(bot: Character, time: number): void {
    if (!bot.alive) return;
    if (bot.isDashing || bot.isBursting) return;
    if (bot.isHurtStunned(time)) { bot.stopMoving(); return; }
    const target = this.targeting.pickBotTarget(bot);
    bot.lockedTarget = target as unknown as (Phaser.GameObjects.GameObject & { x: number; y: number }) | null;
    if (target) {
      bot.aimAngle = Phaser.Math.Angle.Between(bot.x, bot.y, target.x, target.y);
    } else {
      const center = this.targeting.enemyClusterCenter();
      if (center) {
        const a = Phaser.Math.Angle.Between(bot.x, bot.y, center.x, center.y);
        bot.aimAngle = a;
        (bot.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(a) * GameConfig.bot.wanderSpeed, Math.sin(a) * GameConfig.bot.wanderSpeed);
      } else {
        bot.stopMoving();
      }
    }
    if (time < bot.nextBotActAt) return;
    const jitter = Phaser.Math.Between(-GameConfig.bot.attackJitterMs, GameConfig.bot.attackJitterMs);
    bot.nextBotActAt = time + GameConfig.bot.attackIntervalMs + jitter;
    if (target) this.tryAct(bot, time);
  }

  /**
   * 出手（P1 按攻擊、BOT 到出手時間）：衝刺 / 爆發 / 定身 / 受擊硬直 / 冷卻中不行動；慢速模式有準備好的連段技時改放連段技
   *
   * @param c 出手的角色
   * @param time 目前場景時間
   */
  tryAct(c: Character, time: number): void {
    if (c.isBursting || c.isDashing) return;
    if (c.isRooted(time) || c.isHurtStunned(time)) return;
    if (time < c.nextAttackAllowedAt) return;
    this.host.onAttackStart(c, time);
    const player = this.host.player();
    const slow = this.host.isSlowMode();
    // 慢速模式有準備好的連段技：這一下改放連段技（朝鎖定目標），不普攻
    if (slow && c.readyCombo) {
      this.aimAtLockedEnemy(c);
      if (this.host.releaseReadyCombo(c, time)) {
        c.nextAttackAllowedAt = time + this.attackCooldownMs();
        return;
      }
    }
    // 慢速模式 P1 強化期間：衝向鎖定目標，撞到時以它為中心炸圓形 AOE（近身衝上去砍一圈）
    if (c === player && slow && c.empowered) {
      this.empoweredDash(c, time);
      return;
    }
    // 快速模式 P1 的融合瞄準：方向直接用滑鼠 aimAngle，不被自動鎖定綁死
    if (c === player && !slow && !GameConfig.aim.autoLock) {
      this.actByAim(c, time);
      return;
    }
    // P1 用鎖定目標（慢速模式由範圍圈每幀算好）；BOT 用 updateBot 選好的目標（含道具）
    const targeting = this.targeting;
    const target: LockTarget | null = c === player ? targeting.lockedTarget : (c.lockedTarget as unknown as LockTarget | null);
    if (!targeting.isLockValid(target)) {
      this.startDirectionDash(c, time); // 沒目標：朝面向空衝
      return;
    }
    if (targeting.isItem(target)) {
      c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y);
      this.beginDash(c, target.x, target.y, time, true);
      return;
    }
    if (targeting.isBreakable(target)) {
      this.attackBreakable(c, target, time);
      return;
    }
    if (this.isImmovableLargeTarget(target as Enemy)) {
      this.standoffMeleeAttack(c, target as Enemy, time);
      return;
    }
    // 方向一律朝「角色 → 鎖定目標」
    c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target!.x, target!.y);
    const dist = Phaser.Math.Distance.Between(c.x, c.y, target!.x, target!.y);
    // 近戰門檻看到目標身體邊緣的距離：怪被真空圈推到圈邊時中心距離常超過門檻，用中心距離會一直變成衝刺
    if (dist - (target as Enemy).getBodyRadius() <= GameConfig.melee.enemyRange) this.stepInAndSwing(c, dist, time, GameConfig.melee.swingDistance);
    else this.dashAtEnemy(c, target as Enemy, dist, time);
  }

  /**
   * 面向鎖定的敵人（P1 用範圍圈鎖定的目標、BOT 用自己選的目標；沒鎖定或鎖的不是敵人時維持原面向）
   *
   * @param c 角色
   */
  private aimAtLockedEnemy(c: Character): void {
    const targeting = this.targeting;
    const target: LockTarget | null = c === this.host.player() ? targeting.lockedTarget : (c.lockedTarget as unknown as LockTarget | null);
    if (!targeting.isLockValid(target) || targeting.isItem(target) || targeting.isBreakable(target)) return;
    c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target!.x, target!.y);
  }

  /**
   * 快速模式 P1 的融合瞄準：滑鼠方向錐形內有目標就鎖它出手（滑鼠靜止且沒指到時改鎖最近的可傷怪）；
   * 錐形內沒有目標 → 清鎖定、朝滑鼠方向自由衝刺走位
   */
  private actByAim(c: Character, time: number): void {
    const targeting = this.targeting;
    let target = targeting.pickAimConeTarget(c);
    if (!target && !targeting.isAimActive(time) && c === this.host.player()) {
      target = targeting.findNearestDamageableEnemy(c);
    }
    if (!target) {
      targeting.lockedTarget = null;
      c.lockedTarget = null;
      this.startDirectionDash(c, time);
      return;
    }
    targeting.lockedTarget = target;
    c.lockedTarget = target as unknown as (Phaser.GameObjects.GameObject & { x: number; y: number }) | null;
    c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y);
    if (targeting.isItem(target)) {
      this.beginDash(c, target.x, target.y, time, true); // 碰到由 overlap 拾取
      return;
    }
    if (targeting.isBreakable(target)) {
      this.attackBreakable(c, target, time);
      return;
    }
    const dist = Phaser.Math.Distance.Between(c.x, c.y, target.x, target.y);
    if (this.isImmovableLargeTarget(target as Enemy)) {
      this.standoffMeleeAttack(c, target as Enemy, time);
      return;
    }
    if (dist <= GameConfig.melee.range) this.stepInAndSwing(c, dist, time);
    else this.dashAtEnemy(c, target as Enemy, dist, time);
  }

  /**
   * 普攻衝向鎖定的敵人：朝敵人方向衝刺，最遠只衝到敵人的距離（不越過敵人沿著牆滑走），並記下目標供到點補刀
   *
   * @param c 出手的角色
   * @param target 鎖定的敵人
   * @param dist 到敵人的距離
   * @param time 目前場景時間
   */
  private dashAtEnemy(c: Character, target: Enemy, dist: number, time: number): void {
    this.startDirectionDash(c, time, dist);
    if (c.isDashing) this.attackDashTargets.set(c, target);
  }

  /**
   * 普攻衝刺結束時沒撞到目標：目標仍可傷且在劍氣半徑內就面向它揮一刀（場地邊緣的敵人也打得到）
   *
   * @param c 結束衝刺的角色
   * @param time 目前場景時間
   */
  private finishAttackDash(c: Character, time: number): void {
    const target = this.attackDashTargets.get(c);
    this.attackDashTargets.delete(c);
    if (!target || !target.active || !target.isVulnerable()) return;
    if (Phaser.Math.Distance.Between(c.x, c.y, target.x, target.y) > GameConfig.melee.radius) return;
    c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y);
    this.performMeleeArc(c, time);
  }

  /**
   * 慢速強化攻擊：鎖著木箱時改打木箱（empoweredCrateAttack）；否則範圍圈內有敵人就朝它衝刺，沒有就朝面向衝出（揮空）；
   * 衝刺途中撞到敵人時炸圓形 AOE（見 handleDash）。冷卻用強化 AOE 的 cooldownMs
   *
   * @param c 施放的角色（慢速模式 P1）
   * @param time 目前場景時間
   */
  private empoweredDash(c: Character, time: number): void {
    const locked = this.targeting.lockedTarget;
    if (this.targeting.isBreakable(locked) && this.targeting.isLockValid(locked)) {
      this.empoweredCrateAttack(c, locked, time);
      return;
    }
    const target = this.host.pickEmpowerTarget(c);
    if (target) {
      c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y);
      this.beginDash(c, target.x, target.y, time, false);
    } else {
      this.startDirectionDash(c, time);
    }
    if (!c.isDashing) return; // 面向牆壁衝不出去時，startDirectionDash 已改為原地揮擊
    c.dashEmpowerStrike = true;
    c.nextAttackAllowedAt = time + GameConfig.combo.empower.aoe.cooldownMs;
  }

  /**
   * 二段強化鎖著木箱：在攻擊距離內直接以木箱為中心炸強化 AOE，否則衝向木箱外緣、到點才炸（AOE 也打範圍內的木箱與怪）
   *
   * @param c 出手的角色
   * @param bk 鎖定的木箱
   * @param time 目前場景時間
   */
  private empoweredCrateAttack(c: Character, bk: Breakable, time: number): void {
    const body = bk.getBody();
    c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, body.centerX, body.centerY);
    if (bk.distanceTo(c.x, c.y) <= GameConfig.melee.range) {
      this.host.empowerStrike(c, body.centerX, body.centerY, time);
    } else {
      const dest = this.crateDashPoint(c, bk);
      this.beginDash(c, dest.x, dest.y, time, false);
      c.dashEmpowerStrike = true;
      this.empowerCrateTargets.set(c, bk);
    }
    c.nextAttackAllowedAt = time + GameConfig.combo.empower.aoe.cooldownMs;
  }

  /**
   * 衝向木箱的終點：木箱碰撞矩形上離角色最近的點，再往內一個角色半徑——衝刺在終點前（到點判定距離）就會停，
   * 終點設在外緣上會停得太早、碰不到木箱；停下後的些微重疊由推箱分離推開
   *
   * @param c 衝刺的角色
   * @param bk 目標木箱
   */
  private crateDashPoint(c: Character, bk: Breakable): { x: number; y: number } {
    const body = bk.getBody();
    const nearX = Phaser.Math.Clamp(c.x, body.left, body.right);
    const nearY = Phaser.Math.Clamp(c.y, body.top, body.bottom);
    const ang = Phaser.Math.Angle.Between(c.x, c.y, nearX, nearY);
    const inset = GameConfig.player.radius;
    return { x: nearX + Math.cos(ang) * inset, y: nearY + Math.sin(ang) * inset };
  }

  /**
   * 近距離：朝 aimAngle 往前踏（最多 lock.meleeStep，停在離目標 stopAt 處、不穿過目標、夾在移動區內），扇形劍氣，進入普攻冷卻
   *
   * @param dist 到目標的距離（敵人 = 中心距離；木箱 = 到碰撞矩形的距離）
   * @param stopAt 踏到離目標這個距離為止（預設角色半徑 = 貼身）
   */
  private stepInAndSwing(c: Character, dist: number, time: number, stopAt: number = GameConfig.player.radius): void {
    const r = GameConfig.player.radius;
    const step = Math.min(GameConfig.lock.meleeStep, Math.max(0, dist - stopAt));
    const a = this.host.arena();
    c.setPosition(
      Phaser.Math.Clamp(c.x + Math.cos(c.aimAngle) * step, a.left + r, a.right - r),
      Phaser.Math.Clamp(c.y + Math.sin(c.aimAngle) * step, a.top + r, a.bottom - r)
    );
    this.performMeleeArc(c, time);
    c.nextAttackAllowedAt = time + this.attackCooldownMs();
  }

  /**
   * 鎖定木箱時的攻擊：面向木箱中心；離木箱碰撞矩形在 melee.range 內就小位移貼近（不進入木箱）後揮擊，
   * 否則朝木箱外緣衝刺（終點見 crateDashPoint）
   *
   * @param c 攻擊的角色
   * @param bk 鎖定的木箱
   * @param time 目前場景時間
   */
  private attackBreakable(c: Character, bk: Breakable, time: number): void {
    const body = bk.getBody();
    c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, body.centerX, body.centerY);
    const edgeDist = bk.distanceTo(c.x, c.y);
    if (edgeDist <= GameConfig.melee.range) {
      this.stepInAndSwing(c, edgeDist, time);
      return;
    }
    const dest = this.crateDashPoint(c, bk);
    this.beginDash(c, dest.x, dest.y, time, false);
  }

  /** 不可推動的大型目標（BOSS / 塔）：攻擊時停在外緣原地揮擊，不衝進中心重疊 */
  private isImmovableLargeTarget(e: Enemy | null): boolean {
    return !!e && e.active && isStructureEnemy(e);
  }

  /**
   * 對 BOSS / 塔停外緣揮擊：攻擊範圍內只在太貼近（比外緣近）時退到外緣，原地扇形劍氣；
   * 範圍外則衝刺，終點設在外緣而不是中心。反覆攻擊都停在同一外緣、不逐次往裡擠
   */
  private standoffMeleeAttack(c: Character, target: Enemy, time: number): void {
    const standoff = target.getBodyRadius() + GameConfig.player.radius + STANDOFF_MARGIN;
    c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y);
    const dist = Phaser.Math.Distance.Between(c.x, c.y, target.x, target.y);
    if (dist <= GameConfig.melee.range) {
      if (dist < standoff) {
        const ang = dist > 0.001 ? Math.atan2(c.y - target.y, c.x - target.x) : c.aimAngle + Math.PI;
        const r = GameConfig.player.radius;
        const a = this.host.arena();
        c.setPosition(
          Phaser.Math.Clamp(target.x + Math.cos(ang) * standoff, a.left + r, a.right - r),
          Phaser.Math.Clamp(target.y + Math.sin(ang) * standoff, a.top + r, a.bottom - r)
        );
      }
      this.performMeleeArc(c, time);
      c.nextAttackAllowedAt = time + this.attackCooldownMs();
      return;
    }
    this.beginDash(c, target.x - Math.cos(c.aimAngle) * standoff, target.y - Math.sin(c.aimAngle) * standoff, time, false);
  }

  /** 扇形劍氣：朝 aimAngle 劈出扇形，範圍內敵人受普攻傷害與擊退、順手打可破壞物件；命中至少一隻敵人才累積連段，敵人或物件命中算一下 HIT */
  private performMeleeArc(c: Character, time: number): void {
    const cfg = GameConfig.melee;
    const emp = c.isEmpowered(time);
    const radius = cfg.radius * (emp ? GameConfig.combo.empower.rangeMult : 1);
    const half = Phaser.Math.DegToRad(cfg.arcDeg) / 2;
    const atk = this.host.attackDamage() * (emp ? GameConfig.combo.empower.damageMult : 1);
    // 先記普攻：這一刀觸發連段技時，連段技在後面記下，P1 Spine 播連段技動作而不是普攻
    c.markAction('attack');
    let hitCount = 0;
    for (const child of this.host.enemies().getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y) > radius) continue;
      const toEnemy = Phaser.Math.Angle.Between(c.x, c.y, enemy.x, enemy.y);
      if (Math.abs(Phaser.Math.Angle.Wrap(toEnemy - c.aimAngle)) <= half) {
        this.host.damageEnemy(c, enemy, atk, GameConfig.player.knockback, time);
        hitCount++;
      }
    }
    const breakableHits = this.host.hitBreakablesInRange(c, radius, half, true, time);
    if (hitCount > 0) this.host.onComboHit(c, time);
    if (hitCount > 0 || breakableHits > 0) this.host.triggerComboHit(c);
    this.host.flashWhite(c);
    this.host.spawnMeleeArcEffect(c.x, c.y, c.aimAngle);
  }

  /**
   * 慢速模式：P1 鍵盤八方向持續移動（對角線正規化）並把面向設為移動方向；無輸入時停下、維持最後面向。
   * 時停被凍結、定身時停下；衝刺、招式演出、爆發中不接管（速度由各自邏輯控制）
   *
   * @param time 目前場景時間
   */
  handleSlowMovement(time: number): void {
    const p = this.host.player();
    if (!p.alive) return;
    const body = p.body as Phaser.Physics.Arcade.Body;
    if (this.host.isFrozenByTimestop(p)) { body.setVelocity(0, 0); return; }
    if (p.isDashing || p.isSkillLocked(time) || p.isBursting) return;
    if (p.isRooted(time) || p.isHurtStunned(time)) { body.setVelocity(0, 0); return; }
    const k = this.host.slowKeys();
    let dx = 0, dy = 0;
    if (k.left.isDown || k.a.isDown) dx -= 1;
    if (k.right.isDown || k.d.isDown) dx += 1;
    if (k.up.isDown || k.w.isDown) dy -= 1;
    if (k.down.isDown || k.s.isDown) dy += 1;
    if (dx === 0 && dy === 0) {
      body.setVelocity(0, 0);
      return;
    }
    const len = Math.hypot(dx, dy);
    const nx = dx / len, ny = dy / len;
    const spd = this.host.charParams().moveSpeed;
    body.setVelocity(nx * spd, ny * spd);
    p.aimAngle = Math.atan2(ny, nx);
  }

  /** 普攻冷卻（毫秒）：慢速模式讀角色編輯器參數，快速模式讀 config */
  private attackCooldownMs(): number {
    return this.host.isSlowMode() ? this.host.charParams().attackCooldownMs : GameConfig.player.attackCooldownMs;
  }

  /**
   * 朝 aimAngle 衝刺一段（強化期間更遠）。慢速模式 P1 面向牆壁、夾在場內後幾乎衝不出去時，改原地揮擊，
   * 按攻擊一定有動作
   *
   * @param maxDist 衝刺距離上限（衝向敵人時 = 到敵人的距離）
   */
  private startDirectionDash(c: Character, time: number, maxDist = Infinity): void {
    const slow = this.host.isSlowMode();
    const baseDist = slow ? this.host.slowTuning().dashDistance : GameConfig.aim.dashDistance;
    const dist = Math.min(maxDist, baseDist * (c.isEmpowered(time) ? GameConfig.combo.empower.moveMult : 1));
    const destX = c.x + Math.cos(c.aimAngle) * dist;
    const destY = c.y + Math.sin(c.aimAngle) * dist;
    if (c === this.host.player() && slow) {
      const r = GameConfig.player.radius;
      const a = this.host.arena();
      const cx = Phaser.Math.Clamp(destX, a.left + r, a.right - r);
      const cy = Phaser.Math.Clamp(destY, a.top + r, a.bottom - r);
      if (Phaser.Math.Distance.Between(c.x, c.y, cx, cy) < r) {
        this.performMeleeArc(c, time);
        c.nextAttackAllowedAt = time + this.attackCooldownMs();
        return;
      }
    }
    this.beginDash(c, destX, destY, time, false);
  }

  /**
   * 開始衝刺：終點夾在可活動範圍內（P1 在左右出口開放時可衝到開放側）、進入普攻冷卻、衝刺護盾
   *
   * @param toItem true = 撿道具衝刺（途中撞到敵人不停下）
   */
  private beginDash(c: Character, destX: number, destY: number, time: number, toItem: boolean): void {
    const m = this.host.edgeMargins(c);
    const bnd = c === this.host.player() ? this.host.walkBounds() : this.host.arena();
    c.dashDestX = Phaser.Math.Clamp(destX, bnd.left + m.left, bnd.right - m.right);
    c.dashDestY = Phaser.Math.Clamp(destY, bnd.top + m.top, bnd.bottom - m.bottom);
    c.isDashing = true;
    c.dashToItem = toItem;
    this.dashHitBreakables.get(c)?.clear();
    c.nextAttackAllowedAt = time + this.attackCooldownMs();
    if (GameConfig.player.dashShieldInvuln) c.dashShielded = true;
    c.showDashShield(true);
  }

  /** 結束衝刺：關閉衝刺狀態、停下、收回護盾與視覺 */
  endDashState(c: Character): void {
    this.empowerCrateTargets.delete(c);
    this.attackDashTargets.delete(c);
    c.isDashing = false;
    c.dashToItem = false;
    c.dashEmpowerStrike = false;
    c.cutInUntil = 0;
    c.cutInTarget = null;
    c.stopMoving();
    c.dashShielded = false;
    c.showDashShield(false);
  }

  /**
   * 每幀推進衝刺：P1 撞到路上的可破壞物件（每個物件一次衝刺只算一下，撞到就算一下 HIT）；一般衝刺撞到敵人停下攻擊（BOSS / 塔停在外緣）；
   * 否則朝固定終點前進（方向不隨滑鼠改變），到點停下
   *
   * @param c 角色
   * @param time 目前場景時間
   */
  handleDash(c: Character, time: number): void {
    if (!c.isDashing) return;
    if (c === this.host.player()) {
      let hitSet = this.dashHitBreakables.get(c);
      if (!hitSet) {
        hitSet = new Set();
        this.dashHitBreakables.set(c, hitSet);
      }
      if (this.host.hitBreakablesInRange(c, GameConfig.aim.dashHitRadius, 0, false, time, hitSet) > 0) this.host.triggerComboHit(c);
    }
    // 切入中：以減速繼續陷入敵人，時間到才停下（不再判定撞擊，避免同一次衝刺連打）
    if (c.cutInUntil > 0) {
      const target = c.cutInTarget;
      if (time < c.cutInUntil && target && target.active && !target.dead) {
        // 撞擊停頓中完全停住，之後才以切入速度陷入
        const paused = time < c.cutInPauseUntil;
        (c.body as Phaser.Physics.Arcade.Body).setVelocity(paused ? 0 : c.cutInVelocityX, paused ? 0 : c.cutInVelocityY);
        return;
      }
      c.stopMoving();
      this.endDashState(c);
      return;
    }
    const dashSpeed = this.currentDashSpeed(c, time);
    if (!c.dashToItem) {
      const hitRadius = GameConfig.aim.dashHitRadius;
      const hit = this.targeting.findFirstEnemyInRangeOf(c, hitRadius);
      if (hit) {
        c.stopMoving();
        c.dashImpactAt = time;
        if (c.dashEmpowerStrike) this.host.empowerStrike(c, hit.x, hit.y, time);
        else this.host.performAttackOn(c, hit, time);
        if (isStructureEnemy(hit)) {
          standCharacterOutside(c, hit, this.host.arena());
          this.endDashState(c);
        } else {
          this.beginCutIn(c, hit, dashSpeed, time);
        }
        return;
      }
    }
    const dx = c.dashDestX - c.x;
    const dy = c.dashDestY - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= Math.max(DASH_ARRIVE_MIN, dashSpeed * DASH_ARRIVE_LOOKAHEAD_SEC)) {
      this.arriveDash(c, time);
      return;
    }
    const dashAngle = Math.atan2(dy, dx);
    (c.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(dashAngle) * dashSpeed, Math.sin(dashAngle) * dashSpeed);
  }

  /**
   * 衝刺到點：停下並結束衝刺；二段強化衝向木箱的到點時以木箱為中心炸強化 AOE（木箱途中已碎就不炸）
   *
   * @param c 衝刺中的角色
   * @param time 目前場景時間
   */
  private arriveDash(c: Character, time: number): void {
    const crate = this.empowerCrateTargets.get(c);
    c.stopMoving();
    if (crate && this.targeting.isLockValid(crate)) {
      const body = crate.getBody();
      this.host.empowerStrike(c, body.centerX, body.centerY, time);
    }
    this.finishAttackDash(c, time);
    this.endDashState(c);
  }

  /** 目前衝刺速度：慢速模式讀即時調參，強化中加乘 */
  private currentDashSpeed(c: Character, time: number): number {
    const base = this.host.isSlowMode() ? this.host.slowTuning().dashSpeed : GameConfig.player.dashSpeed;
    return base * (c.isEmpowered(time) ? GameConfig.combo.empower.dashSpeedMult : 1);
  }

  /**
   * 衝刺撞到敵人：開始「切入」——先撞擊停頓（完全停住），再以減速沿衝刺方向陷入一小段才停（刀切進肉的阻力感），並畫刀光。
   * 只影響攻擊者自己，且發生在普攻冷卻內，不延遲任何輸入；關閉時、或這一擊（或切入途中）怪已死亡時立即停下
   *
   * @param c 衝刺中的角色
   * @param hit 撞到的敵人
   * @param dashSpeed 撞擊當下的衝刺速度
   * @param time 目前場景時間
   */
  private beginCutIn(c: Character, hit: Enemy, dashSpeed: number, time: number): void {
    const p = hitFeel();
    const angle = Math.atan2(c.dashDestY - c.y, c.dashDestX - c.x);
    if (p.streakEnabled === 1) this.host.spawnSlashStreak(hit, angle, c.isEmpowered(time));
    // 關閉切入，或這一擊已把怪打死（沒有東西可陷入）→ 立即停下
    if (p.cutInEnabled !== 1 || p.cutInMs <= 0 || hit.dead || !hit.active) {
      this.endDashState(c);
      return;
    }
    const speed = dashSpeed * p.cutInSpeedRatio;
    c.cutInVelocityX = Math.cos(angle) * speed;
    c.cutInVelocityY = Math.sin(angle) * speed;
    // 先撞擊停頓 impactPauseMs（完全停住），再陷入 cutInMs
    c.cutInPauseUntil = time + p.impactPauseMs;
    c.cutInUntil = c.cutInPauseUntil + p.cutInMs;
    c.cutInTarget = hit;
    const paused = p.impactPauseMs > 0;
    (c.body as Phaser.Physics.Arcade.Body).setVelocity(paused ? 0 : c.cutInVelocityX, paused ? 0 : c.cutInVelocityY);
  }

  /**
   * 把角色夾在可活動範圍內（離各邊留 edgeMargins）；衝刺中撞牆被夾回就結束衝刺（避免牆邊來回震盪或卡在衝刺狀態），
   * 普攻衝刺沒撞到目標時照到點規則補刀
   *
   * @param c 角色
   * @param time 目前場景時間
   */
  clampToArena(c: Character, time: number): void {
    const m = this.host.edgeMargins(c);
    const bnd = this.host.walkBounds();
    const cx = Phaser.Math.Clamp(c.x, bnd.left + m.left, bnd.right - m.right);
    const cy = Phaser.Math.Clamp(c.y, bnd.top + m.top, bnd.bottom - m.bottom);
    if (cx !== c.x || cy !== c.y) {
      c.setPosition(cx, cy);
      if (!c.isDashing) return;
      this.finishAttackDash(c, time);
      this.endDashState(c);
    }
  }
}
