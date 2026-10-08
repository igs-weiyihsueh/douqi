import Phaser from 'phaser';
import type { Breakable } from '../objects/Breakable';
import type { Character } from '../objects/Character';
import type { BossSkillKind, Enemy, EnemyType } from '../objects/Enemy';
import { Item } from '../objects/Item';
import type { BossController } from './BossController';
import type { EventController, EventKind } from './EventController';
import type { SkillController } from './SkillController';
import type { TargetingController } from './TargetingController';

/** 除錯可直接施放的招式 */
type DebugSkill = 'A' | 'B' | 'C' | 'E' | 'T';

/** 波次狀態（除錯直接切換用） */
type DebugWaveState = 'boss' | 'event';

/** 波次進度快照 */
interface WaveSnapshot {
  wave: number;
  waveKilled: number;
  waveQuota: number;
  waveSpawned: number;
  waveState: string;
}

/**
 * GameDebugApi 需要場景提供的能力。由 GameScene 建立並傳入。
 */
export interface GameDebugHost {
  readonly scene: Phaser.Scene;
  characters(): ReadonlyArray<Character>;
  player(): Character;
  enemies(): Phaser.Physics.Arcade.Group;
  items(): Phaser.Physics.Arcade.Group;
  breakables(): Phaser.GameObjects.Group;
  arena(): Phaser.Geom.Rectangle;
  boss(): BossController;
  skills(): SkillController;
  events(): EventController;
  targeting(): TargetingController;
  isGameOver(): boolean;
  isTimeStopped(): boolean;
  /** 目前的敵人同時存活上限 */
  maxAlive(): number;
  /** 目前存活中的視覺特效數 */
  activeFxCount(): number;
  attackDamage(): number;
  /** P1 普攻命中次數 */
  p1AttackHits(): number;
  waveSnapshot(): WaveSnapshot;
  setWaveState(state: DebugWaveState): void;
  emitStats(): void;
  triggerGameOver(): void;
  applyHeal(c: Character): void;
  addBot(): void;
  dropItemAt(x: number, y: number, time: number): void;
  damageEnemy(actor: Character, enemy: Enemy, damage: number, knockback: number, time: number): void;
  teamKills(): number;
  /** 掛上一般敵人的攻擊回呼 */
  wireEnemyCallbacks(enemy: Enemy): void;
}

/** 壓力測試生怪：離 P1 的最小距離與隨機範圍、離移動區邊緣的距離 */
const STRESS_MIN_RADIUS = 40;
const STRESS_RADIUS_RANGE = 160;
const STRESS_EDGE_MARGIN = 20;
/** 指定距離生怪時離移動區邊緣的距離 */
const PROBE_EDGE_MARGIN = 30;
/** 同幀擊殺測試：目標剩餘血量與兩次命中的傷害（都會致命） */
const SAME_FRAME_KILL_HP = 5;
const SAME_FRAME_KILL_DAMAGE = 9999;

/**
 * 除錯 / 自動化測試入口（不影響正常玩法）：`getScene('GameScene').debug.X()`。
 * 提供狀態查詢（state / eventState / lockInfo…）與直接觸發（招式、BOSS、事件、生怪、掉道具…）
 */
export class GameDebugApi {
  constructor(private readonly host: GameDebugHost) {}

  private get now(): number {
    return this.host.scene.time.now;
  }

  /** 目前關鍵狀態 */
  state(): Record<string, unknown> {
    const h = this.host;
    const p = h.player();
    const w = h.waveSnapshot();
    return {
      gameOver: h.isGameOver(),
      timeStopped: h.isTimeStopped(),
      p1SkillLocked: p ? p.isSkillLocked(this.now) : null,
      p1Invuln: p ? p.isInvulnerable(this.now) : null,
      enemyCount: h.enemies() ? h.enemies().countActive(true) : null,
      maxAlive: h.maxAlive(),
      activeFxCount: h.activeFxCount(),
      attackDamage: Math.round(h.attackDamage()),
      p1AttackHits: h.p1AttackHits(),
      wave: w.wave,
      waveKilled: w.waveKilled,
      waveQuota: w.waveQuota,
      waveSpawned: w.waveSpawned,
      waveState: w.waveState,
      combo: p.spirit,
      energy: p.energy,
      p1Empowered: p.isEmpowered(this.now)
    };
  }

  /** 事件狀態 */
  eventState(): Record<string, unknown> {
    return { waveState: this.host.waveSnapshot().waveState, ...this.host.events().debugState() };
  }

  /** P1 位置（取整） */
  p1Pos(): { x: number; y: number } {
    const p = this.host.player();
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  /** 立即讓所有角色陣亡並結算 */
  forceGameOver(): void {
    if (this.host.isGameOver()) return;
    for (const c of this.host.characters()) {
      c.hp = 0;
      if (c.alive) c.die();
    }
    this.host.triggerGameOver();
  }

  /** 對 P1 施放指定招式 */
  triggerSkill(skill: DebugSkill): void {
    const p = this.host.player();
    if (this.host.isGameOver() || !p.alive) return;
    this.host.skills().cast(p, skill, this.now);
  }

  /** 對 P1 補血，回傳補血前後的血量 */
  healP1(): { before: number; after: number } {
    const p = this.host.player();
    const before = p.hp;
    this.host.applyHeal(p);
    return { before, after: p.hp };
  }

  /** 直接進入 BOSS 戰 */
  spawnBoss(): void {
    this.host.setWaveState('boss');
    this.host.boss().spawn();
  }

  /** 生成一隻限時亂入 BOSS（場上已有 BOSS 時不生） */
  spawnIntruderBoss(): void {
    const boss = this.host.boss();
    if (!boss.current) boss.spawn(true);
  }

  /** BOSS 立即施放指定招式（需先有 BOSS 在場） */
  bossSkill(kind: BossSkillKind): void {
    this.host.boss().debugCast(kind);
  }

  /** 暫停 / 恢復 BOSS 自動輪替招式（隔離單招測試用） */
  pauseBossSkills(v: boolean): void {
    this.host.boss().debugPauseSkills(v);
  }

  /** 直接觸發指定事件（塔 / 守護 / 佔領） */
  triggerEvent(kind: EventKind): void {
    this.host.setWaveState('event');
    this.host.events().start(kind);
    this.host.emitStats();
  }

  /** 可破壞物件狀態（數量、桶子數、各自位置與種類） */
  breakables(): Record<string, unknown> {
    const list = this.host.breakables().getChildren().filter((c) => (c as Breakable).active).map((c) => {
      const bk = c as Breakable;
      return { x: Math.round(bk.x), y: Math.round(bk.y), hp: bk.hp, kind: bk.kind };
    });
    return { count: list.length, barrels: list.filter((b) => b.kind === 'barrel').length, list };
  }

  /**
   * 在 P1 位置偏移 (dx, dy) 處生一個可破壞物件
   *
   * @returns 物件在物件池中的索引；池滿時為 -1
   */
  spawnBreakableAt(dx: number, dy: number, kind: 'crate' | 'barrel' = 'crate'): number {
    const p = this.host.player();
    const x = p.x + dx, y = p.y + dy;
    const pool = this.host.breakables();
    const bk = pool.get(x, y) as Breakable | null;
    if (!bk) return -1;
    bk.spawnBreakable(x, y, kind);
    return pool.getChildren().indexOf(bk);
  }

  /**
   * 壓力測試：在 P1 周圍密集生成 n 隻已實體化（可傷）的一般怪
   *
   * @returns 實際生成數（物件池滿時提早停止）
   */
  stressSpawn(n: number): number {
    const p = this.host.player();
    const a = this.host.arena();
    let made = 0;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = STRESS_MIN_RADIUS + Math.random() * STRESS_RADIUS_RANGE;
      const x = Phaser.Math.Clamp(p.x + Math.cos(ang) * rad, a.left + STRESS_EDGE_MARGIN, a.right - STRESS_EDGE_MARGIN);
      const y = Phaser.Math.Clamp(p.y + Math.sin(ang) * rad, a.top + STRESS_EDGE_MARGIN, a.bottom - STRESS_EDGE_MARGIN);
      if (!this.spawnMaterialized(x, y, 'normal')) break;
      made++;
    }
    return made;
  }

  /** 在指定位置掉一個道具 */
  dropItem(x: number, y: number): void {
    this.host.dropItemAt(x, y, this.now);
  }

  /** 清空所有敵人，在 P1 右方 distFromP1 處生一隻已實體化的一般怪 */
  spawnProbeAt(distFromP1: number): void {
    for (const ch of this.host.enemies().getChildren()) {
      const e = ch as Enemy;
      if (e.active) e.kill();
    }
    this.spawnType('normal', distFromP1);
  }

  /** 在 P1 右方 distFromP1 處生一隻指定種類、已實體化的敵人 */
  spawnType(type: EnemyType, distFromP1: number): void {
    const p = this.host.player();
    const a = this.host.arena();
    this.spawnMaterialized(Phaser.Math.Clamp(p.x + distFromP1, a.left + PROBE_EDGE_MARGIN, a.right - PROBE_EDGE_MARGIN), p.y, type);
  }

  /** 第一隻存活敵人的 AI 狀態與到 P1 的距離 */
  probeState(): Record<string, unknown> {
    const p = this.host.player();
    for (const ch of this.host.enemies().getChildren()) {
      const e = ch as Enemy;
      if (e.active && !e.dead) {
        return { aiState: e.getAiState(), distToP1: Math.round(Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y)), ex: Math.round(e.x) };
      }
    }
    return { aiState: 'none' };
  }

  /** 模擬滑鼠指向 (x, y)：設定 P1 面向並標記瞄準活躍（測鎖定評分） */
  aimToward(x: number, y: number): void {
    const p = this.host.player();
    p.aimAngle = Phaser.Math.Angle.Between(p.x, p.y, x, y);
    this.host.targeting().markPointerMoved(this.now);
  }

  /** 加入一個 BOT（同 B 鍵） */
  addBot(): void {
    this.host.addBot();
  }

  /** 在 BOT(index) 附近掉一個道具，回報 BOT 是否立刻選它當目標 */
  botWouldGrabItem(index: number, offset = 40): boolean {
    const bot = this.host.characters()[index];
    if (!bot) return false;
    this.host.dropItemAt(bot.x + offset, bot.y + offset, this.now);
    return this.host.targeting().pickBotTarget(bot) instanceof Item;
  }

  /**
   * 擊殺原子性測試：兩個角色同幀各對同一隻低血量敵人打一次致命傷，
   * 回報擊殺數、道具數的變化與敵人的 dead 旗標（應只 +1 擊殺、最多掉 1 個道具）
   */
  simulSameFrameKill(): Record<string, unknown> {
    const h = this.host;
    while (h.characters().length < 2) h.addBot();
    const [a, b] = h.characters();
    let target: Enemy | null = null;
    for (const ch of h.enemies().getChildren()) {
      const e = ch as Enemy;
      if (e.active && e.isVulnerable() && !e.dead) { target = e; break; }
    }
    if (!target) return { error: 'no enemy' };
    target.hp = SAME_FRAME_KILL_HP;
    const killsBefore = h.teamKills();
    const itemsBefore = h.items().countActive(true);
    h.damageEnemy(a, target, SAME_FRAME_KILL_DAMAGE, 0, this.now);
    h.damageEnemy(b, target, SAME_FRAME_KILL_DAMAGE, 0, this.now);
    return {
      killsBefore,
      killsAfter: h.teamKills(),
      killDelta: h.teamKills() - killsBefore,
      itemsBefore,
      itemsAfter: h.items().countActive(true),
      itemDelta: h.items().countActive(true) - itemsBefore,
      enemyDead: target.dead
    };
  }

  /** 各角色的鎖定與位置，以及場上道具狀態（測互搶與多色點標記） */
  charsLock(): Record<string, unknown> {
    const pool = this.host.items();
    const items = pool
      ? pool.getChildren().map((ch) => {
          const it = ch as Item;
          return { skill: it.skill, taken: it.taken, active: it.active, x: Math.round(it.x), y: Math.round(it.y) };
        })
      : [];
    return {
      chars: this.host.characters().map((c) => ({
        index: c.index,
        alive: c.alive,
        x: Math.round(c.x),
        y: Math.round(c.y),
        lockIsItem: c.lockedTarget instanceof Item,
        hasLock: !!c.lockedTarget,
        dashToItem: c.dashToItem,
        spirit: c.spirit
      })),
      items,
      itemsAlive: pool ? pool.countActive(true) : 0
    };
  }

  /** P1 目前的鎖定狀態（是否鎖到道具）與衝刺狀態 */
  lockInfo(): Record<string, unknown> {
    const targeting = this.host.targeting();
    const t = targeting.lockedTarget;
    const pool = this.host.items();
    const p = this.host.player();
    return {
      hasLock: !!t,
      lockIsItem: targeting.isItem(t),
      lockX: t ? Math.round(t.x) : null,
      lockY: t ? Math.round(t.y) : null,
      itemsAlive: pool ? pool.countActive(true) : null,
      p1Dashing: p ? p.isDashing : null,
      p1DashToItem: p ? p.dashToItem : null,
      p1x: p ? Math.round(p.x) : null,
      p1y: p ? Math.round(p.y) : null
    };
  }

  /**
   * 從敵人池取一隻、掛上攻擊回呼並立即實體化（跳過登場預告），可馬上被攻擊
   *
   * @returns 敵人池已滿時為 false
   */
  private spawnMaterialized(x: number, y: number, type: EnemyType): boolean {
    const e = this.host.enemies().get(x, y) as Enemy | null;
    if (!e) return false;
    this.host.wireEnemyCallbacks(e);
    e.spawn(x, y, this.now, type, 1);
    (e as unknown as { telegraphing: boolean }).telegraphing = false;
    (e.body as Phaser.Physics.Arcade.Body).enable = true;
    e.setAlpha(1);
    return true;
  }
}
