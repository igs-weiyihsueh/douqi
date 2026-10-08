import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import type { CharacterParams } from '../systems/characterParams';
import { hitFeel } from '../systems/hitFeelParams';
import { standCharacterOutside } from '../systems/bodySeparation';
import { isStructureEnemy } from '../systems/enemyKinds';
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
  /** 範圍內打可破壞物件（useArc = true 時只打 aimAngle 扇形內） */
  hitBreakablesInRange(c: Character, radius: number, half: number, useArc: boolean, damage: number, time: number): void;
  /** 衝刺撞到敵人時的攻擊（含特效與連段） */
  performAttackOn(actor: Character, primary: Enemy, time: number): void;
  /** 普攻命中：連段累積 */
  onComboHit(c: Character, time: number): void;
  /** 普攻命中：COMBO 獎勵累積 */
  triggerComboHit(c: Character): void;
  /** 慢速模式強化期間的唯一招式（目標中心圓形 AOE） */
  empowerAoe(c: Character, time: number): void;
  flashWhite(c: Character): void;
  spawnMeleeArcEffect(x: number, y: number, angle: number): void;
  /** 衝刺切入的刀光（穿過命中點、沿衝刺方向的斬痕） */
  spawnSlashStreak(x: number, y: number, angle: number, empowered: boolean): void;
}

/** 對 BOSS / 塔停外緣時，與目標外緣多留的距離 */
const STANDOFF_MARGIN = 6;
/** 衝刺到點的最小判定距離 */
const DASH_ARRIVE_MIN = 12;
/** 衝刺到點距離 = 速度 × 此秒數（約兩幀），避免高速衝刺越過終點後反向、在牆邊來回震盪 */
const DASH_ARRIVE_LOOKAHEAD_SEC = 0.032;
/** 衝刺撞可破壞物件的傷害（一撞即破，衝刺不卡住） */
const DASH_BREAK_DAMAGE = 99999;

/**
 * 角色行動（P1 與 BOT 共用）：
 * - 出手 tryAct：依鎖定目標決定 → 近距離小位移貼身 + 扇形劍氣、遠距離衝刺（撞到敵人停下攻擊）、
 *   道具衝過去撿、BOSS / 塔停在外緣原地揮擊、沒有目標朝面向空衝
 * - 快速模式 P1 走融合瞄準 actByAim（滑鼠方向錐形內的目標）；慢速模式 P1 強化期間改放圓形 AOE
 * - 衝刺推進 handleDash、移動範圍夾限、慢速模式鍵盤八方向移動
 * - BOT AI：選目標、沒目標朝敵群游走、依出手間隔行動
 */
export class CharacterActionController {
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
   * 出手（P1 按攻擊、BOT 到出手時間）：衝刺 / 爆發 / 定身 / 冷卻中不行動
   *
   * @param c 出手的角色
   * @param time 目前場景時間
   */
  tryAct(c: Character, time: number): void {
    if (c.isBursting || c.isDashing) return;
    if (c.isRooted(time)) return;
    if (time < c.nextAttackAllowedAt) return;
    const player = this.host.player();
    const slow = this.host.isSlowMode();
    // 慢速模式 P1 強化期間唯一的招式：目標中心圓形 AOE（不衝刺）
    if (c === player && slow && c.empowered) {
      this.host.empowerAoe(c, time);
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
    if (this.isImmovableLargeTarget(target as Enemy)) {
      this.standoffMeleeAttack(c, target as Enemy, time);
      return;
    }
    // 方向一律朝「角色 → 鎖定目標」
    c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target!.x, target!.y);
    const dist = Phaser.Math.Distance.Between(c.x, c.y, target!.x, target!.y);
    if (dist <= GameConfig.melee.range) this.stepInAndSwing(c, dist, time);
    else this.startDirectionDash(c, time);
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
    const dist = Phaser.Math.Distance.Between(c.x, c.y, target.x, target.y);
    if (this.isImmovableLargeTarget(target as Enemy)) {
      this.standoffMeleeAttack(c, target as Enemy, time);
      return;
    }
    if (dist <= GameConfig.melee.range) this.stepInAndSwing(c, dist, time);
    else this.startDirectionDash(c, time);
  }

  /** 近距離：朝 aimAngle 小位移貼身（不穿過目標、夾在移動區內），扇形劍氣，進入普攻冷卻 */
  private stepInAndSwing(c: Character, dist: number, time: number): void {
    const r = GameConfig.player.radius;
    const step = Math.min(GameConfig.lock.meleeStep, Math.max(0, dist - r));
    const a = this.host.arena();
    c.setPosition(
      Phaser.Math.Clamp(c.x + Math.cos(c.aimAngle) * step, a.left + r, a.right - r),
      Phaser.Math.Clamp(c.y + Math.sin(c.aimAngle) * step, a.top + r, a.bottom - r)
    );
    this.performMeleeArc(c, time);
    c.nextAttackAllowedAt = time + this.attackCooldownMs();
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

  /** 扇形劍氣：朝 aimAngle 劈出扇形，範圍內敵人受普攻傷害與擊退、順手打可破壞物件；命中至少一隻才累積連段 */
  private performMeleeArc(c: Character, time: number): void {
    const cfg = GameConfig.melee;
    const emp = c.isEmpowered(time);
    const radius = cfg.radius * (emp ? GameConfig.combo.empower.rangeMult : 1);
    const half = Phaser.Math.DegToRad(cfg.arcDeg) / 2;
    const atk = this.host.attackDamage() * (emp ? GameConfig.combo.empower.damageMult : 1);
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
    this.host.hitBreakablesInRange(c, radius, half, true, atk, time);
    if (hitCount > 0) {
      this.host.onComboHit(c, time);
      this.host.triggerComboHit(c);
    }
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
    if (p.isRooted(time)) { body.setVelocity(0, 0); return; }
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
   */
  private startDirectionDash(c: Character, time: number): void {
    const slow = this.host.isSlowMode();
    const baseDist = slow ? this.host.slowTuning().dashDistance : GameConfig.aim.dashDistance;
    const dist = baseDist * (c.isEmpowered(time) ? GameConfig.combo.empower.moveMult : 1);
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
    const r = GameConfig.player.radius;
    const bnd = c === this.host.player() ? this.host.walkBounds() : this.host.arena();
    c.dashDestX = Phaser.Math.Clamp(destX, bnd.left + r, bnd.right - r);
    c.dashDestY = Phaser.Math.Clamp(destY, bnd.top + r, bnd.bottom - r);
    c.isDashing = true;
    c.dashToItem = toItem;
    c.nextAttackAllowedAt = time + this.attackCooldownMs();
    if (GameConfig.player.dashShieldInvuln) c.dashShielded = true;
    c.showDashShield(true);
  }

  /** 結束衝刺：關閉衝刺狀態、停下、收回護盾與視覺 */
  endDashState(c: Character): void {
    c.isDashing = false;
    c.dashToItem = false;
    c.cutInUntil = 0;
    c.cutInTarget = null;
    c.stopMoving();
    c.dashShielded = false;
    c.showDashShield(false);
  }

  /**
   * 每幀推進衝刺：P1 撞碎路上的可破壞物件；一般衝刺撞到敵人停下攻擊（BOSS / 塔停在外緣）；
   * 否則朝固定終點前進（方向不隨滑鼠改變），到點停下
   *
   * @param c 角色
   * @param time 目前場景時間
   */
  handleDash(c: Character, time: number): void {
    if (!c.isDashing) return;
    if (c === this.host.player()) {
      this.host.hitBreakablesInRange(c, GameConfig.aim.dashHitRadius + GameConfig.breakable.radius, 0, false, DASH_BREAK_DAMAGE, time);
    }
    // 切入中：以減速繼續陷入敵人，時間到才停下（不再判定撞擊，避免同一次衝刺連打）
    if (c.cutInUntil > 0) {
      const target = c.cutInTarget;
      if (time < c.cutInUntil && target && target.active && !target.dead) {
        (c.body as Phaser.Physics.Arcade.Body).setVelocity(c.cutInVelocityX, c.cutInVelocityY);
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
        this.host.performAttackOn(c, hit, time);
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
    if (dist <= DASH_ARRIVE_MIN) {
      c.stopMoving();
      this.endDashState(c);
      return;
    }
    const dashAngle = Math.atan2(dy, dx);
    if (dist <= Math.max(DASH_ARRIVE_MIN, dashSpeed * DASH_ARRIVE_LOOKAHEAD_SEC)) {
      c.stopMoving();
      this.endDashState(c);
      return;
    }
    (c.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(dashAngle) * dashSpeed, Math.sin(dashAngle) * dashSpeed);
  }

  /** 目前衝刺速度：慢速模式讀即時調參，強化中加乘 */
  private currentDashSpeed(c: Character, time: number): number {
    const base = this.host.isSlowMode() ? this.host.slowTuning().dashSpeed : GameConfig.player.dashSpeed;
    return base * (c.isEmpowered(time) ? GameConfig.combo.empower.dashSpeedMult : 1);
  }

  /**
   * 衝刺撞到敵人：開始「切入」——以減速沿衝刺方向繼續陷入一小段再停（刀切進肉的阻力感），並畫刀光。
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
    if (p.streakEnabled === 1) this.host.spawnSlashStreak(hit.x, hit.y, angle, c.isEmpowered(time));
    // 關閉切入，或這一擊已把怪打死（沒有東西可陷入）→ 立即停下
    if (p.cutInEnabled !== 1 || p.cutInMs <= 0 || hit.dead || !hit.active) {
      this.endDashState(c);
      return;
    }
    const speed = dashSpeed * p.cutInSpeedRatio;
    c.cutInVelocityX = Math.cos(angle) * speed;
    c.cutInVelocityY = Math.sin(angle) * speed;
    c.cutInUntil = time + p.cutInMs;
    c.cutInTarget = hit;
    (c.body as Phaser.Physics.Arcade.Body).setVelocity(c.cutInVelocityX, c.cutInVelocityY);
  }

  /** 把角色夾在可活動範圍內；衝刺中撞牆被夾回就結束衝刺（避免牆邊來回震盪或卡在衝刺狀態） */
  clampToArena(c: Character): void {
    const r = GameConfig.player.radius;
    const bnd = this.host.walkBounds();
    const cx = Phaser.Math.Clamp(c.x, bnd.left + r, bnd.right - r);
    const cy = Phaser.Math.Clamp(c.y, bnd.top + r, bnd.bottom - r);
    if (cx !== c.x || cy !== c.y) {
      c.setPosition(cx, cy);
      if (c.isDashing) this.endDashState(c);
    }
  }
}
