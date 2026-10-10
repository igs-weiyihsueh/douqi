import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { Enemy, EnemyType } from '../objects/Enemy';
import { isRegularEnemy } from '../systems/enemyKinds';
import { shouldSpawnMore, updateRefillLatch, type WaveSpawnState } from '../systems/waveMath';
import type { MonsterKind, MonsterPhase } from '../systems/stageMonsters';

/** 本波擊殺進度 */
export interface WaveKillProgress {
  killed: number;
  quota: number;
}

/**
 * SpawnController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface SpawnHost {
  /** 擁有者場景（時間用） */
  readonly scene: Phaser.Scene;
  /** 敵人物件池 */
  enemies(): Phaser.Physics.Arcade.Group;
  /** 全部角色（近身組輪派座位、場上組避開玩家） */
  characters(): ReadonlyArray<Character>;
  /** 目前的移動區 */
  arena(): Phaser.Geom.Rectangle;
  /** 目前波次（決定解鎖的敵種） */
  currentWave(): number;
  /** 本局存活時間（毫秒，生怪間隔隨時間縮短） */
  survivalMs(): number;
  waveProgress(): WaveKillProgress;
  /** 目前關卡怪物配置的階段（null = 未使用關卡怪物配置，沿用全域出怪參數） */
  monsterPhase(): MonsterPhase | null;
  /** 一般怪生成後計入本波已生成數 */
  onWaveEnemySpawned(): void;
  /** 場上同時存活上限（依存活人數縮放） */
  maxAlive(): number;
  /** 依存活人數的怪量縮放（0 ~ 1） */
  aliveScale(): number;
  /** 離 (x, y) 最近的存活角色座位；沒有則 -1 */
  nearestSeat(x: number, y: number): number;
  /** 掛上一般敵人的攻擊回呼 */
  wireEnemyCallbacks(enemy: Enemy): void;
  /** 每出一次隊形後（寶箱怪在此擲骰） */
  onFormationSpawned(time: number): void;
}

/** 場上組每叢至少幾隻 */
const FIELD_BATCH_MIN = 3;
/** 場上組生成點離移動區邊緣的距離、找生成點的嘗試次數與額外邊距 */
const FIELD_EDGE_MARGIN = 20;
const FIELD_POINT_TRIES = 16;
const FIELD_POINT_EXTRA_INSET = 40;
/** 畫面內可出生範圍的最小寬高（小於此值時退回整個移動區） */
const FIELD_VIEW_MIN_SIZE = 120;

/**
 * 波次生怪（波次流程本身——開波、清場、過關——由場景管理）：
 * - 補生（drip）：場上已實體化 + 預告中的一般怪跌破 spawnThresholdRatio × 上限時開閘、補到上限才關（latch 防抖）；
 *   生產總量（已擊殺 + 場上 + 預告中）達本波配額就停止，回報場景改為清場
 * - 每次補生出一次隊形：依本波近身組占比決定生「近身組」（在輪派的存活玩家身旁環狀、近戰為主、綁定該玩家）
 *   或「場上組」（離所有玩家夠遠的一叢、含遠程、綁就近的角色）；每隻生成前都做封頂檢查，絕不超生
 * - 敵種依 spawnWeight 在本波已解鎖的種類中抽選；另提供不計配額的召喚怪（BOSS 招式、事件用）
 */
export class SpawnController {
  private accumulator = 0;
  private interval: number = GameConfig.spawn.initialIntervalMs;
  /** 補生閘門（跌破門檻開、補到上限關，跨幀保持） */
  private refilling = false;
  /** 本波已生的近身組 / 場上組隻數（讓比例收斂到 nearShare） */
  private nearSpawned = 0;
  private fieldSpawned = 0;
  /** 近身組輪派座位的游標（多人平均分配） */
  private nearSeatCursor = 0;
  /** 本波已出了幾次隊形 */
  private formations = 0;

  constructor(private readonly host: SpawnHost) {}

  /** 本波已出的隊形次數（寶箱怪第二次隊形起才可能出現） */
  get formationCount(): number {
    return this.formations;
  }

  /**
   * 每幀（波次生怪中）：更新補生閘門；生產總量達配額回傳 true（場景改為清場），否則到了生怪間隔且閘門開就補一次隊形
   *
   * @param delta 本幀毫秒
   * @returns 本波生產是否已結束
   */
  tick(delta: number): boolean {
    const cfg = GameConfig.spawn;
    const phase = this.host.monsterPhase();
    this.interval = phase
      ? phase.intervalMs
      : Math.max(cfg.minIntervalMs, cfg.initialIntervalMs - (this.host.survivalMs() / 1000) * cfg.intervalDecayPerSec);
    const maxAlive = this.host.maxAlive();
    const alive = this.countAlive();
    const pending = this.countPending();
    const occupancy = alive + pending;
    const spawnThreshold = Math.round(maxAlive * GameConfig.wave.drip.spawnThresholdRatio);
    this.refilling = updateRefillLatch(occupancy, maxAlive, spawnThreshold, this.refilling);
    const progress = this.host.waveProgress();
    const ws: WaveSpawnState = {
      progress: progress.killed,
      targetProgress: progress.quota,
      alive, pending, maxAlive, spawnThreshold,
      refilling: this.refilling
    };
    if (progress.killed + occupancy >= progress.quota) return true;
    this.accumulator += delta;
    if (this.accumulator < this.interval) return false;
    if (!shouldSpawnMore(ws)) return false;
    this.accumulator = 0;
    this.spawnFormation();
    return false;
  }

  /** 新的一波開始：閘門打開、分配與隊形計數歸零，立刻補第一批（不冷場） */
  startWave(): void {
    this.refilling = true;
    this.nearSpawned = 0;
    this.fieldSpawned = 0;
    this.formations = 0;
    this.accumulator = 0;
    if (!this.isBlocked()) this.spawnFormation();
  }

  /** 生怪計時歸零（進入新區域時） */
  resetTimer(): void {
    this.accumulator = 0;
  }

  /** 隊形計數歸零（新的小關卡開始時） */
  resetFormationCount(): void {
    this.formations = 0;
  }

  /** 出一次隊形：依近身組占比決定近身組或場上組，之後讓寶箱怪擲骰 */
  spawnFormation(): void {
    const time = this.host.scene.time.now;
    this.formations++;
    const total = this.nearSpawned + this.fieldSpawned;
    const nearRatio = total > 0 ? this.nearSpawned / total : 0;
    const nearShare = this.host.monsterPhase()?.nearShare ?? GameConfig.spawnAlloc.nearShare;
    if (nearRatio < nearShare) this.spawnNearBatch(time);
    else this.spawnFieldBatch(time);
    this.host.onFormationSpawned(time);
  }

  /**
   * 召喚怪（BOSS 招式、事件用）：不計本波配額，綁定最近的角色
   *
   * @param forceType 指定敵種（省略則依權重抽）
   * @param leashImmune true = 不受活動範圍限制
   * @param forceChase true = 生成就直接衝向目標（無視警戒半徑）
   */
  spawnSummonAt(x: number, y: number, time: number, forceType?: EnemyType, leashImmune = false, forceChase = false): void {
    const type = forceType ?? this.pickEnemyType();
    const enemy = this.host.enemies().get(x, y) as Enemy | null;
    if (!enemy) return;
    this.host.wireEnemyCallbacks(enemy);
    enemy.spawn(x, y, time, type);
    enemy.targetSeat = this.host.nearestSeat(x, y); // 守護事件中會被改成攻擊守護目標
    if (leashImmune) { enemy.leashRadius = Infinity; enemy.leashTravelDist = Infinity; }
    if (forceChase) enemy.forceChase = true;
  }

  /**
   * 近身組：在輪派到的存活玩家身旁 nearRingRadius 的環上生 nearPerPlayerMin ~ Max 隻（近戰為主），綁定該玩家
   */
  private spawnNearBatch(time: number): void {
    const alloc = GameConfig.spawnAlloc;
    const characters = this.host.characters();
    const seats: number[] = [];
    for (let i = 0; i < characters.length; i++) if (characters[i]?.alive) seats.push(i);
    if (seats.length === 0) return;
    const seat = seats[this.nearSeatCursor % seats.length];
    this.nearSeatCursor++;
    const focus = characters[seat];
    const phase = this.host.monsterPhase();
    const n = phase
      ? Phaser.Math.Between(phase.nearBatch[0], phase.nearBatch[1])
      : Phaser.Math.Between(alloc.nearPerPlayerMin, alloc.nearPerPlayerMax);
    const start = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      if (this.isBlocked()) return;
      const a = start + (i / n) * Math.PI * 2;
      this.spawnEnemyAt(focus.x + Math.cos(a) * alloc.nearRingRadius, focus.y + Math.sin(a) * alloc.nearRingRadius, time, alloc.nearTypes as EnemyType[], seat);
      this.nearSpawned++;
    }
  }

  /**
   * 場上組：在離所有存活玩家至少 fieldMinDistFromPlayer 的點散佈一叢（數量依存活人數縮放、含遠程），綁就近的角色
   */
  private spawnFieldBatch(time: number): void {
    const cfg = GameConfig.formation.scatter;
    const alloc = GameConfig.spawnAlloc;
    const a = this.host.arena();
    const phase = this.host.monsterPhase();
    const count = phase ? this.profileFieldBatch(phase) : Math.max(FIELD_BATCH_MIN, Math.round(Phaser.Math.Between(cfg.minCount, cfg.maxCount) * this.host.aliveScale()));
    const { x: cx, y: cy } = this.randomFieldPoint(alloc.fieldMinDistFromPlayer);
    // 每隻的散佈位置夾在：移動區（邊距 FIELD_EDGE_MARGIN）；畫面內出生時再與畫面可出生範圍取交集
    const edge = new Phaser.Geom.Rectangle(a.left + FIELD_EDGE_MARGIN, a.top + FIELD_EDGE_MARGIN, a.width - FIELD_EDGE_MARGIN * 2, a.height - FIELD_EDGE_MARGIN * 2);
    const clampTo = this.limitToView(edge);
    const pool = alloc.fieldTypes.length > 0 ? (alloc.fieldTypes as EnemyType[]) : undefined; // undefined = 全部解鎖的敵種
    for (let i = 0; i < count; i++) {
      if (this.isBlocked()) return;
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * cfg.areaRadius;
      const ex = Phaser.Math.Clamp(cx + Math.cos(ang) * rad, clampTo.left, clampTo.right);
      const ey = Phaser.Math.Clamp(cy + Math.sin(ang) * rad, clampTo.top, clampTo.bottom);
      this.spawnEnemyAt(ex, ey, time, pool, -1);
      this.fieldSpawned++;
    }
  }

  /**
   * 離所有存活玩家至少 minDist 的隨機點（移動區內縮範圍；畫面內出生時限在畫面可出生範圍內）；
   * 找不到時退回嘗試中最遠的點
   */
  private randomFieldPoint(minDist: number): { x: number; y: number } {
    const a = this.host.arena();
    const inset = GameConfig.spawn.edgeInset + FIELD_POINT_EXTRA_INSET;
    const b = this.limitToView(new Phaser.Geom.Rectangle(a.left + inset, a.top + inset, a.width - inset * 2, a.height - inset * 2));
    let bx = b.centerX, by = b.centerY, bestMin = -1;
    for (let attempt = 0; attempt < FIELD_POINT_TRIES; attempt++) {
      const x = Phaser.Math.Between(b.left, b.right);
      const y = Phaser.Math.Between(b.top, b.bottom);
      let nearest = Infinity;
      for (const c of this.host.characters()) {
        if (!c.alive) continue;
        nearest = Math.min(nearest, Phaser.Math.Distance.Between(x, y, c.x, c.y));
      }
      if (nearest >= minDist) return { x, y };
      if (nearest > bestMin) { bestMin = nearest; bx = x; by = y; }
    }
    return { x: bx, y: by };
  }

  /**
   * 場上組出生範圍限制在畫面內（config.spawnAlloc.fieldSpawnInView）：回傳 area 與鏡頭畫面（內縮 fieldViewInset）的交集；
   * 關閉、或交集太小（例如鏡頭在轉場中、場地比畫面小很多）時回傳 area 本身
   *
   * @param area 原本的可出生範圍
   */
  private limitToView(area: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle {
    const alloc = GameConfig.spawnAlloc;
    if (!alloc.fieldSpawnInView) return area;
    const v = this.host.scene.cameras.main.worldView;
    const inset = alloc.fieldViewInset;
    const view = new Phaser.Geom.Rectangle(v.x + inset, v.y + inset, v.width - inset * 2, v.height - inset * 2);
    const both = Phaser.Geom.Rectangle.Intersection(area, view);
    return both.width >= FIELD_VIEW_MIN_SIZE && both.height >= FIELD_VIEW_MIN_SIZE ? both : area;
  }

  /**
   * 生成一隻波次怪並計入本波已生成數。綁定目標：BOSS 綁 P1、近身組綁指定座位、其餘綁生成點最近的角色；
   * 活動範圍限制：近身組幾乎不限、場上組依 config，BOSS / 塔不限
   *
   * @param pool 限定敵種池（省略則用全部解鎖的敵種）
   * @param assignSeat 綁定的座位；-1 = 就近
   */
  private spawnEnemyAt(x: number, y: number, time: number, pool?: EnemyType[], assignSeat = -1): void {
    const type = this.pickEnemyType(pool);
    const a = this.host.arena();
    const inset = GameConfig.spawn.edgeInset;
    const r = GameConfig.enemy.types[type].radius;
    const cx = Phaser.Math.Clamp(x, a.left + inset + r, a.right - inset - r);
    const cy = Phaser.Math.Clamp(y, a.top + inset + r, a.bottom - inset - r);
    const enemy = this.host.enemies().get(cx, cy) as Enemy | null;
    if (!enemy) return;
    this.host.wireEnemyCallbacks(enemy);
    enemy.spawn(cx, cy, time, type);
    enemy.targetSeat = enemy.isBoss ? 0 : (assignSeat >= 0 ? assignSeat : this.host.nearestSeat(cx, cy));
    enemy.stickyOutOfRangeSince = 0;
    const alloc = GameConfig.spawnAlloc;
    const unleashed = enemy.isBoss || type === 'tower';
    const near = assignSeat >= 0;
    enemy.leashRadius = unleashed ? Infinity : (near ? alloc.nearLeashRadius : alloc.fieldLeashRadius);
    enemy.leashTravelDist = unleashed ? Infinity : (near ? alloc.nearLeashTravelDist : alloc.fieldLeashTravelDist);
    this.host.onWaveEnemySpawned();
  }

  /**
   * 每隻生成前的封頂檢查：場上（含預告中）已達上限，或生產總量（已擊殺 + 場上 + 預告中）已達本波配額就不生
   */
  private isBlocked(): boolean {
    const alive = this.countAlive();
    const pending = this.countPending();
    if (alive + pending >= this.host.maxAlive()) return true;
    const progress = this.host.waveProgress();
    return progress.killed + alive + pending >= progress.quota;
  }

  /**
   * 依 spawnWeight 權重抽一種敵人（只在本波已解鎖且有權重的種類中抽）；
   * restrictPool 有指定時改在其交集中抽，交集為空（例如早期近戰還沒解鎖）退回全部解鎖的種類
   */
  private pickEnemyType(restrictPool?: EnemyType[]): EnemyType {
    const phase = this.host.monsterPhase();
    if (phase) return this.pickByPhaseWeights(phase, restrictPool);
    const types = GameConfig.enemy.types;
    const unlock = GameConfig.enemy.unlockByWave as Record<string, number>;
    const wave = this.host.currentWave();
    let pool = (Object.keys(types) as EnemyType[]).filter((k) => (unlock[k] ?? Infinity) <= wave && types[k].spawnWeight > 0);
    if (restrictPool && restrictPool.length > 0) {
      const restricted = pool.filter((k) => restrictPool.includes(k));
      if (restricted.length > 0) pool = restricted;
    }
    if (pool.length === 0) return 'normal';
    let total = 0;
    for (const k of pool) total += types[k].spawnWeight;
    let roll = Math.random() * total;
    for (const k of pool) {
      roll -= types[k].spawnWeight;
      if (roll <= 0) return k;
    }
    return pool[0];
  }

  /**
   * 關卡怪物配置的場上組每批隻數：配置範圍內隨機，每多一位存活玩家放大 fieldBatchGrowthPerPlayer
   *
   * @param phase 目前階段
   */
  private profileFieldBatch(phase: MonsterPhase): number {
    const alive = this.host.characters().filter((c) => c.alive).length;
    const growth = 1 + Math.max(0, alive - 1) * GameConfig.stageMonsters.fieldBatchGrowthPerPlayer;
    return Math.max(1, Math.round(Phaser.Math.Between(phase.fieldBatch[0], phase.fieldBatch[1]) * growth));
  }

  /**
   * 依關卡怪物配置目前階段的比例抽怪種（不看波次解鎖）；restrictPool 有指定時只在其交集中抽
   * （例如近身組只出近戰），交集內權重全為 0 時退回全部有權重的種類
   *
   * @param phase 目前階段
   * @param restrictPool 限定的敵種
   */
  private pickByPhaseWeights(phase: MonsterPhase, restrictPool?: EnemyType[]): EnemyType {
    const all = (Object.keys(phase.weights) as MonsterKind[]).filter((k) => phase.weights[k] > 0);
    let pool = all;
    if (restrictPool && restrictPool.length > 0) {
      const restricted = all.filter((k) => restrictPool.includes(k));
      if (restricted.length > 0) pool = restricted;
    }
    if (pool.length === 0) return 'normal';
    let total = 0;
    for (const k of pool) total += phase.weights[k];
    let roll = Math.random() * total;
    for (const k of pool) {
      roll -= phase.weights[k];
      if (roll <= 0) return k;
    }
    return pool[0];
  }

  /** 場上已實體化的波次一般怪數 */
  private countAlive(): number {
    return this.countRegular(false);
  }

  /** 場上預告中（尚未實體化）的波次一般怪數（算進總量，防超生） */
  private countPending(): number {
    return this.countRegular(true);
  }

  private countRegular(telegraphing: boolean): number {
    let n = 0;
    for (const child of this.host.enemies().getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead || !!e.telegraphing !== telegraphing) continue;
      if (!isRegularEnemy(e)) continue;
      n++;
    }
    return n;
  }
}
