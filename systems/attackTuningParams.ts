import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import { createParamStore, type ParamDef, type ParamValues } from './paramStore';

/**
 * 每一招的攻擊範圍與判定時間點參數（木樁模式的「範圍 / 判定編輯器」可調整，所有模式都套用）。
 *
 * - 招式：普攻第 1 / 2 段（各自的扇形半徑、角度、判定時間點）、圓形斬（半徑、判定）、直線氣波（長度、寬度、判定），
 *   以及所有普攻共用的近戰觸發距離
 * - 範圍預設值取自 config 的 melee（普攻扇形、近戰門檻）與 combo（圓形斬、直線氣波）；
 *   判定時間點 = 出招（開始播動作）後多少毫秒才判定命中，預設取自 melee.hitDelayMs / combo.*.hitDelayMs
 * - 遊戲中透過 attackTuning() 讀取目前值；每局開始（GameScene.resetState）重新讀取存檔，編輯器每次調整即時套用並存檔
 */

/** 可調整的參數鍵 */
export type AttackTuningKey =
  | 'attack1Radius' | 'attack1ArcDeg' | 'hitMsAttack1'
  | 'attack2Radius' | 'attack2ArcDeg' | 'hitMsAttack2'
  | 'circleRadius' | 'hitMsCircle'
  | 'lineLength' | 'lineWidth' | 'hitMsLine'
  | 'meleeEnemyRange';

/** 參數數值表 */
export type AttackTuningParams = ParamValues<AttackTuningKey>;

/** 招式：普攻第 1 段 / 第 2 段 / 圓形斬 / 直線氣波（判定事件與編輯器分組用） */
export type AttackMove = 'attack1' | 'attack2' | 'circle' | 'line';

/** 編輯器分組：一招一組（近戰觸發距離另成一組，move = null） */
export interface AttackTuningGroup {
  title: string;
  move: AttackMove | null;
  keys: ReadonlyArray<AttackTuningKey>;
}

const melee = GameConfig.melee;
const combo = GameConfig.combo;

/** 各參數的範圍定義（顯示順序見 ATTACK_TUNING_GROUPS） */
export const ATTACK_TUNING_PARAM_DEFS: ReadonlyArray<ParamDef<AttackTuningKey>> = [
  { key: 'attack1Radius', label: '扇形半徑', unit: 'px', hint: '打得到多遠', min: 60, max: 300, step: 10, defaultValue: melee.radius },
  { key: 'attack1ArcDeg', label: '扇形角度', unit: '°', hint: '打得到多寬', min: 30, max: 360, step: 10, defaultValue: melee.arcDeg },
  { key: 'hitMsAttack1', label: '判定時間', unit: 'ms', hint: '出手後幾毫秒才打到', min: 0, max: 500, step: 10, defaultValue: melee.hitDelayMs[0] },
  { key: 'attack2Radius', label: '扇形半徑', unit: 'px', hint: '', min: 60, max: 300, step: 10, defaultValue: melee.radius },
  { key: 'attack2ArcDeg', label: '扇形角度', unit: '°', hint: '', min: 30, max: 360, step: 10, defaultValue: melee.arcDeg },
  { key: 'hitMsAttack2', label: '判定時間', unit: 'ms', hint: '', min: 0, max: 500, step: 10, defaultValue: melee.hitDelayMs[1] },
  { key: 'circleRadius', label: '半徑', unit: 'px', hint: '', min: 60, max: 400, step: 10, defaultValue: combo.circle.radius },
  { key: 'hitMsCircle', label: '判定時間', unit: 'ms', hint: '', min: 0, max: 1600, step: 10, defaultValue: combo.circle.hitDelayMs },
  { key: 'lineLength', label: '長度', unit: 'px', hint: '', min: 100, max: 800, step: 20, defaultValue: combo.line.length },
  { key: 'lineWidth', label: '寬度', unit: 'px', hint: '', min: 30, max: 300, step: 10, defaultValue: combo.line.width },
  { key: 'hitMsLine', label: '判定時間', unit: 'ms', hint: '', min: 0, max: 1000, step: 10, defaultValue: combo.line.hitDelayMs },
  { key: 'meleeEnemyRange', label: '觸發距離', unit: 'px', hint: '到怪身體邊緣，超過就衝刺', min: 40, max: 300, step: 10, defaultValue: melee.enemyRange }
];

/** 編輯器分組（顯示順序） */
export const ATTACK_TUNING_GROUPS: ReadonlyArray<AttackTuningGroup> = [
  { title: '普攻第 1 段', move: 'attack1', keys: ['attack1Radius', 'attack1ArcDeg', 'hitMsAttack1'] },
  { title: '普攻第 2 段', move: 'attack2', keys: ['attack2Radius', 'attack2ArcDeg', 'hitMsAttack2'] },
  { title: '圓形斬', move: 'circle', keys: ['circleRadius', 'hitMsCircle'] },
  { title: '直線氣波', move: 'line', keys: ['lineLength', 'lineWidth', 'hitMsLine'] },
  { title: '近戰觸發（普攻共用）', move: null, keys: ['meleeEnemyRange'] }
];


/** localStorage 存檔鍵（只存與預設不同的項目；結構或語意大改時升版，舊鍵讀取時清除） */
const STORAGE_KEY = 'douqi.attackTuning.v2';

/** 參數的讀寫介面（編輯器使用） */
export const attackTuningStore = createParamStore(ATTACK_TUNING_PARAM_DEFS, STORAGE_KEY, ['douqi.attackRange.v1']);

/** 目前生效的參數（每局開始 / 編輯器調整時更新） */
let current: AttackTuningParams = attackTuningStore.load();

/** 目前生效的參數 */
export function attackTuning(): Readonly<AttackTuningParams> {
  return current;
}

/**
 * 普攻某一段的扇形與判定時間點
 *
 * @param segment 段數（0 = 第 1 段、1 = 第 2 段）
 */
export function meleeSegment(segment: number): { radius: number; arcDeg: number; hitMs: number } {
  const t = current;
  return segment === 0
    ? { radius: t.attack1Radius, arcDeg: t.attack1ArcDeg, hitMs: t.hitMsAttack1 }
    : { radius: t.attack2Radius, arcDeg: t.attack2ArcDeg, hitMs: t.hitMsAttack2 };
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
