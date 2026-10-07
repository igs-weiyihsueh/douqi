import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import type { SkillType } from '../objects/Item';
import { pointInOrientedRect } from '../systems/geometry';

/**
 * SkillController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface SkillHost {
  /** 擁有者場景（建立圖形、tween、計時器用） */
  readonly scene: Phaser.Scene;
  /** 敵人物件池（招式對其中可傷害的敵人結算） */
  readonly enemies: Phaser.Physics.Arcade.Group;
  /** 目前的移動區（落點、位移夾限） */
  arena(): Phaser.Geom.Rectangle;
  isGameOver(): boolean;
  /** 角色對敵人造成傷害，擊退方向以角色位置為準 */
  damageEnemy(actor: Character, enemy: Enemy, damage: number, knockback: number, time: number): void;
  /** 角色對敵人造成傷害，擊退方向以 (fromX, fromY) 為準 */
  damageEnemyFrom(actor: Character, enemy: Enemy, damage: number, knockback: number, fromX: number, fromY: number, time: number): void;
  /** 打破圓形範圍內的可打破物件 */
  breakBreakablesInCircle(x: number, y: number, radius: number, damage: number, time: number): void;
  /** 打破長方形範圍內的可打破物件（參數同 pointInOrientedRect） */
  breakBreakablesInRect(ox: number, oy: number, dir: number, nearOffset: number, length: number, width: number, damage: number, time: number): void;
  spawnExpandingRing(x: number, y: number, radius: number, color: number, ms?: number): void;
  shakeOnce(duration: number, intensity: number): void;
  /** 開始全場時停：owner 以外的角色與所有敵人凍結 durationMs，蓄力與預警進度一併暫停 */
  beginTimeStop(owner: Character, time: number, durationMs: number): void;
}

/** 招式特效深度（高於角色） */
const FX_DEPTH = 20;

/**
 * 一次性招式（撿到道具觸發，P1 與 BOT 共用）：
 * A 旋風場、B 環繞落雷、C 居合來回斬、E 跳砸震爆、F 十字噴火 + 燒灼、T 時停連斬。
 * 補血（H）不是招式，由場景直接處理。
 */
export class SkillController {
  constructor(private readonly host: SkillHost) {}

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /**
   * 施放招式
   *
   * @param c 施放的角色
   * @param skill 道具對應的招式
   * @param time 目前場景時間
   */
  cast(c: Character, skill: SkillType, time: number): void {
    switch (skill) {
      case 'A': this.whirlwind(c); break;
      case 'B': this.thunder(c, time); break;
      case 'C': this.iaido(c, time); break;
      case 'E': this.shockwave(c, time); break;
      case 'F': this.flame(c, time); break;
      case 'T': this.timestop(c, time); break;
    }
  }

  /**
   * 時停施展前檢查：spreadRadius 內是否有可傷敵人（沒有就不觸發、不消耗道具）
   *
   * @param c 撿到道具的角色
   */
  hasTimestopTarget(c: Character): boolean {
    return this.timestopPool(c).length > 0;
  }

  /** 角色周圍 spreadRadius 內的可傷敵人，依距離由近到遠 */
  private timestopPool(c: Character): Enemy[] {
    const spread = GameConfig.skills.timestop.spreadRadius;
    return this.vulnerableEnemies()
      .filter((e) => Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y) <= spread)
      .sort((a, b) => Phaser.Math.Distance.Between(c.x, c.y, a.x, a.y) - Phaser.Math.Distance.Between(c.x, c.y, b.x, b.y));
  }

  /** 場上目前可被玩家傷害的敵人 */
  private vulnerableEnemies(): Enemy[] {
    return this.host.enemies.getChildren().map((e) => e as Enemy).filter((e) => e.active && e.isVulnerable());
  }

  /**
   * 進入招式演出鎖定（期間無敵、玩家不可操控）
   *
   * @returns 演出結束時間
   */
  private lockSkill(c: Character, durationMs: number, time: number): number {
    c.isDashing = false;
    c.isBursting = false;
    c.stopMoving();
    c.skillLockUntil = time + durationMs;
    return c.skillLockUntil;
  }

  /** 招式結算後的標準震動 */
  private shakeBurst(): void {
    this.host.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
  }

  // ---------------------------------------------------------------------------
  // 招式
  // ---------------------------------------------------------------------------

  /** A 旋風斬：在施放位置放一個獨立的地面旋風場，持續 durationMs 每 tickMs 傷害範圍內敵人；角色不被鎖定 */
  private whirlwind(c: Character): void {
    const cfg = GameConfig.skills.whirlwind;
    const radius = cfg.radius;
    const ox = c.x, oy = c.y; // 旋風場固定在施放位置

    // 視覺：脈動的圓圈 + 4 條自轉的旋臂
    const ring = this.scene.add.circle(ox, oy, radius, 0x00e5ff, 0.08).setDepth(3);
    ring.setStrokeStyle(3, 0x00e5ff, 0.5);
    const arms = this.scene.add.graphics().setDepth(4);
    const spin = { rot: 0 };
    const spinTween = this.scene.tweens.add({
      targets: spin,
      rot: Math.PI * 2 * (cfg.durationMs / 600), // 每 600ms 轉一圈
      duration: cfg.durationMs,
      ease: 'Linear',
      onUpdate: () => {
        arms.clear();
        arms.lineStyle(4, 0x66f0ff, 0.55);
        for (let k = 0; k < 4; k++) {
          const a = spin.rot + (k / 4) * Math.PI * 2;
          arms.lineBetween(ox, oy, ox + Math.cos(a) * radius, oy + Math.sin(a) * radius);
        }
      }
    });
    const pulse = this.scene.tweens.add({ targets: ring, alpha: 0.16, duration: 300, yoyo: true, repeat: -1 });
    this.host.spawnExpandingRing(ox, oy, radius, 0x00e5ff);

    // 持續傷害（以施放點為擊退來源）
    const ticks = Math.max(1, Math.floor(cfg.durationMs / cfg.tickMs));
    const dot = this.scene.time.addEvent({
      delay: cfg.tickMs,
      repeat: ticks - 1,
      callback: () => {
        if (this.host.isGameOver()) return;
        const now = this.scene.time.now;
        for (const enemy of this.vulnerableEnemies()) {
          if (Phaser.Math.Distance.Between(ox, oy, enemy.x, enemy.y) <= radius) {
            this.host.damageEnemyFrom(c, enemy, cfg.damagePerHit, cfg.knockback, ox, oy, now);
          }
        }
        this.host.breakBreakablesInCircle(ox, oy, radius, cfg.damagePerHit, now);
      }
    });

    this.scene.time.delayedCall(cfg.durationMs, () => {
      spinTween.remove();
      pulse.remove();
      dot.remove();
      arms.destroy();
      ring.destroy();
    });
  }

  /** B 天降雷擊：蓄力後，以角色為圓心從正上方開始順時針依序落雷一圈；期間無敵不可控 */
  private thunder(c: Character, time: number): void {
    const cfg = GameConfig.skills.thunder;
    this.lockSkill(c, cfg.chargeMs + cfg.strikes * cfg.strikeDelayMs + 300, time);

    // 蓄力演出：角色放大再縮回 + 擴散的光圈
    this.scene.tweens.add({ targets: c, scale: { from: 1, to: 1.3 }, duration: cfg.chargeMs, yoyo: true });
    const chargeRing = this.scene.add.circle(c.x, c.y, 10, 0xffd700, 0.4).setDepth(FX_DEPTH);
    this.scene.tweens.add({ targets: chargeRing, radius: 46, alpha: 0, duration: cfg.chargeMs, onUpdate: () => chargeRing.setRadius(chargeRing.radius), onComplete: () => chargeRing.destroy() });

    const startAngle = -Math.PI / 2; // 從正上方開始
    this.scene.time.delayedCall(cfg.chargeMs, () => {
      if (this.host.isGameOver() || !c.alive) return;
      for (let i = 0; i < cfg.strikes; i++) {
        const a = startAngle + (i / cfg.strikes) * Math.PI * 2; // 角度遞增 = 順時針
        this.scene.time.delayedCall(i * cfg.strikeDelayMs, () => {
          if (this.host.isGameOver() || !c.alive) return;
          const arena = this.host.arena();
          const sx = Phaser.Math.Clamp(c.x + Math.cos(a) * cfg.orbitRadius, arena.left, arena.right);
          const sy = Phaser.Math.Clamp(c.y + Math.sin(a) * cfg.orbitRadius, arena.top, arena.bottom);
          this.spawnThunderStrike(sx, sy, cfg.radius);
          const now = this.scene.time.now;
          for (const enemy of this.vulnerableEnemies()) {
            if (Phaser.Math.Distance.Between(sx, sy, enemy.x, enemy.y) <= cfg.radius) {
              this.host.damageEnemyFrom(c, enemy, cfg.damage, cfg.knockback, sx, sy, now);
            }
          }
          this.host.breakBreakablesInCircle(sx, sy, cfg.radius, cfg.damage, now);
        });
      }
    });
    this.shakeBurst();
  }

  /**
   * 居合選向：朝「敵人最多」的方向切。以每個敵人方向為候選，計算 ±45° 扇形內的敵人數
   * （以數量為主，近距只給很小的加權），取最高分；沒有敵人時沿用 aimAngle
   */
  private pickIaidoAngle(c: Character): number {
    const enemies = this.vulnerableEnemies();
    if (enemies.length === 0) return c.aimAngle;
    const halfCone = Phaser.Math.DegToRad(45);
    let bestAngle = c.aimAngle;
    let bestScore = -1;
    for (const cand of enemies) {
      const candAngle = Phaser.Math.Angle.Between(c.x, c.y, cand.x, cand.y);
      let score = 0;
      for (const e of enemies) {
        const a = Phaser.Math.Angle.Between(c.x, c.y, e.x, e.y);
        if (Math.abs(Phaser.Math.Angle.Wrap(a - candAngle)) <= halfCone) {
          const d = Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y);
          score += 1 + 0.15 * (200 / (d + 200));
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestAngle = candAngle;
      }
    }
    return bestAngle;
  }

  /** C 居合貫穿：預備後朝敵人最多的方向高速斬出，再斬回起點，來回兩趟各自貫穿；期間無敵不可控 */
  private iaido(c: Character, time: number): void {
    const cfg = GameConfig.skills.iaido;
    const angle = this.pickIaidoAngle(c);
    const r = GameConfig.player.radius;
    const arena = this.host.arena();
    const startX = c.x, startY = c.y;
    const destX = Phaser.Math.Clamp(startX + Math.cos(angle) * cfg.distance, arena.left + r, arena.right - r);
    const destY = Phaser.Math.Clamp(startY + Math.sin(angle) * cfg.distance, arena.top + r, arena.bottom - r);
    const legMs = Math.max(60, (Phaser.Math.Distance.Between(startX, startY, destX, destY) / cfg.speed) * 1000);
    // 演出總時長：預備 + 去程 + 回程 + 收尾
    this.lockSkill(c, cfg.windupMs + legMs * 2 + 160, time);

    // 一趟突進：朝 (tx, ty) 高速斬過去，沿途貫穿（每趟各自記錄，同一隻每趟可各中一次）
    const dashLeg = (tx: number, ty: number, faceAngle: number, onDone: () => void): void => {
      if (this.host.isGameOver() || !c.alive) return;
      c.setRotation(faceAngle);
      this.spawnSlashBand(c.x, c.y, tx, ty, cfg.hitRadius * 2, 0xff4d6d); // 斬擊帶寬度與判定一致
      const hitSet = new Set<Enemy>();
      this.scene.tweens.add({
        targets: c,
        x: tx,
        y: ty,
        duration: legMs,
        ease: 'Linear',
        onUpdate: () => {
          const now = this.scene.time.now;
          for (const enemy of this.vulnerableEnemies()) {
            if (hitSet.has(enemy)) continue;
            if (Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y) <= cfg.hitRadius) {
              hitSet.add(enemy);
              this.host.damageEnemy(c, enemy, cfg.damage, cfg.knockback, now);
            }
          }
          this.host.breakBreakablesInCircle(c.x, c.y, cfg.hitRadius, cfg.damage, now);
        },
        onComplete: onDone
      });
    };
    const finish = (): void => {
      c.stopMoving();
      c.setRotation(0);
    };

    c.setRotation(angle);
    this.scene.time.delayedCall(cfg.windupMs, () => {
      dashLeg(destX, destY, angle, () => {
        if (this.host.isGameOver() || !c.alive) { finish(); return; }
        dashLeg(startX, startY, angle + Math.PI, finish); // 回程：面向反方向斬回起點
      });
    });
    this.shakeBurst();
  }

  /** E 全屏震爆：角色跳起（放大）→ 砸下（縮回）→ 落地衝擊波傷害範圍內敵人；期間無敵不可控 */
  private shockwave(c: Character, time: number): void {
    const cfg = GameConfig.skills.shockwave;
    this.lockSkill(c, cfg.jumpMs + cfg.slamMs + 200, time);
    this.scene.tweens.add({
      targets: c,
      scale: 1.6,
      duration: cfg.jumpMs,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: c,
          scale: 1,
          duration: cfg.slamMs,
          ease: 'Sine.easeIn',
          onComplete: () => {
            if (this.host.isGameOver() || !c.alive) return;
            this.host.spawnExpandingRing(c.x, c.y, cfg.radius, 0xa855f7, cfg.visualMs);
            this.shakeBurst();
            const now = this.scene.time.now;
            for (const enemy of this.vulnerableEnemies()) {
              if (Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y) <= cfg.radius) {
                this.host.damageEnemy(c, enemy, cfg.damage, cfg.knockback, now);
              }
            }
            this.host.breakBreakablesInCircle(c.x, c.y, cfg.radius, cfg.damage, now);
          }
        });
      }
    });
  }

  /**
   * F 十字噴火：以面向為基準往四個方向各噴一條長方形火道（當下傷害），
   * 並在火道上留下長方形燒灼區持續傷害；期間無敵不可控
   */
  private flame(c: Character, time: number): void {
    const cfg = GameConfig.skills.flame;
    this.lockSkill(c, cfg.windupMs + cfg.sprayMs + 200, time);
    const ox = c.x, oy = c.y;
    const baseDir = c.aimAngle;
    const dirs = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((d) => baseDir + d);
    c.setRotation(baseDir);

    this.scene.time.delayedCall(cfg.windupMs, () => {
      if (this.host.isGameOver() || !c.alive) return;
      const now = this.scene.time.now;
      for (const dir of dirs) {
        // 火道（旋轉矩形，近端在角色）
        const flame = this.scene.add
          .rectangle(ox + Math.cos(dir) * cfg.flameLength / 2, oy + Math.sin(dir) * cfg.flameLength / 2, cfg.flameLength, cfg.flameWidth, 0xff7a1a, 0.45)
          .setRotation(dir)
          .setDepth(FX_DEPTH);
        this.scene.tweens.add({ targets: flame, alpha: 0, duration: cfg.sprayMs, onComplete: () => flame.destroy() });
        for (const enemy of this.vulnerableEnemies()) {
          if (pointInOrientedRect(enemy.x, enemy.y, ox, oy, dir, 0, cfg.flameLength, cfg.flameWidth)) {
            this.host.damageEnemyFrom(c, enemy, cfg.burstDamage, cfg.knockback, ox, oy, now);
          }
        }
        this.host.breakBreakablesInRect(ox, oy, dir, 0, cfg.flameLength, cfg.flameWidth, cfg.burstDamage, now);
        this.spawnBurnZone(c, ox, oy, dir);
      }
    });
    this.shakeBurst();
  }

  /** 噴火留下的燒灼區：火道上 burnStart 起、長 burnLength 的矩形，burnDurationMs 內每 tickMs 傷害（不擊退） */
  private spawnBurnZone(c: Character, ox: number, oy: number, dir: number): void {
    const cfg = GameConfig.skills.flame;
    const bcx = ox + Math.cos(dir) * (cfg.burnStart + cfg.burnLength / 2);
    const bcy = oy + Math.sin(dir) * (cfg.burnStart + cfg.burnLength / 2);
    const burn = this.scene.add
      .rectangle(bcx, bcy, cfg.burnLength, cfg.burnWidth, 0xff5a1a, 0.22)
      .setRotation(dir)
      .setStrokeStyle(2, 0xff7a1a, 0.6)
      .setDepth(3);
    this.scene.tweens.add({ targets: burn, alpha: 0.32, duration: 300, yoyo: true, repeat: -1 });
    const ticks = Math.max(1, Math.floor(cfg.burnDurationMs / cfg.tickMs));
    this.scene.time.addEvent({
      delay: cfg.tickMs,
      repeat: ticks - 1,
      callback: () => {
        if (this.host.isGameOver()) return;
        const now = this.scene.time.now;
        for (const enemy of this.vulnerableEnemies()) {
          if (pointInOrientedRect(enemy.x, enemy.y, ox, oy, dir, cfg.burnStart, cfg.burnLength, cfg.burnWidth)) {
            this.host.damageEnemyFrom(c, enemy, cfg.tickDamage, 0, bcx, bcy, now);
          }
        }
      }
    });
    this.scene.time.delayedCall(cfg.burnDurationMs, () => {
      this.scene.tweens.killTweensOf(burn);
      burn.destroy();
    });
  }

  /**
   * T 時間暫停：全場凍結，角色依序閃現到周圍敵人旁邊連斬 dashes 次，結束時統一結算；期間無敵不可控。
   * 每次閃現把目標 hitRadius 內的敵人命中數 +1，結算傷害 = damage × 命中數（目標少時會重複連斬同一隻）
   */
  private timestop(c: Character, time: number): void {
    const cfg = GameConfig.skills.timestop;
    const pool = this.timestopPool(c);
    if (pool.length === 0) return; // 撿道具前已檢查過，保險起見
    this.lockSkill(c, cfg.durationMs + 150, time);
    // 穿梭期間閃現經過道具不撿
    c.timestopping = true;
    this.scene.time.delayedCall(cfg.durationMs + 150, () => { c.timestopping = false; });
    this.host.beginTimeStop(c, time, cfg.durationMs);

    // 全屏微暗覆蓋，強調時停氛圍
    const overlay = this.scene.add
      .rectangle(0, 0, GameConfig.width, GameConfig.height, 0x2233aa, 0.12)
      .setOrigin(0, 0)
      .setScrollFactor(0) // 固定畫面：鏡頭捲動時仍蓋滿全螢幕
      .setDepth(15);
    this.scene.time.delayedCall(cfg.durationMs, () => overlay.destroy());

    // 目標序列：敵人夠多時依距離均勻抽 dashes 隻（涵蓋範圍更廣）；不足時循環重複現有目標
    const targets: Enemy[] = [];
    for (let i = 0; i < cfg.dashes; i++) {
      targets.push(pool.length >= cfg.dashes
        ? pool[Math.round((i / (cfg.dashes - 1)) * (pool.length - 1))]
        : pool[i % pool.length]);
    }

    const hitCount = new Map<Enemy, number>();
    const stepMs = cfg.durationMs / Math.max(1, targets.length + 1);
    const r = GameConfig.player.radius;
    targets.forEach((target, i) => {
      this.scene.time.delayedCall(i * stepMs, () => {
        if (this.host.isGameOver() || !c.alive || !target.active) return;
        const fromX = c.x, fromY = c.y;
        // 落點在目標周圍的環上、兩側交替並小幅旋轉，不疊在目標中心
        const swing = (i % 2 === 0 ? 1 : -1) * (Math.PI * 0.55) + i * 0.7;
        const arena = this.host.arena();
        const lx = Phaser.Math.Clamp(target.x + Math.cos(swing) * cfg.orbitOffset, arena.left + r, arena.right - r);
        const ly = Phaser.Math.Clamp(target.y + Math.sin(swing) * cfg.orbitOffset, arena.top + r, arena.bottom - r);
        c.setPosition(lx, ly);
        c.aimAngle = Phaser.Math.Angle.Between(lx, ly, target.x, target.y); // 面朝目標
        this.spawnTrailLine(fromX, fromY, lx, ly, 0xffffff);
        // 命中判定以目標為圓心
        for (const enemy of this.vulnerableEnemies()) {
          if (Phaser.Math.Distance.Between(target.x, target.y, enemy.x, enemy.y) <= cfg.hitRadius) {
            hitCount.set(enemy, (hitCount.get(enemy) ?? 0) + 1);
          }
        }
        this.host.breakBreakablesInCircle(target.x, target.y, cfg.hitRadius, cfg.damage, this.scene.time.now);
      });
    });

    // 時停結束：分幀結算（每幀 timestopSettlePerFrame 隻），避免大量傷害跳字與死亡粒子擠在同一幀卡頓；
    // 凍結解除由場景 update() 依時停結束時間處理
    this.scene.time.delayedCall(cfg.durationMs, () => {
      const list = Array.from(hitCount.keys());
      const perFrame = GameConfig.juice.timestopSettlePerFrame;
      let idx = 0;
      const settleBatch = (): void => {
        if (this.host.isGameOver()) return;
        const now = this.scene.time.now;
        const end = Math.min(idx + perFrame, list.length);
        for (; idx < end; idx++) {
          const enemy = list[idx];
          if (!enemy.active || !enemy.isVulnerable()) continue;
          this.host.damageEnemy(c, enemy, cfg.damage * (hitCount.get(enemy) ?? 1), cfg.knockback, now);
        }
      };
      settleBatch();
      if (idx < list.length) {
        const ev = this.scene.time.addEvent({
          delay: 16, // 約每幀
          loop: true,
          callback: () => {
            settleBatch();
            if (idx >= list.length || this.host.isGameOver()) ev.remove();
          }
        });
      }
      this.shakeBurst();
    });
  }

  // ---------------------------------------------------------------------------
  // 招式專用特效
  // ---------------------------------------------------------------------------

  /** 落雷：黃色光圈 + 白色核心，淡出後銷毀 */
  private spawnThunderStrike(x: number, y: number, radius: number): void {
    const bolt = this.scene.add.circle(x, y, radius, 0xffd700, 0.5).setDepth(FX_DEPTH);
    const core = this.scene.add.circle(x, y, radius * 0.4, 0xffffff, 0.9).setDepth(FX_DEPTH + 1);
    this.scene.tweens.add({
      targets: [bolt, core],
      alpha: 0,
      duration: 240,
      onComplete: () => { bolt.destroy(); core.destroy(); }
    });
  }

  /** 時停閃現的拖影直線 */
  private spawnTrailLine(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const g = this.scene.add.graphics().setDepth(FX_DEPTH);
    g.lineStyle(10, color, 0.7);
    g.lineBetween(x1, y1, x2, y2);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  /** 居合的寬斬擊帶（半透明帶狀矩形，寬度與判定一致） */
  private spawnSlashBand(x1: number, y1: number, x2: number, y2: number, width: number, color: number): void {
    const band = this.scene.add
      .rectangle((x1 + x2) / 2, (y1 + y2) / 2, Phaser.Math.Distance.Between(x1, y1, x2, y2), width, color, 0.35)
      .setRotation(Phaser.Math.Angle.Between(x1, y1, x2, y2))
      .setDepth(FX_DEPTH);
    band.setStrokeStyle(2, color, 0.6);
    this.scene.tweens.add({ targets: band, alpha: 0, duration: 300, onComplete: () => band.destroy() });
  }
}
