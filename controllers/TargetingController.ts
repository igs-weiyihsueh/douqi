import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import { Breakable } from '../objects/Breakable';
import type { GroundFootprint } from '../systems/bodySeparation';
import { FOOT_DISC_DEPTH } from '../systems/footDisc';
import type { Enemy } from '../objects/Enemy';
import { Item } from '../objects/Item';

/** 可鎖定的目標：敵人、道具或可破壞物件（慢速模式圈內沒有怪時才鎖） */
export type LockTarget = Enemy | Item | Breakable;

/**
 * TargetingController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface TargetingHost {
  /** 擁有者場景（建立鎖定標記圖形用） */
  readonly scene: Phaser.Scene;
  /** 敵人物件池（之後才建立，用時才取） */
  enemies(): Phaser.Physics.Arcade.Group;
  /** 道具物件池 */
  items(): Phaser.Physics.Arcade.Group;
  /** 可破壞物件池（木箱） */
  breakables(): Phaser.GameObjects.Group;
  /** 全部角色（畫鎖定標記） */
  characters(): ReadonlyArray<Character>;
  /** P1 */
  player(): Character;
  /** 是否為慢速模式（鍵盤面向 + 範圍圈鎖定） */
  isSlowMode(): boolean;
  /** 慢速模式的鎖定範圍圈半徑（遊戲中可調） */
  slowLockRadius(): number;
  /** 敵人的地面佔位（新美術外觀的怪才有，鎖定框畫在腳底）；null = 舊美術，鎖定框畫在中心 */
  enemyFootprint(e: Enemy): GroundFootprint | null;
}

/** 鎖定標記深度 */
const LOCK_MARKER_DEPTH = 12;
/** 底部鎖定框的深度：在腳下圓盤之上、角色 / 怪物 / 木箱之下（像影子一樣貼在地面，不蓋住腳） */
const LOCK_FOOT_MARKER_DEPTH = FOOT_DISC_DEPTH + 1;
/** 腳底橢圓框的四分之一弧用幾段折線畫 */
const FOOT_ARC_SEGMENTS = 12;

/** 地面上的鎖定橢圓（外擴前）：中心與左右 / 上下半徑 */
interface FootFrame {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
/** 圓框四角短線長度 */
const LOCK_CORNER_LEN = 8;
/**
 * 鎖定框的四個角，依角色 index 歸屬（1P 右上、2P 左上、3P 右下、4P 左下）；腳底橢圓框也照同樣的四段分配；
 * arcFrom / arcTo 為圓框上該角那一段四分之一圓弧的角度（Phaser 角度：0 = 右、順時針為正）
 */
const SLOT_CORNERS: ReadonlyArray<{ right: boolean; top: boolean; arcFrom: number; arcTo: number }> = [
  { right: true, top: true, arcFrom: 270, arcTo: 360 },
  { right: false, top: true, arcFrom: 180, arcTo: 270 },
  { right: true, top: false, arcFrom: 0, arcTo: 90 },
  { right: false, top: false, arcFrom: 90, arcTo: 180 }
];
/** 「腳下」目標的判定距離加成（角色半徑之外）：這麼近的目標方向不穩定，不當作瞄準候選 */
const UNDERFOOT_EXTRA = 12;

/**
 * 鎖定與瞄準：決定 P1 每幀鎖定誰、BOT 想打誰，並畫出所有角色的鎖定標記。
 * - 快速模式（滑鼠）：autoLock = false（預設）時鎖定 = 滑鼠方向錐形內最接近方向的目標，滑鼠靜止時改鎖最近的可傷怪；
 *   autoLock = true 時為黏著式自動鎖定，滑鼠活躍且方向偏離夠多才換目標
 * - 慢速模式（鍵盤）：黏著式範圍圈鎖定，面向錐形內有目標優先，否則鎖圈內最近；主動把面向對準另一隻更準的才切換。
 *   圈內完全沒有怪時改鎖圈內最近的木箱，怪一進圈立刻切回怪（BOT 不鎖木箱）
 * - BOT：最近的敵人，或貪婪範圍內越稀有越想搶的道具
 */
export class TargetingController {
  private p1Target: LockTarget | null = null;
  /** 滑鼠最後移動時間（判斷瞄準是否活躍） */
  private lastPointerMoveAt = -Infinity;
  private readonly gfx: Phaser.GameObjects.Graphics;
  /** 新美術怪物與木箱的底部鎖定框（畫在地面那一層） */
  private readonly footGfx: Phaser.GameObjects.Graphics;

  constructor(private readonly host: TargetingHost) {
    this.gfx = host.scene.add.graphics().setDepth(LOCK_MARKER_DEPTH);
    this.footGfx = host.scene.add.graphics().setDepth(LOCK_FOOT_MARKER_DEPTH);
  }

  /** P1 目前鎖定的目標 */
  get lockedTarget(): LockTarget | null {
    return this.p1Target;
  }

  set lockedTarget(t: LockTarget | null) {
    this.p1Target = t;
  }

  /**
   * 滑鼠移動了（瞄準進入活躍狀態）
   *
   * @param time 目前場景時間
   */
  markPointerMoved(time: number): void {
    this.lastPointerMoveAt = time;
  }

  /** 滑鼠在 aimActiveWindowMs 內移動過 */
  isAimActive(time: number): boolean {
    return time - this.lastPointerMoveAt <= GameConfig.lock.aimActiveWindowMs;
  }

  /** 目標是否為道具 */
  isItem(t: LockTarget | null): t is Item {
    return t instanceof Item;
  }

  /** 目標是否為可破壞物件（木箱） */
  isBreakable(t: LockTarget | null): t is Breakable {
    return t instanceof Breakable;
  }

  /** 鎖定目標目前是否有效（敵人 = 可傷、道具 = 還在場上、木箱 = 已落地且未碎） */
  isLockValid(t: LockTarget | null): boolean {
    if (!t || !t.active) return false;
    if (this.isItem(t)) return true;
    if (this.isBreakable(t)) return !t.dead && !t.landing;
    return (t as Enemy).isVulnerable();
  }

  /** 敵人是否可當鎖定 / 瞄準候選：可傷的怪（守護 NPC 與預告中的怪不可傷） */
  isLockableEnemy(e: Enemy): boolean {
    return e.active && e.isVulnerable();
  }

  /**
   * 每幀更新 P1 的鎖定目標
   *
   * @param time 目前場景時間
   */
  update(time: number): void {
    const p = this.host.player();
    if (this.host.isSlowMode()) {
      this.updateSlowLock(p);
      return;
    }
    if (!p.alive) { this.p1Target = null; return; }
    // 融合瞄準：鎖定 = 滑鼠方向錐形內最接近的目標（給鎖定框與出手用）；滑鼠靜止且沒指到目標時鎖最近的可傷怪
    if (!GameConfig.aim.autoLock) {
      let t = this.pickAimConeTarget(p);
      if (!t && time - this.lastPointerMoveAt > GameConfig.lock.aimActiveWindowMs) t = this.findNearestDamageableEnemy(p);
      this.p1Target = t;
      return;
    }
    // 黏著式自動鎖定：目標失效或離太遠 → 重新取得
    const cur = this.p1Target;
    if (!this.isLockValid(cur) || Phaser.Math.Distance.Between(p.x, p.y, cur!.x, cur!.y) > GameConfig.lock.loseTargetRadius) {
      this.p1Target = this.acquireTarget(p, time);
      return;
    }
    // 只有滑鼠活躍且方向與目前目標的夾角超過門檻才重選；否則維持，不亂跳
    if (this.isAimActive(time)) {
      const toCur = Phaser.Math.Angle.Between(p.x, p.y, cur!.x, cur!.y);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(toCur - p.aimAngle));
      if (diff > Phaser.Math.DegToRad(GameConfig.lock.switchAngleDeg)) {
        const next = this.pickTargetByAim(p);
        if (next) this.p1Target = next;
      }
    }
  }

  /**
   * 慢速模式：範圍圈內有敵人就一定鎖。黏著式——目前目標存活且在圈內就維持（面向轉開也不脫鎖），
   * 只在面向錐形內有另一隻比目前目標更接近面向時才切換；沒有有效目標時先找面向錐形、再找圈內最近。
   * 面向錐形內的木箱與怪一起比角度（面向木箱就鎖木箱）；圈內沒有怪也沒有道具時鎖圈內最近的木箱；
   * 鎖著木箱時，面向錐形內沒有更接近面向的目標就繼續打木箱，錐形內什麼都沒有且圈內有怪才改鎖怪
   */
  private updateSlowLock(p: Character): void {
    if (!p.alive) { this.p1Target = null; return; }
    const R = this.host.slowLockRadius();
    const cur = this.p1Target;
    if (this.isBreakable(cur)) {
      const crateValid = this.isLockValid(cur) && cur.distanceTo(p.x, p.y) <= R;
      const next = this.pickAimConeTarget(p, R) ?? this.pickNearestInCircle(p, R);
      this.p1Target = next ?? (crateValid ? cur : this.pickNearestBreakable(p, R));
      return;
    }
    const curValid = this.isLockValid(cur) && Phaser.Math.Distance.Between(p.x, p.y, cur!.x, cur!.y) <= R;
    if (curValid) {
      const aimTarget = this.pickAimConeTarget(p, R);
      if (aimTarget && aimTarget !== cur) {
        const toCur = Phaser.Math.Angle.Between(p.x, p.y, cur!.x, cur!.y);
        const curDiff = Math.abs(Phaser.Math.Angle.Wrap(toCur - p.aimAngle));
        const toAim = Phaser.Math.Angle.Between(p.x, p.y, aimTarget.x, aimTarget.y);
        const aimDiff = Math.abs(Phaser.Math.Angle.Wrap(toAim - p.aimAngle));
        if (aimDiff < curDiff) this.p1Target = aimTarget;
      }
      return;
    }
    this.p1Target = this.pickAimConeTarget(p, R) ?? this.pickNearestInCircle(p, R) ?? this.pickNearestBreakable(p, R);
  }

  /**
   * 圈內最近的木箱（以角色到木箱碰撞矩形的距離計算；降落中、已碎的不算）；沒有則 null
   *
   * @param c 角色
   * @param R 範圍圈半徑
   */
  private pickNearestBreakable(c: Character, R: number): Breakable | null {
    let best: Breakable | null = null;
    let bestDist = R;
    for (const child of this.host.breakables().getChildren()) {
      const bk = child as Breakable;
      if (!this.isLockValid(bk)) continue;
      const d = bk.distanceTo(c.x, c.y);
      if (d <= bestDist) { bestDist = d; best = bk; }
    }
    return best;
  }

  /** 沒有有效鎖定時取得新目標：滑鼠活躍用方向選，否則選最近（皆含道具） */
  private acquireTarget(p: Character, time: number): LockTarget | null {
    return this.isAimActive(time) ? this.pickTargetByAim(p) : this.findNearestLockable(p);
  }

  /** 依「與 aimAngle 的夾角 + 距離」評分，選最合適的候選（敵人與道具平等參與） */
  private pickTargetByAim(c: Character): LockTarget | null {
    const maxR = GameConfig.lock.searchRadius;
    let best: LockTarget | null = null;
    let bestScore = Infinity;
    this.forEachCandidate((obj) => {
      const dist = Phaser.Math.Distance.Between(c.x, c.y, obj.x, obj.y);
      if (dist > maxR) return;
      const toObj = Phaser.Math.Angle.Between(c.x, c.y, obj.x, obj.y);
      const score = dist + Math.abs(Phaser.Math.Angle.Wrap(toObj - c.aimAngle)) * GameConfig.lock.angleWeight;
      if (score < bestScore) { bestScore = score; best = obj; }
    });
    return best;
  }

  /** 搜尋範圍內最近的候選（敵人與道具） */
  private findNearestLockable(c: Character): LockTarget | null {
    const maxR = GameConfig.lock.searchRadius;
    let best: LockTarget | null = null;
    let bestDist = Infinity;
    this.forEachCandidate((obj) => {
      const dist = Phaser.Math.Distance.Between(c.x, c.y, obj.x, obj.y);
      if (dist <= maxR && dist < bestDist) { bestDist = dist; best = obj; }
    });
    return best;
  }

  /** 依序走訪可鎖定的敵人與場上道具 */
  private forEachCandidate(visit: (obj: LockTarget) => void): void {
    for (const child of this.host.enemies().getChildren()) {
      const e = child as Enemy;
      if (this.isLockableEnemy(e)) visit(e);
    }
    for (const child of this.host.items().getChildren()) {
      const it = child as Item;
      if (it.active) visit(it);
    }
  }

  /**
   * c.aimAngle 方向錐形（±aimConeDeg、searchR 內）中最接近方向的候選（敵人、道具、木箱）；錐形外不鎖（才能朝空地走位）。
   * 道具的角度差打折，略優先於敵人；木箱與敵人同等比角度（面向木箱就能鎖到，距離以角色到木箱碰撞矩形計算）。
   * 方向來源一律是 c.aimAngle（快速 = 滑鼠、慢速 = 鍵盤面向）
   *
   * @param c 瞄準的角色
   * @param searchR 搜尋半徑（快速模式預設 lock.searchRadius；慢速傳範圍圈半徑）
   */
  pickAimConeTarget(c: Character, searchR: number = GameConfig.lock.searchRadius): LockTarget | null {
    const cone = Phaser.Math.DegToRad(GameConfig.aim.aimConeDeg);
    // 「腳下」的目標（距離約為 0）方向不穩定又恆被選中，會黏死；排除後滑鼠才能指向他處
    const underfootR = GameConfig.player.radius + UNDERFOOT_EXTRA;
    let best: LockTarget | null = null;
    let bestScore = Infinity; // 套用道具優惠後的有效角度差
    for (const child of this.host.enemies().getChildren()) {
      const enemy = child as Enemy;
      if (!this.isLockableEnemy(enemy)) continue;
      const dist = Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y);
      if (dist <= underfootR || dist > searchR) continue;
      const toE = Phaser.Math.Angle.Between(c.x, c.y, enemy.x, enemy.y);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(toE - c.aimAngle));
      if (diff > cone) continue;
      if (diff < bestScore) { bestScore = diff; best = enemy; }
    }
    const itemMult = GameConfig.aim.itemAimPriorityMult;
    for (const child of this.host.items().getChildren()) {
      const item = child as Item;
      if (!item.active) continue;
      const dist = Phaser.Math.Distance.Between(c.x, c.y, item.x, item.y);
      if (dist <= underfootR || dist > searchR) continue;
      const toI = Phaser.Math.Angle.Between(c.x, c.y, item.x, item.y);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(toI - c.aimAngle));
      if (diff > cone) continue; // 實際角度差仍須在錐形內
      const score = diff * itemMult;
      if (score < bestScore) { bestScore = score; best = item; }
    }
    for (const child of this.host.breakables().getChildren()) {
      const bk = child as Breakable;
      if (!this.isLockValid(bk)) continue;
      if (Phaser.Math.Distance.Between(c.x, c.y, bk.x, bk.y) <= underfootR || bk.distanceTo(c.x, c.y) > searchR) continue;
      const diff = Math.abs(Phaser.Math.Angle.Wrap(Phaser.Math.Angle.Between(c.x, c.y, bk.x, bk.y) - c.aimAngle));
      if (diff > cone) continue;
      if (diff < bestScore) { bestScore = diff; best = bk; }
    }
    return best;
  }

  /** 圈內最近的可鎖敵人（不限角度，只含敵人）；沒有則 null */
  private pickNearestInCircle(c: Character, R: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDistSq = R * R;
    for (const child of this.host.enemies().getChildren()) {
      const e = child as Enemy;
      if (!this.isLockableEnemy(e)) continue;
      const dx = e.x - c.x, dy = e.y - c.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) { bestDistSq = distSq; best = e; }
    }
    return best;
  }

  /** 搜尋範圍內最近的可傷怪（不含守護 NPC），滑鼠靜止時的自動鎖定用 */
  findNearestDamageableEnemy(c: Character): Enemy | null {
    const searchR = GameConfig.lock.searchRadius;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const child of this.host.enemies().getChildren()) {
      const e = child as Enemy;
      if (!e.isVulnerable()) continue;
      const d = Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y);
      if (d > searchR || d >= bestD) continue;
      bestD = d; best = e;
    }
    return best;
  }

  /**
   * 距離 c 在 radius + 敵人體型半徑以內的可傷怪中，最貼近（超出命中門檻量最小）的一隻；
   * 納入體型半徑，大體型的 BOSS / 塔衝到外緣也算命中
   *
   * @param c 角色
   * @param radius 命中半徑（角色中心到敵人外緣）
   */
  findFirstEnemyInRangeOf(c: Character, radius: number): Enemy | null {
    let best: Enemy | null = null;
    let bestExcess = Infinity;
    for (const child of this.host.enemies().getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      const dist = Math.hypot(enemy.x - c.x, enemy.y - c.y);
      const reach = radius + enemy.getBodyRadius();
      if (dist <= reach) {
        const excess = dist - reach;
        if (excess < bestExcess) { bestExcess = excess; best = enemy; }
      }
    }
    return best;
  }

  /**
   * BOT 的目標：比較「最近的敵人」與「貪婪範圍內最誘人的道具」，取較優者。
   * 道具的等效距離 = 實際距離 × distanceBias × 掉落權重 ^ rarityExponent（越稀有越小、越想搶）；
   * 只考慮 greedRadius 內的道具，避免為遠處道具放棄戰鬥
   *
   * @param bot BOT 角色
   */
  pickBotTarget(bot: Character): LockTarget | null {
    const enemy = this.findFirstEnemyInRangeOf(bot, GameConfig.bot.targetSearchRadius);
    const enemyDist = enemy ? Phaser.Math.Distance.Between(bot.x, bot.y, enemy.x, enemy.y) : Infinity;
    const cfg = GameConfig.bot.item;
    const w = GameConfig.items.weights;
    let bestItem: Item | null = null;
    let bestItemScore = Infinity;
    for (const child of this.host.items().getChildren()) {
      const it = child as Item;
      if (!it.active || it.taken) continue;
      const dist = Phaser.Math.Distance.Between(bot.x, bot.y, it.x, it.y);
      if (dist > cfg.greedRadius) continue;
      const score = dist * cfg.distanceBias * Math.pow(w[it.skill] ?? 1, cfg.rarityExponent);
      if (score < bestItemScore) { bestItemScore = score; bestItem = it; }
    }
    if (!bestItem) return enemy;
    if (!enemy) return bestItem;
    return bestItemScore <= enemyDist ? bestItem : enemy;
  }

  /** 可傷敵人的位置平均（BOT 沒目標時朝這裡游走）；沒有則 null */
  enemyClusterCenter(): { x: number; y: number } | null {
    let sumX = 0, sumY = 0, count = 0;
    for (const child of this.host.enemies().getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      sumX += enemy.x;
      sumY += enemy.y;
      count++;
    }
    return count === 0 ? null : { x: sumX / count, y: sumY / count };
  }

  /**
   * 畫所有角色的鎖定標記：同一目標只畫一個共用框（新美術的怪與木箱：底部扁橢圓 + 四角；舊美術的怪 / 道具：圓 + 四角），框用鎖定者的 P 位代表色，
   * 多人鎖定時依 cornerOwners 分段上色；每段先畫深色描邊再畫彩色線，在任何地面上都看得清楚
   */
  drawMarkers(): void {
    this.footGfx.clear();
    this.gfx.clear();
    const m = GameConfig.lock.marker;
    const colors = GameConfig.characters.colors;
    // 目標 → 鎖定它的角色 index（依 P 位順序）
    const groups = new Map<LockTarget, number[]>();
    for (const c of this.host.characters()) {
      if (!c.alive) continue;
      const t = c.lockedTarget as unknown as LockTarget | null;
      if (!this.isLockValid(t)) continue;
      const list = groups.get(t!);
      if (list) list.push(c.index);
      else groups.set(t!, [c.index]);
    }
    for (const [t, lockers] of groups) {
      const owners = this.cornerOwners(lockers.sort((a, b) => a - b));
      const foot = this.footFrameOf(t);
      const g = foot ? this.footGfx : this.gfx;
      // 兩趟：先畫描邊（較粗、深色），再疊上各角的 P 位顏色
      for (const outline of [true, false]) {
        SLOT_CORNERS.forEach((corner, i) => {
          if (outline) g.lineStyle(m.thickness + m.outlineExtra, m.outlineColor, m.outlineAlpha);
          else g.lineStyle(m.thickness, colors[owners[i] % colors.length], 1);
          if (foot) this.strokeFootCorner(foot, corner);
          else this.strokeFrameCorner(t as Enemy | Item, corner);
        });
      }
    }
  }

  /**
   * 框四個角（SLOT_CORNERS 順序）各用哪個 P 位的顏色：
   * 1 人鎖定 → 四角同色；2 人 → 編號小的佔右半、大的佔左半；3~4 人 → 每個角歸該角的 P 位，沒人鎖的角沿用同側另一角
   *
   * @param lockers 鎖定這個目標的角色 index（由小到大）
   * @returns 四個角的角色 index
   */
  private cornerOwners(lockers: ReadonlyArray<number>): number[] {
    if (lockers.length === 1) return SLOT_CORNERS.map(() => lockers[0]);
    if (lockers.length === 2) return SLOT_CORNERS.map((corner) => (corner.right ? lockers[0] : lockers[1]));
    return SLOT_CORNERS.map((corner, i) => {
      if (lockers.includes(i)) return i;
      const sameSide = SLOT_CORNERS.findIndex((other, j) => j !== i && other.right === corner.right);
      return lockers.includes(sameSide) ? sameSide : lockers[0];
    });
  }

  /**
   * 畫圓框的其中一角（舊美術的怪 / 道具）：該角的四分之一圓弧加外接正方形的角線
   *
   * @param t 鎖定目標
   * @param corner 哪一角
   */
  private strokeFrameCorner(t: Enemy | Item, corner: (typeof SLOT_CORNERS)[number]): void {
    const g = this.gfx;
    const sx = corner.right ? 1 : -1;
    const sy = corner.top ? -1 : 1;
    const rad = this.frameRadius(t);
    g.beginPath();
    g.arc(t.x, t.y, rad, Phaser.Math.DegToRad(corner.arcFrom), Phaser.Math.DegToRad(corner.arcTo));
    g.strokePath();
    const x = t.x + sx * rad, y = t.y + sy * rad;
    g.lineBetween(x, y, x - sx * LOCK_CORNER_LEN, y);
    g.lineBetween(x, y, x, y - sy * LOCK_CORNER_LEN);
  }

  /**
   * 鎖定目標在地面上的橢圓：新美術外觀的怪為腳底佔位（GroundFootprint）；木箱 / 桶為碰撞矩形底邊中點、寬度同碰撞矩形、
   * 扁度同怪的腳底佔位（enemySeparation.footprintFlatten）；道具與舊美術的怪為 null（畫圓框）
   *
   * @param t 鎖定目標
   */
  private footFrameOf(t: LockTarget): FootFrame | null {
    if (this.isItem(t)) return null;
    if (this.isBreakable(t)) {
      const b = t.getBody();
      const rx = b.width / 2;
      return { cx: b.centerX, cy: b.bottom, rx, ry: rx * GameConfig.enemySeparation.footprintFlatten };
    }
    const fp: GroundFootprint | null = this.host.enemyFootprint(t);
    return fp ? { cx: t.x, cy: t.y + fp.footY, rx: fp.rx, ry: fp.ry } : null;
  }

  /**
   * 畫底部橢圓框的其中一角：地面橢圓外擴 marker.footPadding（上下依同樣扁度）的四分之一弧，加外接矩形的角線
   *
   * @param foot 地面橢圓
   * @param corner 哪一角
   */
  private strokeFootCorner(foot: FootFrame, corner: (typeof SLOT_CORNERS)[number]): void {
    const g = this.footGfx;
    const pad = GameConfig.lock.marker.footPadding;
    const { cx, cy } = foot;
    const rx = foot.rx + pad, ry = foot.ry + pad * (foot.ry / foot.rx);
    const from = Phaser.Math.DegToRad(corner.arcFrom), to = Phaser.Math.DegToRad(corner.arcTo);
    const points: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= FOOT_ARC_SEGMENTS; i++) {
      const a = from + ((to - from) * i) / FOOT_ARC_SEGMENTS;
      points.push(new Phaser.Math.Vector2(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
    }
    g.strokePoints(points);
    const sx = corner.right ? 1 : -1;
    const sy = corner.top ? -1 : 1;
    const x = cx + sx * rx, y = cy + sy * ry;
    g.lineBetween(x, y, x - sx * LOCK_CORNER_LEN, y);
    g.lineBetween(x, y, x, y - sy * LOCK_CORNER_LEN);
  }

  /**
   * 圓框半徑：至少 marker.radius；敵人依碰撞半徑 + enemyPadding 放大
   *
   * @param t 鎖定目標（怪或道具）
   */
  private frameRadius(t: Enemy | Item): number {
    const m = GameConfig.lock.marker;
    return this.isItem(t) ? m.radius : Math.max(m.radius, t.getBodyRadius() + m.enemyPadding);
  }
}
