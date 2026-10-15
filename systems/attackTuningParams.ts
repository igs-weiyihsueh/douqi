import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import { HIT_SHAPE_KINDS, type HitShape } from './hitShapes';
import { createParamStore, type ParamDef } from './paramStore';

/**
 * 每一招的打擊點（木樁模式的「範圍 / 判定編輯器」可調整，所有模式都套用）。
 *
 * - 招式：普攻第 1 / 2 段、招式1（Combo01，原圓形斬）、招式2（Combo02，原直線氣波）、爆發（Unique_skill，二段變身中的連打）、
 *   衝刺攻擊（二段變身衝刺撞到敵人時以撞擊點為基準的範圍）、一般衝刺（穿透途中碰到的怪），以及所有普攻共用的近戰觸發距離
 * - 每招有一到多個打擊點（MAX_HIT_POINTS 以內），每個打擊點有自己的判定時間（出招後幾毫秒）、傷害百分比與判定範圍
 *   （形狀扇形 / 圓形 / 長方形、判定中心往前 / 往上下偏移、尺寸，見 systems/hitShapes）：一招可以打好幾下，每下各自判定
 * - 爆發依自己的連打節奏、衝刺攻擊在撞到時判定，只用第一個打擊點的範圍（沒有時間軸）；
 *   一般衝刺以衝刺判定半徑碰撞（不用判定範圍），只用第一個打擊點的傷害 % 與頓點
 * - 預設每招一個打擊點，重現原本的範圍與判定時間點（melee.hitDelayMs / combo.*.hitDelayMs），傷害 100%
 * - 打擊點存成 JSON（只存跟預設不同的招式），近戰觸發距離用參數存檔；每局開始（GameScene.resetState）重新讀取
 */

/** 招式：普攻第 1 段 / 第 2 段 / 招式1 / 招式2 / 爆發 / 衝刺攻擊 / 一般衝刺（判定事件與編輯器分頁用） */
export type AttackMove = 'attack1' | 'attack2' | 'circle' | 'line' | 'burst' | 'dash' | 'pierce';

/** 有時間軸（打擊點依時間判定）的招式（爆發依自己的連打節奏、衝刺攻擊在撞到時判定） */
export type TimedAttackMove = 'attack1' | 'attack2' | 'circle' | 'line';

/** 招式顯示順序與名稱 */
export const ATTACK_MOVES: ReadonlyArray<{ move: AttackMove; label: string }> = [
  { move: 'attack1', label: '普攻 1' },
  { move: 'attack2', label: '普攻 2' },
  { move: 'circle', label: '招式1' },
  { move: 'line', label: '招式2' },
  { move: 'burst', label: '爆發' },
  { move: 'dash', label: '衝刺攻擊' },
  { move: 'pierce', label: '一般衝刺' }
];

/**
 * 招式是否有判定範圍可調（一般衝刺以衝刺判定半徑碰撞，沒有）
 *
 * @param move 招式
 */
export function hasHitShape(move: AttackMove): boolean {
  return move !== 'pierce';
}

/**
 * 招式是否有時間軸
 *
 * @param move 招式
 */
export function isTimedMove(move: AttackMove): move is TimedAttackMove {
  return move === 'attack1' || move === 'attack2' || move === 'circle' || move === 'line';
}

/** 一個打擊點：判定時間、傷害百分比與判定範圍 */
export interface HitPoint {
  /** 出招（開始播動作）後幾毫秒開始判定（動作時間） */
  timeMs: number;
  /** 判定段長度（毫秒，動作時間）：timeMs ~ timeMs + durationMs 每幀都判定，同一個目標在同一段只被打一次；0 = 只判定一格 */
  durationMs: number;
  /** 這一下的傷害 = 招式原本的傷害 × damagePct / 100 */
  damagePct: number;
  /** 命中敵人時出招者停住幾毫秒（攻擊者頓點，Character.applyHitPause） */
  pauseMs: number;
  /** 判定範圍 */
  shape: HitShape;
}

/** 打擊點的可調欄位（shape = 形狀種類，存 HIT_SHAPE_KINDS 的索引） */
export type HitPointField = 'timeMs' | 'durationMs' | 'damagePct' | 'pauseMs' | 'shape' | 'offsetForward' | 'offsetSide' | 'radius' | 'arcDeg' | 'length' | 'width';

/** 打擊點欄位的編輯定義（名稱、單位、範圍、每格幅度） */
export interface HitPointFieldDef {
  label: string;
  unit: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}

/** 各欄位的編輯定義 */
export const HIT_POINT_FIELDS: Readonly<Record<HitPointField, HitPointFieldDef>> = {
  timeMs: { label: '判定時間', unit: 'ms', hint: '出招後幾毫秒', min: 0, max: 2000, step: 10 },
  durationMs: { label: '判定長度', unit: 'ms', hint: '判定段持續多久（0 = 一格）', min: 0, max: 2000, step: 10 },
  damagePct: { label: '傷害', unit: '%', hint: '這一下 = 招式傷害 × %', min: 0, max: 300, step: 10 },
  pauseMs: { label: '頓點', unit: 'ms', hint: '打中怪時出招者停住多久（0 = 不停）', min: 0, max: 300, step: 10 },
  shape: { label: '形狀', unit: '', hint: '', min: 0, max: HIT_SHAPE_KINDS.length - 1, step: 1 },
  offsetForward: { label: '往前偏移', unit: 'px', hint: '判定中心往面向前方（負 = 往後）', min: -300, max: 400, step: 10 },
  offsetSide: { label: '往上下偏移', unit: 'px', hint: '正 = 往下、負 = 往上（左右轉身同一邊）', min: -300, max: 300, step: 10 },
  radius: { label: '半徑', unit: 'px', hint: '', min: 20, max: 500, step: 10 },
  arcDeg: { label: '扇形角度', unit: '°', hint: '', min: 10, max: 360, step: 10 },
  length: { label: '長度', unit: 'px', hint: '沿面向', min: 20, max: 900, step: 10 },
  width: { label: '寬度', unit: 'px', hint: '', min: 20, max: 500, step: 10 }
};

/** 一招最多幾個打擊點 */
export const MAX_HIT_POINTS = 8;

const melee = GameConfig.melee;
const combo = GameConfig.combo;

/** 各招預設判定範圍（重現原本的範圍；切換形狀時其他形狀的尺寸也有合理的初值） */
const DEFAULT_SHAPES: Readonly<Record<AttackMove, HitShape>> = {
  attack1: { kind: 'arc', offsetForward: 0, offsetSide: 0, radius: melee.radius, arcDeg: melee.arcDeg, length: melee.radius, width: melee.radius },
  attack2: { kind: 'arc', offsetForward: 0, offsetSide: 0, radius: melee.radius, arcDeg: melee.arcDeg, length: melee.radius, width: melee.radius },
  circle: { kind: 'circle', offsetForward: 0, offsetSide: 0, radius: combo.circle.radius, arcDeg: 360, length: combo.circle.radius * 2, width: combo.circle.radius },
  line: { kind: 'rect', offsetForward: 0, offsetSide: 0, radius: combo.line.width, arcDeg: 90, length: combo.line.length, width: combo.line.width },
  burst: { kind: 'circle', offsetForward: 0, offsetSide: 0, radius: GameConfig.burst.radius, arcDeg: 360, length: GameConfig.burst.radius * 2, width: GameConfig.burst.radius },
  dash: { kind: 'circle', offsetForward: 0, offsetSide: 0, radius: combo.empower.aoe.radius, arcDeg: 360, length: combo.empower.aoe.radius * 2, width: combo.empower.aoe.radius },
  // 一般衝刺不用判定範圍（hasHitShape），只為資料格式一致
  pierce: { kind: 'circle', offsetForward: 0, offsetSide: 0, radius: GameConfig.aim.dashHitRadius, arcDeg: 360, length: GameConfig.aim.dashHitRadius * 2, width: GameConfig.aim.dashHitRadius }
};

/** 有時間軸招式的預設判定時間點 */
const DEFAULT_HIT_MS: Readonly<Record<TimedAttackMove, number>> = {
  attack1: melee.hitDelayMs[0],
  attack2: melee.hitDelayMs[1],
  circle: combo.circle.hitDelayMs,
  line: combo.line.hitDelayMs
};

/** 各招打擊點的預設頓點（GameConfig.attackerHitPauseMs） */
const HIT_PAUSE = GameConfig.attackerHitPauseMs;
const DEFAULT_PAUSE_MS: Readonly<Record<AttackMove, number>> = {
  attack1: HIT_PAUSE.attack,
  attack2: HIT_PAUSE.attack,
  circle: HIT_PAUSE.combo,
  line: HIT_PAUSE.combo,
  burst: HIT_PAUSE.burst,
  dash: HIT_PAUSE.dash,
  pierce: HIT_PAUSE.pierce
};

/**
 * 一招的預設打擊點（一個，傷害 100%）
 *
 * @param move 招式
 */
export function defaultHitPoints(move: AttackMove): HitPoint[] {
  return [{ timeMs: isTimedMove(move) ? DEFAULT_HIT_MS[move] : 0, durationMs: 0, damagePct: 100, pauseMs: DEFAULT_PAUSE_MS[move], shape: { ...DEFAULT_SHAPES[move] } }];
}

/**
 * 把欄位數值夾在合法範圍內（四捨五入成整數）；非數字時回傳 fallback
 *
 * @param field 欄位
 * @param value 數值
 * @param fallback 非數字時的值
 */
export function clampHitPointField(field: HitPointField, value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const def = HIT_POINT_FIELDS[field];
  return Math.min(def.max, Math.max(def.min, Math.round(value)));
}

/**
 * 整理成合法的打擊點（缺漏或錯誤的欄位用 base 的值）
 *
 * @param raw 讀到 / 傳入的資料
 * @param base 預設打擊點
 */
function sanitizeHitPoint(raw: unknown, base: HitPoint): HitPoint {
  const r = (raw ?? {}) as { timeMs?: unknown; durationMs?: unknown; damagePct?: unknown; pauseMs?: unknown; shape?: Partial<HitShape> };
  const s: Partial<HitShape> = r.shape ?? {};
  const savedKind = s.kind ? HIT_SHAPE_KINDS.indexOf(s.kind) : -1;
  const kindIndex = savedKind >= 0 ? savedKind : HIT_SHAPE_KINDS.indexOf(base.shape.kind);
  return {
    timeMs: clampHitPointField('timeMs', r.timeMs, base.timeMs),
    durationMs: clampHitPointField('durationMs', r.durationMs, base.durationMs),
    damagePct: clampHitPointField('damagePct', r.damagePct, base.damagePct),
    pauseMs: clampHitPointField('pauseMs', r.pauseMs, base.pauseMs),
    shape: {
      kind: HIT_SHAPE_KINDS[kindIndex],
      offsetForward: clampHitPointField('offsetForward', s.offsetForward, base.shape.offsetForward),
      offsetSide: clampHitPointField('offsetSide', s.offsetSide, base.shape.offsetSide),
      radius: clampHitPointField('radius', s.radius, base.shape.radius),
      arcDeg: clampHitPointField('arcDeg', s.arcDeg, base.shape.arcDeg),
      length: clampHitPointField('length', s.length, base.shape.length),
      width: clampHitPointField('width', s.width, base.shape.width)
    }
  };
}

/**
 * 依判定時間排序（新陣列）
 *
 * @param points 打擊點
 */
function sortByTime(points: ReadonlyArray<HitPoint>): HitPoint[] {
  return [...points].sort((a, b) => a.timeMs - b.timeMs);
}

/** 打擊點的 localStorage 存檔鍵（JSON：只存跟預設不同的招式）與要清掉的舊版存檔（舊格式無法轉換） */
const TIMELINE_STORAGE_KEY = 'douqi.moveTimelines.v1';
const LEGACY_STORAGE_KEYS: ReadonlyArray<string> = ['douqi.attackRange.v1', 'douqi.attackTuning.v2', 'douqi.attackTuning.v3'];

/** 讀取各招打擊點（無法存取 / 資料損壞時用預設；打擊點依時間排序） */
function loadTimelines(): Record<AttackMove, HitPoint[]> {
  const result = {} as Record<AttackMove, HitPoint[]>;
  let saved: Record<string, unknown> = {};
  try {
    const raw = window.localStorage.getItem(TIMELINE_STORAGE_KEY);
    if (raw) saved = JSON.parse(raw) as Record<string, unknown>;
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    saved = {};
  }
  for (const { move } of ATTACK_MOVES) {
    const base = defaultHitPoints(move)[0];
    const list = Array.isArray(saved[move]) ? (saved[move] as unknown[]).slice(0, MAX_HIT_POINTS) : [];
    result[move] = list.length > 0 ? sortByTime(list.map((p) => sanitizeHitPoint(p, base))) : defaultHitPoints(move);
  }
  return result;
}

/** 目前生效的各招打擊點 */
let timelines: Record<AttackMove, HitPoint[]> = loadTimelines();

/** 存檔：只存跟預設不同的招式（全部都是預設時移除存檔；無法寫入時忽略，本次遊戲仍有效） */
function saveTimelines(): void {
  const changed: Record<string, HitPoint[]> = {};
  for (const { move } of ATTACK_MOVES) {
    if (JSON.stringify(timelines[move]) !== JSON.stringify(defaultHitPoints(move))) changed[move] = timelines[move];
  }
  try {
    if (Object.keys(changed).length === 0) window.localStorage.removeItem(TIMELINE_STORAGE_KEY);
    else window.localStorage.setItem(TIMELINE_STORAGE_KEY, JSON.stringify(changed));
  } catch {
    // 無法寫入（無痕模式 / 封鎖儲存）：不影響遊戲
  }
}

/**
 * 一招目前的打擊點（依判定時間排序）
 *
 * @param move 招式
 */
export function moveHitPoints(move: AttackMove): ReadonlyArray<HitPoint> {
  return timelines[move];
}

/**
 * 設定一招的打擊點（每個欄位夾在合法範圍、依時間排序、最多 MAX_HIT_POINTS 個；空的話用預設）並存檔
 *
 * @param move 招式
 * @param points 打擊點
 * @returns 排序後的打擊點
 */
export function setMoveHitPoints(move: AttackMove, points: ReadonlyArray<HitPoint>): ReadonlyArray<HitPoint> {
  const base = defaultHitPoints(move)[0];
  const list = points.length > 0 ? points.slice(0, MAX_HIT_POINTS) : [base];
  timelines = { ...timelines, [move]: sortByTime(list.map((p) => sanitizeHitPoint(p, base))) };
  saveTimelines();
  return timelines[move];
}

/**
 * 一招恢復預設打擊點
 *
 * @param move 招式
 */
export function resetMoveHitPoints(move: AttackMove): void {
  setMoveHitPoints(move, defaultHitPoints(move));
}

/**
 * 普攻某一段對應的招式
 *
 * @param segment 段數（0 = 第 1 段、1 = 第 2 段）
 */
export function meleeMove(segment: number): 'attack1' | 'attack2' {
  return segment === 0 ? 'attack1' : 'attack2';
}

/**
 * 判定範圍「伸到最遠」的距離（從基準點量）
 *
 * @param shape 判定範圍
 */
export function shapeReach(shape: HitShape): number {
  const size = shape.kind === 'rect' ? shape.length : shape.radius;
  return Math.max(0, shape.offsetForward + size);
}

/**
 * 一招所有打擊點中伸到最遠的距離（普攻往前踏時用來確保踏完打得到）
 *
 * @param move 招式
 */
export function moveReach(move: AttackMove): number {
  return Math.max(...timelines[move].map((p) => shapeReach(p.shape)));
}

/**
 * 一招最後一段判定結束的時間（毫秒；連段技的表演時間從這裡往後算）
 *
 * @param move 招式
 */
export function lastHitMs(move: AttackMove): number {
  return Math.max(...timelines[move].map((p) => p.timeMs + p.durationMs));
}

/** 近戰觸發距離（普攻共用）的參數定義與存檔 */
export const MELEE_ENEMY_RANGE_DEF: Readonly<ParamDef<'meleeEnemyRange'>> = {
  key: 'meleeEnemyRange', label: '近戰觸發距離', unit: 'px', hint: '到怪身體邊緣，超過就衝刺', min: 40, max: 300, step: 10, defaultValue: melee.enemyRange
};
const meleeRangeStore = createParamStore([MELEE_ENEMY_RANGE_DEF], 'douqi.meleeRange.v1');
let meleeRange = meleeRangeStore.load();

/** 目前的普攻共用參數（近戰觸發距離） */
export function attackTuning(): Readonly<{ meleeEnemyRange: number }> {
  return meleeRange;
}

/**
 * 設定並儲存近戰觸發距離（夾在合法範圍）
 *
 * @param value 距離
 */
export function setMeleeEnemyRange(value: number): void {
  meleeRange = { meleeEnemyRange: meleeRangeStore.clamp(MELEE_ENEMY_RANGE_DEF, value) };
  meleeRangeStore.save(meleeRange);
}

/** 全部招式恢復預設打擊點，近戰觸發距離也恢復 */
export function resetAllAttackTuning(): void {
  for (const { move } of ATTACK_MOVES) timelines[move] = defaultHitPoints(move);
  saveTimelines();
  setMeleeEnemyRange(MELEE_ENEMY_RANGE_DEF.defaultValue);
}

/** 重新讀取存檔（打擊點與近戰觸發距離） */
export function reloadAttackTuning(): void {
  timelines = loadTimelines();
  meleeRange = meleeRangeStore.load();
}

/** 攻擊判定時發出的場景事件（參數：出招的角色、招式 AttackMove、打擊點索引；範圍編輯器用來在判定那一刻閃一下該打擊點） */
export const ATTACK_HIT_EVENT = 'attack-hit';

/**
 * 等到判定時間點再判定命中（0 以下立即判定）；計時用角色所在場景的時鐘。等待期間出招者有頓點（Character.applyHitPause）時，
 * 判定跟著順延同樣的時間，整招節奏不變
 *
 * @param c 出招的角色
 * @param delayMs 出招後幾毫秒判定
 * @param time 目前場景時間
 * @param resolve 判定時呼叫（傳入判定當下的場景時間）
 */
export function afterHitDelay(c: Character, delayMs: number, time: number, resolve: (hitTime: number) => void): void {
  if (delayMs <= 0) {
    resolve(time);
    return;
  }
  const pausedAtSchedule = c.hitPauseTotalMs;
  c.scene.time.delayedCall(delayMs, () => {
    const paused = c.hitPauseTotalMs - pausedAtSchedule;
    if (paused > 0) afterHitDelay(c, paused, c.scene.time.now, resolve);
    else resolve(c.scene.time.now);
  });
}

/** 判定段每次判定的間隔（毫秒；約一幀） */
const HIT_WINDOW_TICK_MS = 1000 / 60;

/** 一個打擊點判定段的狀態：這一段已經打過的目標（敵人與物件，每段只打一次）、這一段是否已經頓點過 */
export interface HitWindowState {
  readonly targets: Set<object>;
  paused: boolean;
}

/** 新的判定段狀態 */
export function createHitWindowState(): HitWindowState {
  return { targets: new Set(), paused: false };
}

/**
 * 打擊點的判定段：到了開始時間（afterHitDelay，含頓點順延）判定第一次，之後每幀再判定，直到判定段長度用完；
 * 出招者頓點期間不判定，判定段跟著順延。長度 0 = 只判定一次（一格）
 *
 * @param c 出招的角色
 * @param startMs 出招後幾毫秒開始（實際時間）
 * @param durationMs 判定段長度（實際時間）
 * @param time 目前場景時間
 * @param tick 每次判定（傳入判定當下的場景時間、是否為這一段的第一次）；回傳 false 時提前結束這一段（例：出招者倒下或受擊硬直）
 */
export function runHitWindow(
  c: Character, startMs: number, durationMs: number, time: number, tick: (hitTime: number, first: boolean) => boolean
): void {
  afterHitDelay(c, startMs, time, (startTime) => {
    if (!tick(startTime, true) || durationMs <= 0) return;
    const pausedAtStart = c.hitPauseTotalMs;
    const timer = c.scene.time.addEvent({
      delay: HIT_WINDOW_TICK_MS,
      loop: true,
      callback: () => {
        const now = c.scene.time.now;
        if (c.isHitPaused(now)) return;
        // 扣掉這一段開始後的頓點時間，判定段才會跟著順延
        const elapsed = now - startTime - (c.hitPauseTotalMs - pausedAtStart);
        if (!tick(now, false) || elapsed >= durationMs) timer.remove(false);
      }
    });
  });
}
