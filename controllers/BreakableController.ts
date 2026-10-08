import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Breakable } from '../objects/Breakable';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import { isFixedEnemy } from '../systems/enemyKinds';
import { pointInOrientedRect } from '../systems/geometry';
import type { Side } from './SlotWorldController';

/**
 * BreakableController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface BreakableHost {
  /** 擁有者場景（特效、計時器用） */
  readonly scene: Phaser.Scene;
  /** 可破壞物件池 */
  group(): Phaser.GameObjects.Group;
  /** 敵人物件池（爆炸桶炸到的怪） */
  enemies(): Phaser.Physics.Arcade.Group;
  /** 全部角色（爆炸桶炸到的角色） */
  characters(): ReadonlyArray<Character>;
  /** P1（布置時避開；爆炸桶傷害記在 P1 名下） */
  player(): Character;
  /** 目前的移動區 */
  arena(): Phaser.Geom.Rectangle;
  /** 是否為關卡制（關卡制改為進入區域時靜態布置，不隨波次重生） */
  isLevelMode(): boolean;
  /** 角色對敵人造成傷害（走場景的擊殺結算） */
  damageEnemyFrom(actor: Character, enemy: Enemy, damage: number, knockback: number, fromX: number, fromY: number, time: number): void;
  /** 對角色造成傷害 */
  damageCharacterFrom(c: Character, amount: number, fromX: number, fromY: number): void;
  flashHurt(c: Character): void;
  dropItemAt(x: number, y: number, time: number): void;
  spawnExpandingRing(x: number, y: number, radius: number, color: number, ms?: number): void;
  shakeOnce(duration: number, intensity: number): void;
}

/** 布置位置的嘗試次數：每波散布（堆中心 / 堆內物件）、區域靜態布置 */
const CLUSTER_TRIES = 20;
const IN_CLUSTER_TRIES = 16;
const STATIC_TRIES = 30;
/** 堆內物件彼此、物件與角色、新爆炸桶與木箱之間多留的縫 */
const IN_CLUSTER_GAP = 4;
const PLAYER_GAP = 8;
const BARREL_CRATE_GAP = 6;
/** 區域靜態布置時離 P1 的最小距離 */
const STATIC_AVOID_PLAYER = 90;
/** 爆炸桶警示圈：深度、閃爍週期、顏色 */
const FUSE_RING_DEPTH = 4;
const FUSE_BLINK_MS = 90;
const FUSE_RING_COLOR = 0xff3322;
const FUSE_FILL_COLOR = 0xff5522;
const FUSE_TINT = 0xff4422;
/** 警示圈每幀更新間隔 */
const FUSE_TICK_MS = 16;
/** 爆炸特效：火光圈顏色與時間、核心、火花數量 */
const EXPLODE_RING_COLOR = 0xff6a1a;
const EXPLODE_RING_MS = 360;
const EXPLODE_CORE_COLOR = 0xffd400;
const EXPLODE_SPARKS = 14;
/** 連鎖引爆的延遲（視覺上一顆接一顆） */
const CHAIN_DELAY_MS = 90;
/** 碎裂粒子數量 */
const BREAK_PARTICLES = 8;

/**
 * 可破壞物件（木箱、爆炸桶）：
 * - 布置：非關卡制每波成堆散布（遠離中心、避開玩家、彼此不疊）；關卡制每進一個區域隨機靜態布置（右側基調多桶）
 * - 打破：普攻扇形 / 衝刺圓形依攻擊力扣血；招式 AOE（圓形 / 定向矩形）直接秒碎且一次最多掉 maxDropPerBreak 個道具
 * - 木箱碎裂噴粒子、機率掉道具；爆炸桶打破後先倒數（地面警示圈）再爆炸：怪受傷並被炸飛、角色受傷、連鎖引爆附近的桶
 * - 推動與碰撞分離在 systems/bodySeparation
 */
export class BreakableController {
  constructor(private readonly host: BreakableHost) {}

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /** 每波開始成堆散布木箱與少量爆炸桶（只用於非關卡制） */
  spawnForWave(): void {
    if (this.host.isLevelMode()) return;
    const cfg = GameConfig.breakable;
    const pool = this.host.group();
    const a = this.host.arena();
    const p = this.host.player();
    const inset = cfg.edgeInset;
    const ccx = a.centerX, ccy = a.centerY;
    const clusterCenters: Array<{ x: number; y: number }> = [];
    for (let cl = 0; cl < cfg.clustersPerWave; cl++) {
      if (pool.countActive(true) >= cfg.maxAlive) break;
      // 堆中心：遠離場地中心、避開玩家與其他堆
      let hx = 0, hy = 0, ok = false;
      for (let attempt = 0; attempt < CLUSTER_TRIES; attempt++) {
        const x = Phaser.Math.Between(a.left + inset, a.right - inset);
        const y = Phaser.Math.Between(a.top + inset, a.bottom - inset);
        if (Phaser.Math.Distance.Between(x, y, ccx, ccy) < cfg.minDistFromCenter) continue;
        if (Phaser.Math.Distance.Between(x, y, p.x, p.y) < cfg.safeDistanceFromPlayer) continue;
        if (clusterCenters.some((c) => Phaser.Math.Distance.Between(x, y, c.x, c.y) < cfg.minClusterSpacing)) continue;
        hx = x; hy = y; ok = true; break;
      }
      if (!ok) continue;
      clusterCenters.push({ x: hx, y: hy });
      // 堆內木箱彼此間距至少一個直徑，不互疊
      const placed: Array<{ x: number; y: number }> = [];
      const minGap = cfg.radius * 2 + IN_CLUSTER_GAP;
      for (let n = 0; n < cfg.perCluster; n++) {
        if (pool.countActive(true) >= cfg.maxAlive) break;
        let bx = 0, by = 0, placedOk = false;
        for (let attempt = 0; attempt < IN_CLUSTER_TRIES; attempt++) {
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.random() * cfg.clusterSpread;
          const x = Phaser.Math.Clamp(hx + Math.cos(ang) * rad, a.left + inset, a.right - inset);
          const y = Phaser.Math.Clamp(hy + Math.sin(ang) * rad, a.top + inset, a.bottom - inset);
          if (Phaser.Math.Distance.Between(x, y, p.x, p.y) < GameConfig.player.radius + cfg.radius + PLAYER_GAP) continue;
          if (placed.some((q) => Phaser.Math.Distance.Between(x, y, q.x, q.y) < minGap)) continue;
          bx = x; by = y; placedOk = true; break;
        }
        if (!placedOk) continue;
        placed.push({ x: bx, y: by });
        const bk = pool.get(bx, by) as Breakable | null;
        if (!bk) break;
        bk.spawnBreakable(bx, by);
      }
    }
    // 少量爆炸桶：同樣遠離中心、避開玩家，且不與現有物件互疊（桶與桶之間距離更遠，避免輕易連鎖）
    const bcfg = cfg.barrel;
    for (let n = 0; n < bcfg.perWave; n++) {
      if (pool.countActive(true) >= cfg.maxAlive) break;
      let bx = 0, by = 0, ok = false;
      for (let attempt = 0; attempt < CLUSTER_TRIES; attempt++) {
        const x = Phaser.Math.Between(a.left + inset, a.right - inset);
        const y = Phaser.Math.Between(a.top + inset, a.bottom - inset);
        if (Phaser.Math.Distance.Between(x, y, ccx, ccy) < cfg.minDistFromCenter) continue;
        if (Phaser.Math.Distance.Between(x, y, p.x, p.y) < cfg.safeDistanceFromPlayer) continue;
        let clash = false;
        for (const ch of pool.getChildren()) {
          const o = ch as Breakable;
          if (!o.active) continue;
          const need = o.explosive ? bcfg.minBarrelSpacing : (cfg.radius * 2 + BARREL_CRATE_GAP);
          if (Phaser.Math.Distance.Between(x, y, o.x, o.y) < need) { clash = true; break; }
        }
        if (clash) continue;
        bx = x; by = y; ok = true; break;
      }
      if (!ok) continue;
      const bk = pool.get(bx, by) as Breakable | null;
      if (!bk) break;
      bk.spawnBreakable(bx, by, 'barrel');
    }
  }

  /**
   * 關卡制：在目前移動區隨機靜態布置木箱與爆炸桶（不重生）；避開中心、邊緣與玩家，彼此不重疊
   *
   * @param side 物件布置的基調（右側爆炸桶上限多 barrelBiasExtra）
   */
  placeStatic(side: Side): void {
    const cfg = GameConfig.stage.breakablesRandom;
    const a = this.host.arena();
    const p = this.host.player();
    const pool = this.host.group();
    const minWH = Math.min(a.width, a.height);
    const placed: Array<{ x: number; y: number }> = [];
    const spacing = cfg.minSpacingR * minWH;
    const centerAvoid = cfg.centerAvoidR * minWH;
    const pick = (): { x: number; y: number } | null => {
      for (let attempt = 0; attempt < STATIC_TRIES; attempt++) {
        const x = a.left + Phaser.Math.FloatBetween(cfg.marginX, 1 - cfg.marginX) * a.width;
        const y = a.top + Phaser.Math.FloatBetween(cfg.marginY, 1 - cfg.marginY) * a.height;
        if (Phaser.Math.Distance.Between(x, y, a.centerX, a.centerY) < centerAvoid) continue;
        if (Phaser.Math.Distance.Between(x, y, p.x, p.y) < STATIC_AVOID_PLAYER) continue;
        if (placed.some((q) => Phaser.Math.Distance.Between(x, y, q.x, q.y) < spacing)) continue;
        return { x, y };
      }
      return null;
    };
    const crateN = Phaser.Math.Between(cfg.crateMin, cfg.crateMax);
    const barrelMax = cfg.barrelMax + (side === 'R' ? cfg.barrelBiasExtra : 0);
    const barrelN = Phaser.Math.Between(cfg.barrelMin, barrelMax);
    const place = (count: number, kind: 'crate' | 'barrel'): void => {
      for (let i = 0; i < count; i++) {
        const pt = pick(); if (!pt) break;
        placed.push(pt);
        const bk = pool.get(pt.x, pt.y) as Breakable | null;
        if (bk) bk.spawnBreakable(pt.x, pt.y, kind);
      }
    };
    place(crateN, 'crate');
    place(barrelN, 'barrel');
  }

  /** 清掉場上所有可破壞物件（換區、轉場時） */
  clearAll(): void {
    for (const child of this.host.group().getChildren()) {
      const bk = child as Breakable;
      if (bk.active) bk.despawn();
    }
  }

  /**
   * 招式 AOE（圓形）直接秒碎範圍內的物件（不管剩餘血量）；一次最多 maxDropPerBreak 個掉道具，其餘只碎不掉
   *
   * @param x 圓心 x
   * @param y 圓心 y
   * @param radius 半徑（到物件外緣）
   * @param time 目前場景時間
   */
  breakInCircle(x: number, y: number, radius: number, time: number): void {
    this.shatterWhere((bk) => Phaser.Math.Distance.Between(x, y, bk.x, bk.y) <= radius + bk.getBodyRadius(), time);
  }

  /**
   * 招式 AOE（朝 dir 的定向矩形）直接秒碎範圍內的物件，掉落上限同 breakInCircle
   *
   * @param ox 矩形起點 x
   * @param oy 矩形起點 y
   * @param dir 方向（弧度）
   * @param back 起點往後延伸的長度
   * @param length 往前的長度
   * @param width 寬度
   * @param time 目前場景時間
   */
  breakInRect(ox: number, oy: number, dir: number, back: number, length: number, width: number, time: number): void {
    this.shatterWhere((bk) => pointInOrientedRect(bk.x, bk.y, ox, oy, dir, back, length, width), time);
  }

  /**
   * 普攻 / 衝刺順手打物件：範圍內依攻擊力扣血，血量歸零才打破（不鎖定、不算連段）
   *
   * @param c 攻擊的角色
   * @param radius 範圍半徑（到物件外緣）
   * @param half 扇形半角（useArc 時用）
   * @param useArc true = 普攻扇形（需在 aimAngle ± half 內）；false = 衝刺圓形
   * @param atk 攻擊力
   * @param time 目前場景時間
   */
  hitInRange(c: Character, radius: number, half: number, useArc: boolean, atk: number, time: number): void {
    for (const child of this.host.group().getChildren()) {
      const bk = child as Breakable;
      if (!bk.active || bk.dead) continue;
      if (Phaser.Math.Distance.Between(c.x, c.y, bk.x, bk.y) > radius + bk.getBodyRadius()) continue;
      if (useArc) {
        const toBk = Phaser.Math.Angle.Between(c.x, c.y, bk.x, bk.y);
        if (Math.abs(Phaser.Math.Angle.Wrap(toBk - c.aimAngle)) > half) continue;
      }
      if (bk.hit(atk)) this.breakOne(bk, time);
    }
  }

  /** 秒碎符合條件的物件（倒數中的爆炸桶跳過，它本來就會爆），掉落數有上限 */
  private shatterWhere(inRange: (bk: Breakable) => boolean, time: number): void {
    let drops = 0;
    for (const child of this.host.group().getChildren()) {
      const bk = child as Breakable;
      if (!bk.active || bk.dead) continue;
      if (!inRange(bk)) continue;
      if (bk.fusing) continue;
      bk.dead = true;
      const allowDrop = drops < GameConfig.breakable.maxDropPerBreak;
      this.breakOne(bk, time, allowDrop);
      if (allowDrop) drops++;
    }
  }

  /** 打破一個物件：爆炸桶進入倒數；木箱碎裂噴粒子、（allowDrop 時）機率掉道具並回收 */
  private breakOne(bk: Breakable, time: number, allowDrop = true): void {
    if (bk.explosive) { this.startBarrelFuse(bk, allowDrop); return; }
    const bx = bk.x, by = bk.y;
    this.spawnBreakParticles(bx, by);
    bk.despawn();
    if (allowDrop && Math.random() < GameConfig.items.dropChance) this.host.dropItemAt(bx, by, time);
  }

  /**
   * 爆炸桶打破後的倒數：桶閃紅、地面出現跟著桶走的警示圈（由內而外填滿 + 邊緣閃爍，倒數期間桶仍可被推），
   * fuseMs 後引爆，怪和玩家有時間跑出範圍
   */
  private startBarrelFuse(bk: Breakable, allowDrop: boolean): void {
    // 呼叫端打破時已把 dead 設為 true；爆炸桶打破代表進入倒數（還在場上、將爆），改由 fusing 表示狀態並還原 dead，
    // 否則倒數、推動與再受擊都會因 dead 跳過而變成殭屍桶。已在倒數中的不重新開始
    if (bk.fusing) { bk.dead = false; return; }
    const bcfg = GameConfig.breakable.barrel;
    const time = this.scene.time;
    bk.dead = false;
    bk.fusing = true;
    const R = bcfg.explodeRadius;
    const g = this.scene.add.graphics().setDepth(FUSE_RING_DEPTH);
    const start = time.now;
    const ev = time.addEvent({
      delay: FUSE_TICK_MS, loop: true,
      callback: () => {
        if (!bk.active || bk.dead) { g.destroy(); ev.remove(); return; }
        const p = Phaser.Math.Clamp((time.now - start) / bcfg.fuseMs, 0, 1);
        g.clear();
        const blink = Math.floor(time.now / FUSE_BLINK_MS) % 2 === 0;
        g.lineStyle(3, FUSE_RING_COLOR, blink ? 0.95 : 0.5);
        g.strokeCircle(bk.x, bk.y, R);
        g.fillStyle(FUSE_FILL_COLOR, 0.18 + 0.12 * p);
        g.fillCircle(bk.x, bk.y, R * p);
        // 桶身紅色與原色交替（不用 setTintFill 白色：時序殘留時會變成白塊）
        if (blink) bk.setTint(FUSE_TINT); else bk.clearTint();
        bk.setPosition(bk.x, bk.y);
      }
    });
    time.delayedCall(bcfg.fuseMs, () => {
      g.destroy(); ev.remove();
      if (bk.active && !bk.dead) this.explodeBarrel(bk, time.now, 0, allowDrop);
    });
  }

  /**
   * 引爆爆炸桶：火光、火花、強震；範圍內的怪受低傷並被炸飛（不可推動的不炸飛）、角色受傷（不擊退）；
   * 低機率掉道具；連鎖引爆範圍內其他桶（深度上限 maxChainDepth）
   *
   * @param depth 連鎖深度（0 = 第一顆）
   * @param allowDrop 是否可掉道具（連鎖引爆的不掉）
   */
  private explodeBarrel(bk: Breakable, time: number, depth: number, allowDrop = true): void {
    const bcfg = GameConfig.breakable.barrel;
    const ex = bk.x, ey = bk.y;
    bk.dead = true;
    bk.despawn();
    this.host.spawnExpandingRing(ex, ey, bcfg.explodeRadius, EXPLODE_RING_COLOR, EXPLODE_RING_MS);
    const core = this.scene.add.circle(ex, ey, bcfg.explodeRadius * 0.4, EXPLODE_CORE_COLOR, 0.8).setDepth(30);
    this.scene.tweens.add({ targets: core, alpha: 0, scale: 2.2, duration: 300, onComplete: () => core.destroy() });
    for (let i = 0; i < EXPLODE_SPARKS; i++) {
      const ang = Math.random() * Math.PI * 2, spd = 90 + Math.random() * 150;
      const col = Math.random() < 0.5 ? EXPLODE_RING_COLOR : EXPLODE_CORE_COLOR;
      const pr = this.scene.add.rectangle(ex, ey, 6, 6, col).setDepth(31);
      this.scene.tweens.add({ targets: pr, x: ex + Math.cos(ang) * spd, y: ey + Math.sin(ang) * spd, alpha: 0, angle: Phaser.Math.Between(-180, 180), duration: 360, onComplete: () => pr.destroy() });
    }
    this.host.shakeOnce(GameConfig.juice.burstShakeDuration + 40, GameConfig.juice.burstShakeIntensity * 1.6);
    // 範圍內的怪：低傷（不用內建擊退）後一次性強位移炸飛
    const a = this.host.arena();
    for (const child of this.host.enemies().getChildren()) {
      const e = child as Enemy;
      if (!e.active || !e.isVulnerable()) continue;
      const d = Phaser.Math.Distance.Between(ex, ey, e.x, e.y);
      if (d > bcfg.explodeRadius + e.getBodyRadius()) continue;
      this.host.damageEnemyFrom(this.host.player(), e, bcfg.explodeDamage, 0, ex, ey, time);
      if (!e.active || e.dead) continue;
      if (!isFixedEnemy(e)) {
        const ang = d > 0.001 ? Math.atan2(e.y - ey, e.x - ex) : Math.random() * Math.PI * 2;
        const r = e.getBodyRadius();
        e.setPosition(
          Phaser.Math.Clamp(e.x + Math.cos(ang) * bcfg.knockback, a.left + r, a.right - r),
          Phaser.Math.Clamp(e.y + Math.sin(ang) * bcfg.knockback, a.top + r, a.bottom - r)
        );
      }
    }
    // 範圍內的角色：受傷（快速扣血、慢速掉能量），不擊退
    for (const c of this.host.characters()) {
      if (!c.alive) continue;
      if (Phaser.Math.Distance.Between(ex, ey, c.x, c.y) <= bcfg.explodeRadius + GameConfig.player.radius) {
        this.host.damageCharacterFrom(c, bcfg.explodeDamage, ex, ey);
        this.host.flashHurt(c);
      }
    }
    if (allowDrop && Math.random() < bcfg.dropChance) this.host.dropItemAt(ex, ey, time);
    // 連鎖：範圍內其他桶稍後依序引爆，深度 + 1（超過上限的仍會被引爆一次，但不再往下連鎖）
    if (depth < bcfg.maxChainDepth) {
      for (const child of this.host.group().getChildren()) {
        const other = child as Breakable;
        if (!other.active || other.dead || !other.explosive) continue;
        if (Phaser.Math.Distance.Between(ex, ey, other.x, other.y) <= bcfg.explodeRadius + other.getBodyRadius()) {
          this.scene.time.delayedCall(CHAIN_DELAY_MS, () => {
            if (other.active && !other.dead) this.explodeBarrel(other, this.scene.time.now, depth + 1, false);
          });
        }
      }
    }
  }

  /** 木箱碎裂的小粒子 */
  private spawnBreakParticles(x: number, y: number): void {
    const color = GameConfig.breakable.color;
    for (let i = 0; i < BREAK_PARTICLES; i++) {
      const ang = (i / BREAK_PARTICLES) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 60 + Math.random() * 80;
      const p = this.scene.add.rectangle(x, y, 5, 5, color).setDepth(11);
      this.scene.tweens.add({
        targets: p, x: x + Math.cos(ang) * spd, y: y + Math.sin(ang) * spd,
        alpha: 0, angle: Phaser.Math.Between(-180, 180), duration: 320, onComplete: () => p.destroy()
      });
    }
  }
}
