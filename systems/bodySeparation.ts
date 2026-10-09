import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Breakable } from '../objects/Breakable';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import { isFixedEnemy, isStructureEnemy } from './enemyKinds';

/**
 * 角色 / 敵人 / 可推動物件之間的位置分離（無狀態）。
 *
 * 全部用距離數學手動校正位置，不使用 Arcade collider：圓形 collider 在高速持續推擠時會慢慢穿透。
 * 呼叫端（GameScene）決定每幀何時套用，例如時停、衝刺中不套用。
 */

/** 完全重疊時的預設推出方向（避免除以 0） */
const FALLBACK_NORMAL = { x: 1, y: 0 } as const;

/**
 * 從 from 指向 to 的單位向量與距離；距離近乎 0 時回傳預設方向
 */
function normalBetween(fromX: number, fromY: number, toX: number, toY: number): { nx: number; ny: number; d: number } {
  const dx = toX - fromX, dy = toY - fromY;
  const d = Math.hypot(dx, dy);
  if (d > 0.001) return { nx: dx / d, ny: dy / d, d };
  return { nx: FALLBACK_NORMAL.x, ny: FALLBACK_NORMAL.y, d };
}

/**
 * 邊界反彈：敵人超出移動區時夾回內側，並把撞牆那一軸的速度反向（乘 bounceRestitution）
 *
 * @param enemy 敵人
 * @param arena 移動區
 */
export function bounceEnemyOffBounds(enemy: Enemy, arena: Phaser.Geom.Rectangle): void {
  const r = enemy.getBodyRadius();
  const body = enemy.body as Phaser.Physics.Arcade.Body;
  const rest = GameConfig.arena.bounceRestitution;
  const left = arena.left + r, right = arena.right - r;
  const top = arena.top + r, bottom = arena.bottom - r;
  if (enemy.x < left) {
    enemy.x = left;
    if (body.velocity.x < 0) body.velocity.x = -body.velocity.x * rest;
  } else if (enemy.x > right) {
    enemy.x = right;
    if (body.velocity.x > 0) body.velocity.x = -body.velocity.x * rest;
  }
  if (enemy.y < top) {
    enemy.y = top;
    if (body.velocity.y < 0) body.velocity.y = -body.velocity.y * rest;
  } else if (enemy.y > bottom) {
    enemy.y = bottom;
    if (body.velocity.y > 0) body.velocity.y = -body.velocity.y * rest;
  }
}

// ---------------------------------------------------------------------------
// 敵人 ↔ 敵人：軟分離 steering（主力）+ 硬 de-overlap（補刀）
// ---------------------------------------------------------------------------

/**
 * 敵人分離時是否「像牆」（只推別人、自己不動）：固定目標、寶箱怪，以及蓄力站定中的怪
 * （蓄力時被推走會打亂演出）
 */
function isWallLike(e: Enemy): boolean {
  if (isFixedEnemy(e) || e.enemyType === 'treasure') return true;
  return e.isCharging() || e.isChargingBomb();
}

/**
 * 敵人在地面上的佔位橢圓（F4 新美術的側視站立圖用）：中心在腳底，左右半徑 rx、上下半徑 ry
 */
export interface GroundFootprint {
  /** 腳底離敵人中心的垂直距離 */
  footY: number;
  rx: number;
  ry: number;
}

/** 查詢敵人的地面佔位；null = 沿用中心 + 身體半徑的圓（舊美術） */
export type FootprintOf = (e: Enemy) => GroundFootprint | null;

/** 參與分離的一隻敵人：本幀快取地面佔位、是否像牆（分離過程中不變） */
interface SepAgent {
  e: Enemy;
  /** 地面佔位；null = 中心 + 身體半徑的圓 */
  fp: GroundFootprint | null;
  wall: boolean;
}

/**
 * 兩隻敵人的分離幾何：從 a 指向 b 的方向、距離與不重疊所需的最小距離。
 * 兩隻都沒有地面佔位時 = 中心距離對身體半徑和（原本的圓形判定）；
 * 任一隻有地面佔位時改用腳底距離對「兩個佔位橢圓相加」的邊界（沒有佔位的一方以中心 + 身體半徑的圓代入）
 *
 * @param a 敵人 a
 * @param b 敵人 b
 */
function enemyPairSpacing(a: SepAgent, b: SepAgent): { nx: number; ny: number; d: number; minDist: number; footprint: boolean } {
  const ea = a.e, eb = b.e;
  if (!a.fp && !b.fp) {
    const { nx, ny, d } = normalBetween(ea.x, ea.y, eb.x, eb.y);
    return { nx, ny, d, minDist: ea.getBodyRadius() + eb.getBodyRadius(), footprint: false };
  }
  const ra = ea.getBodyRadius(), rb = eb.getBodyRadius();
  const pa = a.fp ?? { footY: 0, rx: ra, ry: ra };
  const pb = b.fp ?? { footY: 0, rx: rb, ry: rb };
  const { nx, ny, d } = normalBetween(ea.x, ea.y + pa.footY, eb.x, eb.y + pb.footY);
  const A = pa.rx + pb.rx, B = pa.ry + pb.ry;
  return { nx, ny, d, minDist: (A * B) / Math.hypot(B * nx, A * ny), footprint: true };
}

/** 空間格子 key 的偏移（格子座標可能為負） */
const GRID_KEY_OFFSET = 32768;
/** 硬分離格子的額外寬度：同一輪迭代中被推開後仍能找到彼此（推移每次 ≤ maxStepPx） */
const OVERLAP_GRID_MARGIN = 40;

/**
 * 空間格子：把每隻敵人的參考點（有佔位用腳底、否則中心）登記到 cellSize 的格子，
 * 查詢時只看自己與周圍 8 格。cellSize ≥ 最大影響距離時，找出的鄰居與「全部兩兩比對」完全相同
 */
class SeparationGrid {
  private readonly cells = new Map<number, number[]>();

  /**
   * @param agents 參與分離的敵人（索引即原陣列順序）
   * @param cellSize 格子邊長
   */
  constructor(private readonly agents: ReadonlyArray<SepAgent>, private readonly cellSize: number) {
    agents.forEach((a, i) => {
      const key = this.keyOf(a);
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    });
  }

  /**
   * 第 i 隻周圍 9 格內的其他敵人索引（由小到大，與原本的兩兩比對同順序）
   *
   * @param i 敵人索引
   * @param after true = 只回傳索引大於 i 的（硬分離每對只處理一次）
   */
  neighbors(i: number, after: boolean): number[] {
    const a = this.agents[i];
    const cx = this.cellX(a), cy = this.cellY(a);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.cells.get((cx + dx + GRID_KEY_OFFSET) * 65536 + (cy + dy + GRID_KEY_OFFSET));
        if (!list) continue;
        for (const j of list) if (after ? j > i : j !== i) out.push(j);
      }
    }
    return out.sort((x, y) => x - y);
  }

  private cellX(a: SepAgent): number {
    return Math.floor(a.e.x / this.cellSize);
  }

  private cellY(a: SepAgent): number {
    return Math.floor((a.e.y + (a.fp ? a.fp.footY : 0)) / this.cellSize);
  }

  private keyOf(a: SepAgent): number {
    return (this.cellX(a) + GRID_KEY_OFFSET) * 65536 + (this.cellY(a) + GRID_KEY_OFFSET);
  }
}

/** 是否參與敵人間分離（活著、已現身） */
export function joinsEnemySeparation(e: Enemy): boolean {
  return e.active && !e.dead && !e.telegraphing;
}

/**
 * 敵人間分離（每幀一次）：先軟分離改移動方向、再硬分離推開殘留重疊。
 * 地面佔位每隻只算一次；用空間格子只比對附近的敵人（怪多時避免全部兩兩比對），鄰居順序與原本相同
 *
 * @param agents 參與分離的敵人
 * @param arena 移動區
 * @param footprintOf 地面佔位查詢；省略 = 一律用圓形判定
 */
export function separateEnemies(agents: ReadonlyArray<Enemy>, arena: Phaser.Geom.Rectangle, footprintOf?: FootprintOf): void {
  const cfg = GameConfig.enemySeparation;
  const list: SepAgent[] = agents.map((e) => ({ e, fp: footprintOf?.(e) ?? null, wall: isWallLike(e) }));
  // 最大影響距離：圓形對圓形的軟分離範圍 radiusPx；有佔位時 = 兩個最大半軸相加 × footprintSteerScale
  let maxAxis = 0, anyFootprint = false;
  for (const a of list) {
    const r = a.e.getBodyRadius();
    maxAxis = Math.max(maxAxis, a.fp ? Math.max(a.fp.rx, a.fp.ry, r) : r);
    if (a.fp) anyFootprint = true;
  }
  const steerReach = Math.max(cfg.radiusPx, anyFootprint ? 2 * maxAxis * cfg.footprintSteerScale : 0);
  const steerGrid = new SeparationGrid(list, Math.max(1, steerReach));
  list.forEach((a, i) => applySteering(a, steerGrid.neighbors(i, false).map((j) => list[j])));
  resolveOverlap(list, arena, Math.max(1, 2 * maxAxis + OVERLAP_GRID_MARGIN));
}

/**
 * 軟分離：對影響範圍內每個鄰居算遠離向量（越近推力越大，權重 = t²），
 * 與敵人目前的移動方向（先正規化）合成新方向，只改方向、保留速度大小。
 * 移動方向一定要先正規化，否則遠距追擊的速度會蓋過分離力，怪還是疊成一團。
 * 像牆的怪與站定（速度 ≈ 0）的怪不改向，交給硬分離處理。
 * 影響範圍：圓形對圓形為 radiusPx；有地面佔位（F4 新美術）時為兩個佔位橢圓相加的邊界 × footprintSteerScale
 *
 * @param agent 要調整方向的敵人
 * @param neighbors 附近的其他敵人（原陣列順序）
 */
function applySteering(agent: SepAgent, neighbors: ReadonlyArray<SepAgent>): void {
  if (agent.wall) return;
  const body = agent.e.body as Phaser.Physics.Arcade.Body;
  const spd = Math.hypot(body.velocity.x, body.velocity.y);
  if (spd < 1) return;
  const cfg = GameConfig.enemySeparation;
  let sx = 0, sy = 0;
  for (const other of neighbors) {
    const { nx, ny, d, minDist, footprint } = enemyPairSpacing(other, agent); // 鄰居 → 自己 = 遠離方向
    const R = footprint ? minDist * cfg.footprintSteerScale : cfg.radiusPx;
    if (d >= R) continue;
    const t = (R - d) / R; // 0（邊緣）~ 1（貼身）
    sx += nx * t * t; sy += ny * t * t;
  }
  if (sx === 0 && sy === 0) return;
  let fx = body.velocity.x / spd + sx * cfg.weight;
  let fy = body.velocity.y / spd + sy * cfg.weight;
  const fl = Math.hypot(fx, fy);
  if (fl < 0.001) return;
  fx /= fl; fy /= fl;
  body.velocity.x = fx * spd; body.velocity.y = fy * spd;
}

/**
 * 硬分離：兩兩距離小於最小距離時沿連線推開重疊量，迭代 iterations 次收斂（有地面佔位時改用腳底與佔位橢圓）。
 * 一方像牆時只推另一方（全額），兩方都可動時各推一半；
 * 每次推移量夾在 maxStepPx（分多幀收斂，玩家衝進怪群時怪不會瞬移），位置夾在移動區內。
 * 每輪依目前位置重建空間格子，只比對附近的敵人，處理順序與全部兩兩比對相同
 *
 * @param list 參與分離的敵人
 * @param arena 移動區
 * @param cellSize 格子邊長（≥ 最大最小距離 + 同輪推移的餘量）
 */
function resolveOverlap(list: ReadonlyArray<SepAgent>, arena: Phaser.Geom.Rectangle, cellSize: number): void {
  const cfg = GameConfig.enemySeparation;
  const place = (e: Enemy, x: number, y: number): void => {
    const r = e.getBodyRadius();
    e.setPosition(Phaser.Math.Clamp(x, arena.left + r, arena.right - r), Phaser.Math.Clamp(y, arena.top + r, arena.bottom - r));
  };
  for (let iter = 0; iter < cfg.iterations; iter++) {
    const grid = new SeparationGrid(list, cellSize);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.e.active || a.e.dead) continue;
      for (const j of grid.neighbors(i, true)) {
        const b = list[j];
        if (!b.e.active || b.e.dead) continue;
        const { nx, ny, d, minDist } = enemyPairSpacing(a, b); // a → b
        if (d >= minDist) continue;
        const overlap = Math.min(minDist - d, cfg.maxStepPx);
        if (a.wall && b.wall) continue;
        if (a.wall) {
          place(b.e, b.e.x + nx * overlap, b.e.y + ny * overlap);
        } else if (b.wall) {
          place(a.e, a.e.x - nx * overlap, a.e.y - ny * overlap);
        } else {
          const half = overlap * 0.5;
          place(a.e, a.e.x - nx * half, a.e.y - ny * half);
          place(b.e, b.e.x + nx * half, b.e.y + ny * half);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 結構（BOSS / 塔）擋住本體
// ---------------------------------------------------------------------------

/**
 * 一般怪不可穿過 BOSS / 塔本體：重疊時把怪硬推回結構外緣（全額，不分幀），結構不動。
 * 補敵人間分離對「像牆」目標的鬆弛不足（被擊飛高速時可能穿過）
 *
 * @param e 一般怪
 * @param enemies 敵人物件池
 */
export function pushEnemyOutOfStructures(e: Enemy, enemies: Phaser.Physics.Arcade.Group): void {
  if (isFixedEnemy(e) || !e.active || e.dead || e.telegraphing) return;
  for (const child of enemies.getChildren()) {
    const s = child as Enemy;
    if (!s.active || s.dead || s.telegraphing || !isStructureEnemy(s)) continue;
    const minDist = e.getBodyRadius() + s.getBodyRadius();
    const { nx, ny, d } = normalBetween(s.x, s.y, e.x, e.y); // 結構 → 怪
    if (d < minDist) e.setPosition(e.x + nx * (minDist - d), e.y + ny * (minDist - d));
  }
}

/**
 * 角色不可穿過 BOSS / 塔本體（衝刺中也擋）：重疊時把角色推回結構外緣，結構不動
 *
 * @param c 角色
 * @param enemies 敵人物件池
 */
export function pushCharacterOutOfStructures(c: Character, enemies: Phaser.Physics.Arcade.Group): void {
  const pr = GameConfig.player.radius;
  for (const child of enemies.getChildren()) {
    const e = child as Enemy;
    if (!e.active || e.dead || e.telegraphing || !isStructureEnemy(e)) continue;
    const minDist = pr + e.getBodyRadius();
    const { nx, ny, d } = normalBetween(e.x, e.y, c.x, c.y); // 結構 → 角色
    if (d < minDist) c.setPosition(c.x + nx * (minDist - d), c.y + ny * (minDist - d));
  }
}

/**
 * 衝到固定目標（BOSS / 塔 / 位移點）後，若角色與它重疊，把角色移到外緣站定，避免卡在它身上。
 * 站位方向 = 目標中心 → 角色；正中心時沿角色面向的反方向退出
 *
 * @param c 角色
 * @param e 固定目標
 * @param arena 移動區
 */
export function standCharacterOutside(c: Character, e: Enemy, arena: Phaser.Geom.Rectangle): void {
  const r = GameConfig.player.radius;
  const standoff = e.getBodyRadius() + r + 6;
  const dx = c.x - e.x, dy = c.y - e.y;
  const d = Math.hypot(dx, dy);
  if (d >= standoff) return;
  const ang = d > 0.001 ? Math.atan2(dy, dx) : c.aimAngle + Math.PI;
  c.setPosition(
    Phaser.Math.Clamp(e.x + Math.cos(ang) * standoff, arena.left + r, arena.right - r),
    Phaser.Math.Clamp(e.y + Math.sin(ang) * standoff, arena.top + r, arena.bottom - r)
  );
}

// ---------------------------------------------------------------------------
// 角色 ↔ 一般怪、守護目標 ↔ 怪
// ---------------------------------------------------------------------------

/**
 * 慢速模式真空圈的形狀與位置（角色編輯器可調）。圓盤繪製與判定共用，看到的圈就是判定範圍
 */
export interface VacuumZone {
  /** 圈中心離角色中心的水平距離（左右偏移） */
  offsetX: number;
  /** 圈中心離角色中心的垂直距離（角色腳底 + 上下偏移） */
  offsetY: number;
  /** 左右半徑 */
  radius: number;
  /** 上下壓扁比例（上下半徑 = radius × flatten） */
  flatten: number;
  /** 敵人腳底離敵人中心的垂直距離 */
  enemyFoot(e: Enemy): number;
  /** 敵人的地面佔位（F4 新美術）；有值時以佔位橢圓的腳寬碰圈，null = 以身體半徑碰圈 */
  enemyFootprint: FootprintOf;
}

/**
 * 真空圈邊界：沿 (nx, ny) 方向，敵人腳底離圈中心的最小距離。
 * 敵人的身體半徑也同樣壓扁後加上去，身體邊緣剛好停在圈上
 *
 * @param nx 圈中心 → 敵人腳底的單位向量 x
 * @param ny 圈中心 → 敵人腳底的單位向量 y
 * @param enemyRadius 敵人的身體半徑
 * @param zone 真空圈
 */
function vacuumBoundaryDistance(nx: number, ny: number, enemyRadius: number, zone: VacuumZone): number {
  const a = zone.radius + enemyRadius;
  const b = a * zone.flatten;
  return (a * b) / Math.hypot(b * nx, a * ny);
}

/**
 * 地面上「敵人腳底 → 真空圈邊界」還差多少距離（> 0 = 在圈外、≤ 0 = 已踩進圈內），以及從圈中心指向敵人腳底的方向
 *
 * @param c 角色
 * @param e 敵人
 * @param zone 真空圈
 */
export function vacuumGap(c: Character, e: Enemy, zone: VacuumZone): { gap: number; nx: number; ny: number } {
  const cx = c.x + zone.offsetX, cy = c.y + zone.offsetY;
  const fp = zone.enemyFootprint(e);
  if (fp) {
    // F4 新美術：圈 + 佔位橢圓相加的邊界（腳尖剛好碰到圈線），與敵人間碰撞同一份佔位資料
    const { nx, ny, d } = normalBetween(cx, cy, e.x, e.y + fp.footY);
    const a = zone.radius + fp.rx, b = zone.radius * zone.flatten + fp.ry;
    return { gap: d - (a * b) / Math.hypot(b * nx, a * ny), nx, ny };
  }
  const { nx, ny, d } = normalBetween(cx, cy, e.x, e.y + zone.enemyFoot(e));
  return { gap: d - vacuumBoundaryDistance(nx, ny, e.getBodyRadius(), zone), nx, ny };
}

/**
 * 角色與一般怪不重疊：把重疊的怪推離角色（全額），角色位置不動、保留玩家走位手感。
 * 傳入 vacuum（慢速模式）時改用真空圈：以腳底為準，把踩進圈內的怪沿「圈中心 → 怪腳底」推回圈邊（見 vacuumGap）。
 * 固定目標跳過（各有站外緣 / 穿越邏輯）；呼叫端在衝刺中不套用，保留衝刺穿怪的打擊感
 *
 * @param c 角色
 * @param enemies 敵人物件池
 * @param arena 移動區
 * @param vacuum 真空圈；null = 不用真空圈（快速模式），以身體半徑分離
 */
export function pushEnemiesAwayFromCharacter(c: Character, enemies: Phaser.Physics.Arcade.Group, arena: Phaser.Geom.Rectangle, vacuum: VacuumZone | null): void {
  const pr = GameConfig.player.radius;
  for (const child of enemies.getChildren()) {
    const e = child as Enemy;
    if (!e.active || e.dead || isFixedEnemy(e)) continue;
    const er = e.getBodyRadius();
    let nx: number, ny: number, push: number;
    if (vacuum) {
      const g = vacuumGap(c, e, vacuum);
      if (g.gap >= 0) continue;
      nx = g.nx; ny = g.ny; push = -g.gap;
    } else {
      const n = normalBetween(c.x, c.y, e.x, e.y); // 角色 → 怪
      const minDist = pr + er;
      if (n.d >= minDist) continue;
      nx = n.nx; ny = n.ny; push = minDist - n.d;
    }
    e.setPosition(
      Phaser.Math.Clamp(e.x + nx * push, arena.left + er, arena.right - er),
      Phaser.Math.Clamp(e.y + ny * push, arena.top + er, arena.bottom - er)
    );
  }
}

/**
 * 守護事件：把怪推回守護目標（NPC）外緣，讓怪圍在外圈攻擊、不疊在目標身上；玩家可穿越。
 * 推到外緣時距離仍在接觸攻擊範圍內，怪照常能攻擊 NPC
 *
 * @param npc 守護目標
 * @param enemies 敵人物件池
 * @param arena 移動區
 */
export function pushEnemiesOutOfNpc(npc: Enemy, enemies: Phaser.Physics.Arcade.Group, arena: Phaser.Geom.Rectangle): void {
  if (!npc.active || npc.dead) return;
  const margin = 20;
  for (const child of enemies.getChildren()) {
    const e = child as Enemy;
    if (!e.active || e.dead || e === npc || isFixedEnemy(e)) continue;
    const minDist = e.getBodyRadius() + npc.getBodyRadius();
    const { nx, ny, d } = normalBetween(npc.x, npc.y, e.x, e.y); // NPC → 怪
    if (d >= minDist) continue;
    e.setPosition(
      Phaser.Math.Clamp(e.x + nx * (minDist - d), arena.left + margin, arena.right - margin),
      Phaser.Math.Clamp(e.y + ny * (minDist - d), arena.top + margin, arena.bottom - margin)
    );
  }
}

// ---------------------------------------------------------------------------
// 可推動物件（木箱 / 桶）
// ---------------------------------------------------------------------------

/**
 * 把與 (x, y)、半徑 radius 重疊的物件推出重疊，並沿推出方向加上 pushSpeed 的速度
 */
function pushBreakablesFrom(x: number, y: number, radius: number, breakables: Phaser.GameObjects.Group, pushSpeed: number): void {
  for (const child of breakables.getChildren()) {
    const bk = child as Breakable;
    if (!bk.active || bk.dead) continue;
    const minDist = radius + bk.getBodyRadius();
    const { nx, ny, d } = normalBetween(x, y, bk.x, bk.y); // 推的一方 → 物件
    if (d >= minDist) continue;
    bk.setPosition(bk.x + nx * (minDist - d), bk.y + ny * (minDist - d));
    bk.vx += nx * pushSpeed; bk.vy += ny * pushSpeed; // 速度累加，updateBreakableMotion 會摩擦衰減
  }
}

/**
 * 一般怪碰到木箱 / 桶時把物件推開（不擋怪、不改怪的 AI），固定目標不推
 *
 * @param e 敵人
 * @param breakables 可打破物件池
 */
export function pushBreakablesFromEnemy(e: Enemy, breakables: Phaser.GameObjects.Group): void {
  if (isFixedEnemy(e) || !e.active || e.dead) return;
  pushBreakablesFrom(e.x, e.y, e.getBodyRadius(), breakables, Math.min(GameConfig.breakable.push.maxPushSpeed, GameConfig.slow.moveSpeed));
}

/**
 * 角色碰到木箱 / 桶時把物件推開（可以把爆炸桶推進怪群再打破）；呼叫端在衝刺中不套用（衝刺撞到直接打破）
 *
 * @param c 角色
 * @param breakables 可打破物件池
 */
export function pushBreakablesFromCharacter(c: Character, breakables: Phaser.GameObjects.Group): void {
  pushBreakablesFrom(c.x, c.y, GameConfig.player.radius, breakables, GameConfig.breakable.push.maxPushSpeed);
}

/**
 * 每幀更新可推動物件：速度位移 + 推到牆停 + 摩擦衰減，再處理物件之間的重疊（各推一半）。
 * 另外回收「已死卻沒有進入引爆流程」的物件，避免它們卡在場上打不到
 *
 * @param breakables 可打破物件池
 * @param arena 移動區
 * @param delta 本幀毫秒
 */
export function updateBreakableMotion(breakables: Phaser.GameObjects.Group, arena: Phaser.Geom.Rectangle, delta: number): void {
  const dt = delta / 1000;
  const children = breakables.getChildren() as Breakable[];
  for (const bk of children) {
    if (bk.active && bk.dead && !bk.fusing) bk.despawn();
  }
  const friction = Math.max(0, 1 - GameConfig.breakable.push.friction * dt);
  for (const bk of children) {
    if (!bk.active || bk.dead || (bk.vx === 0 && bk.vy === 0)) continue;
    const r = bk.getBodyRadius();
    let nx = bk.x + bk.vx * dt, ny = bk.y + bk.vy * dt;
    if (nx < arena.left + r) { nx = arena.left + r; bk.vx = 0; }
    else if (nx > arena.right - r) { nx = arena.right - r; bk.vx = 0; }
    if (ny < arena.top + r) { ny = arena.top + r; bk.vy = 0; }
    else if (ny > arena.bottom - r) { ny = arena.bottom - r; bk.vy = 0; }
    bk.setPosition(nx, ny);
    bk.vx *= friction; bk.vy *= friction;
    if (Math.abs(bk.vx) < 3 && Math.abs(bk.vy) < 3) { bk.vx = 0; bk.vy = 0; }
  }
  const place = (bk: Breakable, x: number, y: number): void => {
    const r = bk.getBodyRadius();
    bk.setPosition(Phaser.Math.Clamp(x, arena.left + r, arena.right - r), Phaser.Math.Clamp(y, arena.top + r, arena.bottom - r));
  };
  for (let i = 0; i < children.length; i++) {
    const a = children[i];
    if (!a.active || a.dead) continue;
    for (let j = i + 1; j < children.length; j++) {
      const b = children[j];
      if (!b.active || b.dead) continue;
      const minDist = a.getBodyRadius() + b.getBodyRadius();
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= minDist || d <= 0.001) continue;
      const push = (minDist - d) / 2;
      place(a, a.x - (dx / d) * push, a.y - (dy / d) * push);
      place(b, b.x + (dx / d) * push, b.y + (dy / d) * push);
    }
  }
}
