import Phaser from 'phaser';
import { GameConfig } from '../config';
import { crateBodyBounds, distanceToBounds, type Breakable } from '../objects/Breakable';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import { isFixedEnemy } from '../systems/enemyKinds';
import { orientedRectIntersectsBox, sectorIntersectsBox } from '../systems/geometry';
import type { VisibleBounds } from '../systems/spriteFeet';

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
  /** 角色的攻擊命中物件（與命中敵人一樣計算 CREDIT 扣點） */
  onBreakableHit(actor: Character, time: number): void;
  dropItemAt(x: number, y: number, time: number): void;
  spawnExpandingRing(x: number, y: number, radius: number, color: number, ms?: number): void;
  shakeOnce(duration: number, intensity: number): void;
}

/** 非關卡制每波散布的嘗試次數（堆中心 / 堆內物件） */
const CLUSTER_TRIES = 20;
const IN_CLUSTER_TRIES = 16;
/** 物件彼此（堆內、降落點）、物件與角色、新爆炸桶與木箱之間多留的縫 */
const IN_CLUSTER_GAP = 4;
const PLAYER_GAP = 8;
const BARREL_CRATE_GAP = 6;
/**
 * 兩個同樣碰撞範圍的木箱分別放在 a、b 時是否重疊（含 gap 的縫）
 *
 * @param bounds 木箱碰撞範圍（各邊相對物件位置）
 */
function cratesOverlap(ax: number, ay: number, bx: number, by: number, bounds: VisibleBounds, gap: number): boolean {
  return Math.abs(ax - bx) < bounds.right - bounds.left + gap && Math.abs(ay - by) < bounds.bottom - bounds.top + gap;
}

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
 * - 布置：非關卡制每波成堆散布（遠離中心、避開玩家、彼此不疊）；關卡制隨每批怪從天而降（dropWithFormation）
 * - 打破：普攻扇形 / 衝刺圓形 / 招式 AOE（圓形 / 定向矩形）每次命中扣 1 耐久（Breakable.hit），歸零才碎；
 *   一次攻擊最多掉 maxDropPerBreak 個道具；命中至少一個時通知場景計算 CREDIT（onBreakableHit），HIT 連擊由各攻擊的呼叫端計算
 * - 木箱碎裂噴粒子、機率掉道具；爆炸桶（barrel.enabled 停用中）打破後先倒數（地面警示圈）再爆炸：怪受傷並被炸飛、角色受傷、連鎖引爆附近的桶
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
      const crateBounds = crateBodyBounds(this.scene.textures);
      for (let n = 0; n < cfg.perCluster; n++) {
        if (pool.countActive(true) >= cfg.maxAlive) break;
        let bx = 0, by = 0, placedOk = false;
        for (let attempt = 0; attempt < IN_CLUSTER_TRIES; attempt++) {
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.random() * cfg.clusterSpread;
          const x = Phaser.Math.Clamp(hx + Math.cos(ang) * rad, a.left + inset, a.right - inset);
          const y = Phaser.Math.Clamp(hy + Math.sin(ang) * rad, a.top + inset, a.bottom - inset);
          if (distanceToBounds(p.x, p.y, x, y, crateBounds) < GameConfig.player.radius + PLAYER_GAP) continue;
          if (placed.some((q) => cratesOverlap(x, y, q.x, q.y, crateBounds, IN_CLUSTER_GAP))) continue;
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
    if (!bcfg.enabled) return;
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
          const clashes = o.explosive
            ? Phaser.Math.Distance.Between(x, y, o.x, o.y) < bcfg.minBarrelSpacing
            : o.distanceTo(x, y) < bcfg.radius + BARREL_CRATE_GAP;
          if (clashes) { clash = true; break; }
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
   * 關卡制：一批怪出生時跟著降落木箱——小關卡第一批必掉，之後 drop.chance 機率；每次 drop.count 個，
   * 場上（含降落中）達 drop.maxAlive 就不掉，找不到合適落點的少掉
   *
   * @param firstOfStage 是否為這個小關卡的第一批怪
   */
  dropWithFormation(firstOfStage: boolean): void {
    const cfg = GameConfig.breakable.drop;
    if (!firstOfStage && Math.random() >= cfg.chance) return;
    const pool = this.host.group();
    const want = Math.min(Phaser.Math.Between(cfg.count[0], cfg.count[1]), cfg.maxAlive - pool.countActive(true));
    const bounds = crateBodyBounds(this.scene.textures);
    for (let n = 0; n < want; n++) {
      const pt = this.pickDropPoint(bounds);
      if (!pt) continue;
      const bk = pool.get(pt.x, pt.y) as Breakable | null;
      if (!bk) break;
      const bcfg = GameConfig.breakable.barrel;
      bk.spawnBreakable(pt.x, pt.y, bcfg.enabled && Math.random() < bcfg.dropShare ? 'barrel' : 'crate');
      bk.dropIn(() => this.onDropLanded(bk));
    }
  }

  /**
   * 找一個降落點：鏡頭畫面內（內縮 drop.viewInset）且在移動區內；木箱碰撞範圍離每位玩家至少 minDistFromPlayer、
   * 不壓到怪、不與其他物件（含降落中）重疊。嘗試 placeTries 次都不行回傳 null
   *
   * @param bounds 木箱碰撞範圍（各邊相對物件位置）
   */
  private pickDropPoint(bounds: VisibleBounds): { x: number; y: number } | null {
    const cfg = GameConfig.breakable.drop;
    const a = this.host.arena();
    // 場景剛建立、鏡頭還沒算過畫面範圍時（寬高為 0）只限在移動區內
    const cam = this.scene.cameras.main.worldView;
    const v = cam.width > 0 && cam.height > 0 ? cam : a;
    const left = Math.max(a.left, v.left + cfg.viewInset) - bounds.left;
    const right = Math.min(a.right, v.right - cfg.viewInset) - bounds.right;
    const top = Math.max(a.top, v.top + cfg.viewInset) - bounds.top;
    const bottom = Math.min(a.bottom, v.bottom - cfg.viewInset) - bounds.bottom;
    if (left > right || top > bottom) return null;
    for (let attempt = 0; attempt < cfg.placeTries; attempt++) {
      const x = Phaser.Math.FloatBetween(left, right);
      const y = Phaser.Math.FloatBetween(top, bottom);
      if (this.host.characters().some((c) => c.alive && distanceToBounds(c.x, c.y, x, y, bounds) < cfg.minDistFromPlayer)) continue;
      let blocked = false;
      for (const child of this.host.enemies().getChildren()) {
        const e = child as Enemy;
        if (e.active && !e.dead && distanceToBounds(e.x, e.y, x, y, bounds) < e.getBodyRadius() + cfg.enemyGap) { blocked = true; break; }
      }
      if (blocked) continue;
      for (const child of this.host.group().getChildren()) {
        const o = child as Breakable;
        if (o.active && cratesOverlap(x, y, o.x, o.y, bounds, IN_CLUSTER_GAP)) { blocked = true; break; }
      }
      if (!blocked) return { x, y };
    }
    return null;
  }

  /**
   * 木箱落地：四周噴塵土、鏡頭小震
   *
   * @param bk 剛落地的物件
   */
  private onDropLanded(bk: Breakable): void {
    const cfg = GameConfig.breakable.drop;
    const body = bk.getBody();
    const x = body.centerX, y = body.bottom;
    for (let i = 0; i < cfg.dustCount; i++) {
      const ang = (i / cfg.dustCount) * Math.PI * 2;
      const dist = Phaser.Math.Between(cfg.dustDistance[0], cfg.dustDistance[1]);
      const dust = this.scene.add.circle(x, y, cfg.dustSize / 2, cfg.dustColor, 0.9).setDepth(cfg.shadowDepth + 1);
      this.scene.tweens.add({
        targets: dust, x: x + Math.cos(ang) * dist, y: y + Math.sin(ang) * dist * 0.4, alpha: 0, scale: 1.8,
        duration: cfg.dustMs, ease: 'Cubic.easeOut', onComplete: () => dust.destroy()
      });
    }
    this.host.shakeOnce(cfg.shakeMs, cfg.shakeIntensity);
  }

  /** 清掉場上所有可破壞物件（換區、轉場時） */
  clearAll(): void {
    for (const child of this.host.group().getChildren()) {
      const bk = child as Breakable;
      if (bk.active) bk.despawn();
    }
  }

  /**
   * 招式 AOE（圓形）命中範圍內的物件，每個扣 1 耐久
   *
   * @param actor 施放的角色
   * @param x 圓心 x
   * @param y 圓心 y
   * @param radius 半徑（到物件的碰撞矩形）
   * @param time 目前場景時間
   * @returns 命中的物件數
   */
  hitInCircle(actor: Character, x: number, y: number, radius: number, time: number): number {
    return this.hitWhere(actor, (bk) => bk.distanceTo(x, y) <= radius, time);
  }

  /**
   * 招式 AOE（朝 dir 的定向矩形）命中範圍內的物件，每個扣 1 耐久
   *
   * @param actor 施放的角色
   * @param ox 矩形起點 x
   * @param oy 矩形起點 y
   * @param dir 方向（弧度）
   * @param back 起點往後延伸的長度
   * @param length 往前的長度
   * @param width 寬度
   * @param time 目前場景時間
   * @returns 命中的物件數
   */
  hitInRect(actor: Character, ox: number, oy: number, dir: number, back: number, length: number, width: number, time: number): number {
    return this.hitWhere(actor, (bk) => orientedRectIntersectsBox(ox, oy, dir, back, length, width, bk.getBody()), time);
  }

  /**
   * 普攻 / 衝刺打物件：範圍內每個扣 1 耐久
   *
   * @param c 攻擊的角色
   * @param radius 範圍半徑（到物件的碰撞矩形）
   * @param half 扇形半角（useArc 時用）
   * @param useArc true = 普攻扇形（aimAngle ± half 與碰撞矩形重疊）；false = 衝刺圓形
   * @param time 目前場景時間
   * @param alreadyHit 這一招已命中過的物件（跳過；命中的會加進去）——衝刺每幀判定，一次衝刺每個物件只算一下
   * @returns 命中的物件數
   */
  hitInRange(c: Character, radius: number, half: number, useArc: boolean, time: number, alreadyHit?: Set<Breakable>): number {
    return this.hitWhere(c, (bk) => {
      if (alreadyHit?.has(bk)) return false;
      if (!useArc) return bk.distanceTo(c.x, c.y) <= radius;
      return sectorIntersectsBox(c.x, c.y, radius, c.aimAngle, half, bk.getBody());
    }, time, alreadyHit);
  }

  /**
   * 命中符合條件的物件：各扣 1 耐久，打破的碎裂（一次最多 maxDropPerBreak 個掉道具）；命中至少一個時通知場景計算 CREDIT
   *
   * @param actor 攻擊的角色
   * @param inRange 物件是否在攻擊範圍內
   * @param time 目前場景時間
   * @param hitSet 有給時把命中的物件加進去
   * @returns 命中的物件數
   */
  private hitWhere(actor: Character, inRange: (bk: Breakable) => boolean, time: number, hitSet?: Set<Breakable>): number {
    let hits = 0;
    let drops = 0;
    for (const child of this.host.group().getChildren()) {
      const bk = child as Breakable;
      if (!bk.active || bk.dead || bk.fusing || bk.landing || !inRange(bk)) continue;
      const result = bk.hit(time);
      if (result === 'ignored') continue;
      hits++;
      hitSet?.add(bk);
      if (result === 'broken') {
        const allowDrop = drops < GameConfig.breakable.maxDropPerBreak;
        this.breakOne(bk, time, allowDrop);
        if (allowDrop) drops++;
      }
    }
    if (hits > 0) this.host.onBreakableHit(actor, time);
    return hits;
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
        if (other.distanceTo(ex, ey) <= bcfg.explodeRadius) {
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
