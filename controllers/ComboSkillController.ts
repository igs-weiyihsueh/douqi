import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character, ReadyCombo } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import type { TargetingController } from './TargetingController';
import {
  ATTACK_HIT_EVENT, createHitWindowState, lastHitMs, moveHitPoints, runHitWindow, type HitPoint, type HitWindowState
} from '../systems/attackTuningParams';
import { drawHitShape, hitShapeContains, placeHitShape, type PlacedHitShape } from '../systems/hitShapes';

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
  /** 判定範圍內的可破壞物件各扣 1 耐久（以物件中心判定；exclude 內的不打、打中的加進去），回傳命中數 */
  hitBreakablesInShape(actor: Character, shape: PlacedHitShape, time: number, exclude?: Set<object>): number;
  /** COMBO 連擊 +1（一招命中至少一隻敵人或一個可破壞物件算一下） */
  comboRewardHit(c: Character): void;
  /** P1 普攻命中次數 +1（結算統計） */
  countP1AttackHit(): void;
  spawnExpandingRing(x: number, y: number, radius: number, color: number, ms?: number): void;
  /** 是否畫出招式的判定範圍特效（木樁模式調範圍時才畫；正式模式動作有自己的特效） */
  showsRangeFx(): boolean;
  shakeOnce(duration: number, intensity: number): void;
  flashWhite(c: Character): void;
  spawnSlashEffect(x: number, y: number): void;
  emitStats(): void;
  /** 角色剛進入強化（二段變身）：場景依關卡怪物配置做即時補怪 */
  onEmpower(c: Character): void;
}

/** 一次連段技施放（多個打擊點）的狀態：連段技、放出時的方向、COMBO 連擊是否已算過（每次施放只算一次） */
interface ComboCast {
  kind: ReadyCombo;
  dir: number;
  rewardCounted: boolean;
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
/** 範圍特效（連段技、非圓形的爆發 / 強化衝刺）的填色與邊框透明度 */
const SHAPE_FX_FILL_ALPHA = 0.4;
const SHAPE_FX_STROKE_ALPHA = 0.7;
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
      // 累積到門檻：連段技準備好，等下一次按攻擊放出（manualRelease 關閉時沿用舊行為立即放出）
      if (combo === cfg.slowThresholds.circle) this.readyOrRelease(c, 'circle', time);
      if (combo === cfg.slowThresholds.line) this.readyOrRelease(c, 'line', time);
      if (combo >= cap) c.spirit = 0;
      if (isP1) this.host.emitStats();
      return;
    }
    // 快速：一條 COMBO，依序圓形斬 / 直線氣波 / 爆發，滿了強化並歸零
    c.spirit = Math.min(cfg.max, c.spirit + 1);
    const combo = c.spirit;
    if (combo === cfg.thresholds.circle) this.performCombo(c, 'circle', time);
    if (combo === cfg.thresholds.line) this.performCombo(c, 'line', time);
    if (combo === cfg.thresholds.burst) this.triggerBurst(c, time);
    if (combo >= cfg.thresholds.empower) {
      this.comboEmpower(c, time);
      c.spirit = 0;
    }
    if (isP1) this.host.emitStats();
  }

  /**
   * 慢速模式連段累積到門檻：combo.manualRelease 時記成準備好的連段技（下一次按攻擊放出），否則立即放出
   *
   * @param c 角色
   * @param kind 連段技
   * @param time 目前場景時間
   */
  private readyOrRelease(c: Character, kind: ReadyCombo, time: number): void {
    if (GameConfig.combo.manualRelease) c.readyCombo = kind;
    else this.performCombo(c, kind, time);
  }

  /**
   * 按攻擊時放出準備好的連段技（沒有就不做事）
   *
   * @param c 角色
   * @param time 目前場景時間
   * @returns 是否有放出（有的話這一下不再普攻）
   */
  releaseReadyCombo(c: Character, time: number): boolean {
    const kind = c.readyCombo;
    if (!kind) return false;
    c.readyCombo = null;
    this.performCombo(c, kind, time);
    return true;
  }

  /**
   * 施放連段技：立即開始播動作並進入表演時間（無敵、不能操作，涵蓋到最後一段判定結束 + performanceTime），
   * 每個打擊點（moveHitPoints）在自己的判定段內每幀判定（runHitWindow，同一個目標每段只打一次）；判定範圍的方向在放出時決定
   *
   * @param c 角色
   * @param kind 連段技
   * @param time 目前場景時間
   */
  private performCombo(c: Character, kind: ReadyCombo, time: number): void {
    const perf = GameConfig.performanceTime;
    c.markAction(kind === 'circle' ? 'comboCircle' : 'comboLine');
    this.enterPerformance(c, lastHitMs(kind) + (kind === 'circle' ? perf.circle : perf.line), time);
    const dir = c.aimAngle;
    const cast: ComboCast = { kind, dir, rewardCounted: false };
    moveHitPoints(kind).forEach((point, index) => {
      const hitWindow = createHitWindowState();
      runHitWindow(c, point.timeMs, point.durationMs, time, (hitTime, first) => {
        if (!c.alive) return false;
        this.resolveComboHit(c, cast, index, point, hitWindow, first, hitTime);
        return true;
      });
    });
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
   * @param exclude 不再打的目標（穿透衝刺已打過的）；AOE 打中的會加進來，之後穿透時不再打
   */
  empowerStrike(c: Character, tx: number, ty: number, time: number, exclude?: Set<object>): void {
    c.markAction('attack');
    this.empowerAoeBurst(c, tx, ty, time, exclude);
  }

  private empowerAoeBurst(c: Character, tx: number, ty: number, time: number, exclude?: Set<object>): void {
    const cfg = GameConfig.combo.empower.aoe;
    const shape = placeHitShape(moveHitPoints('dash')[0].shape, tx, ty, c.aimAngle);
    const dmg = cfg.damage * GameConfig.combo.empower.damageMult;
    if (shape.kind === 'circle') {
      this.showRing(shape, cfg.color, cfg.ringMs);
      this.showRing({ ...shape, radius: shape.radius * 0.6 }, AOE_INNER_RING_COLOR, cfg.ringMs * 0.8);
    } else {
      this.showShape(shape, cfg.color, AOE_INNER_RING_COLOR, cfg.ringMs);
    }
    this.host.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity * 0.5);
    c.scene.events.emit(ATTACK_HIT_EVENT, c, 'dash', 0);
    const hits = this.hitInShape(c, shape, dmg, cfg.knockback, time, exclude);
    if (hits.enemies > 0) c.applyHitPause(moveHitPoints('dash')[0].pauseMs, time);
    if (hits.enemies + hits.breakables > 0) {
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

  /**
   * 連段技一個打擊點判定段的一次判定：以它的判定範圍（朝放出時的方向）判定，範圍內這一段還沒打過的敵人受「招式傷害 × 傷害 %」
   * 並從判定中心往外擊退，順手打範圍內的物件；這一段第一次打中敵人時出招者頓點 pauseMs。
   * 這一段的第一次判定才播特效（招式1 的圓形範圍播擴張環、其他形狀畫範圍特效，只在顯示範圍特效的模式）、震動與判定事件。
   * 同一次施放的多個打擊點只在第一次打中時算 COMBO 連擊
   *
   * @param c 施放的角色
   * @param cast 這次施放的狀態
   * @param index 打擊點索引
   * @param point 打擊點
   * @param hitWindow 這個打擊點判定段的狀態
   * @param first 是否為這一段的第一次判定
   * @param time 目前場景時間
   */
  private resolveComboHit(
    c: Character, cast: ComboCast, index: number, point: HitPoint, hitWindow: HitWindowState, first: boolean, time: number
  ): void {
    const cfg = cast.kind === 'circle' ? GameConfig.combo.circle : GameConfig.combo.line;
    const shape = placeHitShape(point.shape, c.x, c.y, cast.dir);
    const dmg = cfg.damage * (c.isEmpowered(time) ? GameConfig.combo.empower.damageMult : 1) * point.damagePct / 100;
    if (first) {
      if (cast.kind === 'circle' && shape.kind === 'circle') this.showRing(shape, CIRCLE_RING_COLOR, CIRCLE_RING_MS);
      else if (cast.kind === 'circle') this.showShape(shape, CIRCLE_RING_COLOR, CIRCLE_RING_COLOR, CIRCLE_RING_MS);
      else this.showShape(shape, LINE_BAND_COLOR, LINE_BAND_STROKE, LINE_BAND_FADE_MS);
      this.host.shakeOnce(SKILL_SHAKE_MS, SKILL_SHAKE_INTENSITY);
      c.scene.events.emit(ATTACK_HIT_EVENT, c, cast.kind, index);
    }
    const hits = this.hitInShape(c, shape, dmg, cfg.knockback, time, hitWindow.targets);
    if (hits.enemies > 0 && !hitWindow.paused) {
      hitWindow.paused = true;
      c.applyHitPause(point.pauseMs, time);
    }
    if (hits.enemies + hits.breakables > 0 && !cast.rewardCounted) {
      cast.rewardCounted = true;
      this.host.comboRewardHit(c);
    }
  }


  /**
   * 判定範圍命中：範圍內的敵人受傷並從判定中心往外擊退，順手打範圍內的物件
   *
   * @param c 攻擊的角色
   * @param shape 放好的判定範圍
   * @param damage 每隻敵人的傷害
   * @param knockback 擊退力道
   * @param time 目前場景時間
   * @param exclude 不再打的目標（打擊點判定段已打過的敵人與物件）；打中的會加進來
   * @returns 打中的敵人數與物件數（打中敵人才頓點；敵人或物件都算 COMBO）
   */
  private hitInShape(
    c: Character, shape: PlacedHitShape, damage: number, knockback: number, time: number, exclude?: Set<object>
  ): { enemies: number; breakables: number } {
    let enemies = 0;
    for (const child of this.host.enemies().getChildren()) {
      const enemy = child as Enemy;
      if (exclude?.has(enemy) || !enemy.isVulnerable() || !hitShapeContains(shape, enemy.x, enemy.y)) continue;
      exclude?.add(enemy);
      this.host.damageEnemyFrom(c, enemy, damage, knockback, shape.x, shape.y, time);
      enemies++;
    }
    return { enemies, breakables: this.host.hitBreakablesInShape(c, shape, time, exclude) };
  }

  /**
   * 圓形判定範圍的擴張環特效（只在顯示範圍特效的模式，見 ComboSkillHost.showsRangeFx）
   *
   * @param shape 放好的圓形判定範圍
   * @param color 顏色
   * @param ms 擴張時間
   */
  private showRing(shape: PlacedHitShape, color: number, ms: number): void {
    if (this.host.showsRangeFx()) this.host.spawnExpandingRing(shape.x, shape.y, shape.radius, color, ms);
  }

  /**
   * 把判定範圍畫成淡出的圖形（連段技等的範圍特效；只在顯示範圍特效的模式，見 ComboSkillHost.showsRangeFx）
   *
   * @param shape 放好的判定範圍
   * @param fill 填色
   * @param stroke 邊框色
   * @param fadeMs 淡出時間
   */
  private showShape(shape: PlacedHitShape, fill: number, stroke: number, fadeMs: number): void {
    if (!this.host.showsRangeFx()) return;
    const g = this.scene.add.graphics().setDepth(LINE_BAND_DEPTH);
    g.fillStyle(fill, SHAPE_FX_FILL_ALPHA).lineStyle(2, stroke, SHAPE_FX_STROKE_ALPHA);
    drawHitShape(g, shape);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: fadeMs, onComplete: () => g.destroy() });
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
    c.markAction('unique');
    this.host.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
    this.host.spawnExpandingRing(c.x, c.y, EMPOWER_RING_RADIUS, EMPOWER_RING_COLOR, EMPOWER_RING_MS);
    this.host.onEmpower(c);
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
   * 爆發：定身無敵連打 hits 段（每 intervalMs 一段），整招命中算一次 COMBO；第一次打中敵人時出招者頓點一次
   * （連打暫停、無敵與定身一起順延）；表演時間延長定身無敵；保底計時確保一定會結束
   */
  private triggerBurst(c: Character, time: number): void {
    c.markAction('unique');
    const cfg = GameConfig.burst;
    c.isBursting = true;
    if (cfg.invuln) c.invulnUntil = time + cfg.hits * cfg.intervalMs + BURST_INVULN_EXTRA_MS;
    this.enterPerformance(c, GameConfig.performanceTime.burst, time);
    c.stopMoving();
    if (c === this.host.player()) this.scene.game.events.emit('burst-start');
    this.host.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
    const pauseMs = moveHitPoints('burst')[0].pauseMs;
    let hitCount = 0;
    let comboCounted = false;
    let paused = false;
    const burstTimer = this.scene.time.addEvent({
      delay: cfg.intervalMs,
      repeat: cfg.hits - 1,
      callback: () => {
        const hits = this.burstTick(c);
        if (hits.enemies + hits.breakables > 0 && !comboCounted) {
          comboCounted = true;
          this.host.comboRewardHit(c);
        }
        if (hits.enemies > 0 && !paused && pauseMs > 0) {
          paused = true;
          this.pauseBurst(c, burstTimer, pauseMs);
        }
        hitCount++;
        if (hitCount >= cfg.hits) this.endBurst(c);
      }
    });
    this.scene.time.delayedCall(cfg.hits * cfg.intervalMs + pauseMs + BURST_FAILSAFE_EXTRA_MS, () => {
      if (c.isBursting) {
        burstTimer.remove(false);
        this.endBurst(c);
      }
    });
  }

  /**
   * 爆發的頓點：出招者停住 ms，連打計時暫停同樣的時間，無敵跟著順延（定身由 applyHitPause 順延）
   *
   * @param c 施放的角色
   * @param burstTimer 爆發連打的計時
   * @param ms 頓點長度（毫秒）
   */
  private pauseBurst(c: Character, burstTimer: Phaser.Time.TimerEvent, ms: number): void {
    const time = this.scene.time.now;
    c.applyHitPause(ms, time);
    if (c.invulnUntil > time) c.invulnUntil += ms;
    burstTimer.paused = true;
    this.scene.time.delayedCall(ms, () => { burstTimer.paused = false; });
  }

  /**
   * 爆發的一段：範圍內敵人受傷、可破壞物件扣耐久；命中時閃白、小震動（被打的怪各自命中凍結，不再暫停整個物理世界）
   *
   * @returns 這段打中的敵人數與物件數
   */
  private burstTick(c: Character): { enemies: number; breakables: number } {
    if (this.host.isGameOver() || !c.alive) return { enemies: 0, breakables: 0 };
    const cfg = GameConfig.burst;
    const time = this.scene.time.now;
    const shape = placeHitShape(moveHitPoints('burst')[0].shape, c.x, c.y, c.aimAngle);
    let enemies = 0;
    for (const child of this.host.enemies().getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable() || !hitShapeContains(shape, enemy.x, enemy.y)) continue;
      this.host.damageEnemy(c, enemy, cfg.damagePerHit, cfg.knockback, time);
      enemies++;
    }
    const breakables = this.host.hitBreakablesInShape(c, shape, time);
    if (enemies + breakables > 0) {
      this.host.flashWhite(c);
      this.host.shakeOnce(BURST_TICK_SHAKE_MS, SKILL_SHAKE_INTENSITY);
    }
    // 斬擊特效散在判定中心附近
    const spread = (shape.kind === 'rect' ? shape.width : shape.radius) / 2;
    this.host.spawnSlashEffect(shape.x + Phaser.Math.Between(-spread, spread), shape.y + Phaser.Math.Between(-spread, spread));
    c.scene.events.emit(ATTACK_HIT_EVENT, c, 'burst', 0);
    return { enemies, breakables };
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
