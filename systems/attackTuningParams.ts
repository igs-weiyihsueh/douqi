import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import { HIT_SHAPE_KINDS, type HitShape, type HitShapeKind } from './hitShapes';
import { createParamStore, type ParamDef, type ParamValues } from './paramStore';

/**
 * 每一招的判定範圍（形狀、判定中心偏移、尺寸）與判定時間點參數（木樁模式的「範圍 / 判定編輯器」可調整，所有模式都套用）。
 *
 * - 招式：普攻第 1 / 2 段、圓形斬（Combo01）、直線氣波（Combo02）、爆發（Unique_skill，二段變身中的連打）、
 *   衝刺攻擊（二段變身衝刺撞到敵人時以撞擊點為基準的範圍），以及所有普攻共用的近戰觸發距離
 * - 每招：形狀（扇形 / 圓形 / 長方形，見 systems/hitShapes）、判定中心沿面向往前 / 往側邊偏移、扇形半徑與角度、
 *   長方形長寬；普攻與連段技另有判定時間點（出招後多少毫秒才判定，預設取自 melee.hitDelayMs / combo.*.hitDelayMs）
 * - 預設值重現原本的範圍（普攻扇形、圓形斬圓形、直線氣波長方形、爆發與衝刺攻擊圓形，偏移 0）
 * - 遊戲中透過 moveShape() / moveHitMs() / attackTuning() 讀取目前值；每局開始（GameScene.resetState）重新讀取存檔，
 *   編輯器每次調整即時套用並存檔
 */

/** 招式：普攻第 1 段 / 第 2 段 / 圓形斬 / 直線氣波 / 爆發 / 衝刺攻擊（判定事件與編輯器分頁用） */
export type AttackMove = 'attack1' | 'attack2' | 'circle' | 'line' | 'burst' | 'dash';

/** 有判定時間點的招式（爆發依自己的連打節奏、衝刺攻擊在撞到時判定） */
export type TimedAttackMove = 'attack1' | 'attack2' | 'circle' | 'line';

/** 每招的形狀欄位（shape 存 HIT_SHAPE_KINDS 的索引） */
type ShapeField = 'shape' | 'offsetForward' | 'offsetSide' | 'radius' | 'arcDeg' | 'length' | 'width';

/** 可調整的參數鍵 */
export type AttackTuningKey = `${AttackMove}.${ShapeField}` | `${TimedAttackMove}.hitMs` | 'meleeEnemyRange';

/** 參數數值表 */
export type AttackTuningParams = ParamValues<AttackTuningKey>;

/** 招式顯示順序與名稱 */
export const ATTACK_MOVES: ReadonlyArray<{ move: AttackMove; label: string }> = [
  { move: 'attack1', label: '普攻 1' },
  { move: 'attack2', label: '普攻 2' },
  { move: 'circle', label: '圓形斬' },
  { move: 'line', label: '直線氣波' },
  { move: 'burst', label: '爆發' },
  { move: 'dash', label: '衝刺攻擊' }
];

/** 招式是否有判定時間點 */
export function isTimedMove(move: AttackMove): move is TimedAttackMove {
  return move === 'attack1' || move === 'attack2' || move === 'circle' || move === 'line';
}

const melee = GameConfig.melee;
const combo = GameConfig.combo;

/** 各招預設形狀（重現原本的範圍；切換形狀時其他形狀的尺寸也有合理的初值） */
const DEFAULT_SHAPES: Readonly<Record<AttackMove, HitShape>> = {
  attack1: { kind: 'arc', offsetForward: 0, offsetSide: 0, radius: melee.radius, arcDeg: melee.arcDeg, length: melee.radius, width: melee.radius },
  attack2: { kind: 'arc', offsetForward: 0, offsetSide: 0, radius: melee.radius, arcDeg: melee.arcDeg, length: melee.radius, width: melee.radius },
  circle: { kind: 'circle', offsetForward: 0, offsetSide: 0, radius: combo.circle.radius, arcDeg: 360, length: combo.circle.radius * 2, width: combo.circle.radius },
  line: { kind: 'rect', offsetForward: 0, offsetSide: 0, radius: combo.line.width, arcDeg: 90, length: combo.line.length, width: combo.line.width },
  burst: { kind: 'circle', offsetForward: 0, offsetSide: 0, radius: GameConfig.burst.radius, arcDeg: 360, length: GameConfig.burst.radius * 2, width: GameConfig.burst.radius },
  dash: { kind: 'circle', offsetForward: 0, offsetSide: 0, radius: combo.empower.aoe.radius, arcDeg: 360, length: combo.empower.aoe.radius * 2, width: combo.empower.aoe.radius }
};

/** 各招判定時間點預設值 */
const DEFAULT_HIT_MS: Readonly<Record<TimedAttackMove, number>> = {
  attack1: melee.hitDelayMs[0],
  attack2: melee.hitDelayMs[1],
  circle: combo.circle.hitDelayMs,
  line: combo.line.hitDelayMs
};

/**
 * 一招的參數定義（形狀與尺寸，有判定時間點的招式再加一列）
 *
 * @param move 招式
 */
function moveDefs(move: AttackMove): Array<ParamDef<AttackTuningKey>> {
  const d = DEFAULT_SHAPES[move];
  const defs: Array<ParamDef<AttackTuningKey>> = [
    { key: `${move}.shape`, label: '形狀', unit: '', hint: '', min: 0, max: HIT_SHAPE_KINDS.length - 1, step: 1, defaultValue: HIT_SHAPE_KINDS.indexOf(d.kind) },
    { key: `${move}.offsetForward`, label: '往前偏移', unit: 'px', hint: '判定中心往面向前方（負 = 往後）', min: -300, max: 400, step: 10, defaultValue: d.offsetForward },
    { key: `${move}.offsetSide`, label: '往側邊偏移', unit: 'px', hint: '正 = 面向右側、負 = 左側', min: -300, max: 300, step: 10, defaultValue: d.offsetSide },
    { key: `${move}.radius`, label: '半徑', unit: 'px', hint: '', min: 20, max: 500, step: 10, defaultValue: d.radius },
    { key: `${move}.arcDeg`, label: '扇形角度', unit: '°', hint: '', min: 10, max: 360, step: 10, defaultValue: d.arcDeg },
    { key: `${move}.length`, label: '長度', unit: 'px', hint: '沿面向', min: 20, max: 900, step: 10, defaultValue: d.length },
    { key: `${move}.width`, label: '寬度', unit: 'px', hint: '', min: 20, max: 500, step: 10, defaultValue: d.width }
  ];
  if (isTimedMove(move)) {
    defs.push({ key: `${move}.hitMs`, label: '判定時間', unit: 'ms', hint: '出招後幾毫秒才打到', min: 0, max: 1600, step: 10, defaultValue: DEFAULT_HIT_MS[move] });
  }
  return defs;
}

/** 所有參數的範圍定義 */
export const ATTACK_TUNING_PARAM_DEFS: ReadonlyArray<ParamDef<AttackTuningKey>> = [
  ...ATTACK_MOVES.flatMap(({ move }) => moveDefs(move)),
  { key: 'meleeEnemyRange', label: '近戰觸發距離', unit: 'px', hint: '到怪身體邊緣，超過就衝刺', min: 40, max: 300, step: 10, defaultValue: melee.enemyRange }
];

/** localStorage 存檔鍵（只存與預設不同的項目；結構或語意大改時升版，舊鍵讀取時清除） */
const STORAGE_KEY = 'douqi.attackTuning.v3';

/** 參數的讀寫介面（編輯器使用） */
export const attackTuningStore = createParamStore(ATTACK_TUNING_PARAM_DEFS, STORAGE_KEY, ['douqi.attackRange.v1', 'douqi.attackTuning.v2']);

/** 目前生效的參數（每局開始 / 編輯器調整時更新） */
let current: AttackTuningParams = attackTuningStore.load();

/** 目前生效的參數 */
export function attackTuning(): Readonly<AttackTuningParams> {
  return current;
}

/**
 * 一招目前的判定形狀
 *
 * @param move 招式
 */
export function moveShape(move: AttackMove): HitShape {
  const t = current;
  const kind: HitShapeKind = HIT_SHAPE_KINDS[t[`${move}.shape`]] ?? DEFAULT_SHAPES[move].kind;
  return {
    kind,
    offsetForward: t[`${move}.offsetForward`],
    offsetSide: t[`${move}.offsetSide`],
    radius: t[`${move}.radius`],
    arcDeg: t[`${move}.arcDeg`],
    length: t[`${move}.length`],
    width: t[`${move}.width`]
  };
}

/**
 * 一招目前的判定時間點（毫秒）
 *
 * @param move 有判定時間點的招式
 */
export function moveHitMs(move: TimedAttackMove): number {
  return current[`${move}.hitMs`];
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
 * 判定形狀「伸到最遠」的距離（從基準點量；普攻往前踏時用來確保踏完打得到）
 *
 * @param shape 判定形狀
 */
export function shapeReach(shape: HitShape): number {
  const size = shape.kind === 'rect' ? shape.length : shape.radius;
  return Math.max(0, shape.offsetForward + size);
}

/** 重新讀取存檔，更新目前生效的參數 */
export function reloadAttackTuning(): void {
  current = attackTuningStore.load();
}

/**
 * 套用並儲存參數（編輯器每次調整呼叫）
 *
 * @param values 要生效的參數
 */
export function applyAttackTuning(values: AttackTuningParams): void {
  current = { ...values };
  attackTuningStore.save(current);
}

/** 攻擊判定時發出的場景事件（參數：出招的角色、招式 AttackMove；範圍編輯器用來在判定那一刻閃一下該招範圍） */
export const ATTACK_HIT_EVENT = 'attack-hit';

/**
 * 等到判定時間點再判定命中（0 以下立即判定）；計時用角色所在場景的時鐘
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
  c.scene.time.delayedCall(delayMs, () => resolve(c.scene.time.now));
}
