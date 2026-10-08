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

/** 是否參與敵人間分離（活著、已現身） */
export function joinsEnemySeparation(e: Enemy): boolean {
  return e.active && !e.dead && !e.telegraphing;
}

/**
 * 軟分離：對 radiusPx 內每個鄰居算遠離向量（越近推力越大，權重 = t²），
 * 與敵人目前的移動方向（先正規化）合成新方向，只改方向、保留速度大小。
 * 移動方向一定要先正規化，否則遠距追擊的速度會蓋過分離力，怪還是疊成一團。
 * 像牆的怪與站定（速度 ≈ 0）的怪不改向，交給硬分離處理
 *
 * @param enemy 要調整方向的敵人
 * @param neighbors 參與分離的所有敵人
 */
export function applyEnemySeparationSteering(enemy: Enemy, neighbors: ReadonlyArray<Enemy>): void {
  if (isWallLike(enemy)) return;
  const body = enemy.body as Phaser.Physics.Arcade.Body;
  const spd = Math.hypot(body.velocity.x, body.velocity.y);
  if (spd < 1) return;
  const cfg = GameConfig.enemySeparation;
  const R = cfg.radiusPx;
  let sx = 0, sy = 0;
  for (const other of neighbors) {
    if (other === enemy) continue;
    const { nx, ny, d } = normalBetween(other.x, other.y, enemy.x, enemy.y); // 鄰居 → 自己 = 遠離方向
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
 * 硬分離：兩兩距離小於半徑和時沿連線推開重疊量，迭代 iterations 次收斂。
 * 一方像牆時只推另一方（全額），兩方都可動時各推一半；
 * 每次推移量夾在 maxStepPx（分多幀收斂，玩家衝進怪群時怪不會瞬移），位置夾在移動區內。
 * 目前是 O(n²) × iterations，單人場上約 35 隻可接受；多人上百隻時需改空間網格
 *
 * @param agents 參與分離的敵人
 * @param arena 移動區
 */
export function resolveEnemyOverlap(agents: ReadonlyArray<Enemy>, arena: Phaser.Geom.Rectangle): void {
  const cfg = GameConfig.enemySeparation;
  const place = (e: Enemy, x: number, y: number): void => {
    const r = e.getBodyRadius();
    e.setPosition(Phaser.Math.Clamp(x, arena.left + r, arena.right - r), Phaser.Math.Clamp(y, arena.top + r, arena.bottom - r));
  };
  for (let iter = 0; iter < cfg.iterations; iter++) {
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (!a.active || a.dead) continue;
      const aWall = isWallLike(a);
      for (let j = i + 1; j < agents.length; j++) {
        const b = agents[j];
        if (!b.active || b.dead) continue;
        const minDist = a.getBodyRadius() + b.getBodyRadius();
        const { nx, ny, d } = normalBetween(a.x, a.y, b.x, b.y); // a → b
        if (d >= minDist) continue;
        const overlap = Math.min(minDist - d, cfg.maxStepPx);
        const bWall = isWallLike(b);
        if (aWall && bWall) continue;
        if (aWall) {
          place(b, b.x + nx * overlap, b.y + ny * overlap);
        } else if (bWall) {
          place(a, a.x - nx * overlap, a.y - ny * overlap);
        } else {
          const half = overlap * 0.5;
          place(a, a.x - nx * half, a.y - ny * half);
          place(b, b.x + nx * half, b.y + ny * half);
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
 * 角色與一般怪不重疊：把重疊的怪推離角色（全額），角色位置不動、保留玩家走位手感。
 * 固定目標跳過（各有站外緣 / 穿越邏輯）；呼叫端在衝刺中不套用，保留衝刺穿怪的打擊感
 *
 * @param c 角色
 * @param enemies 敵人物件池
 * @param arena 移動區
 */
export function pushEnemiesAwayFromCharacter(c: Character, enemies: Phaser.Physics.Arcade.Group, arena: Phaser.Geom.Rectangle): void {
  const pr = GameConfig.player.radius;
  for (const child of enemies.getChildren()) {
    const e = child as Enemy;
    if (!e.active || e.dead || isFixedEnemy(e)) continue;
    const er = e.getBodyRadius();
    const minDist = pr + er;
    const { nx, ny, d } = normalBetween(c.x, c.y, e.x, e.y); // 角色 → 怪
    if (d >= minDist) continue;
    e.setPosition(
      Phaser.Math.Clamp(e.x + nx * (minDist - d), arena.left + er, arena.right - er),
      Phaser.Math.Clamp(e.y + ny * (minDist - d), arena.top + er, arena.bottom - er)
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
