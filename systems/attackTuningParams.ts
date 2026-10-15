import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import { createParamStore, type ParamDef, type ParamValues } from './paramStore';

/**
 * 攻擊範圍與判定時間點參數（木樁模式的「範圍編輯器」可調整，所有模式都套用）。
 *
 * - 範圍預設值取自 config 的 melee（普攻扇形、鎖定敵人的近戰門檻）與 combo（圓形斬、直線氣波）
 * - 判定時間點 = 出招（開始播動作）後多少毫秒才判定命中，預設值取自 melee.hitDelayMs / combo.*.hitDelayMs
 * - 遊戲中透過 attackTuning() 讀取目前值；每局開始（GameScene.resetState）重新讀取存檔，編輯器每次調整即時套用並存檔
 */

/** 可調整的參數鍵 */
export type AttackTuningKey =
  | 'meleeRadius' | 'meleeArcDeg' | 'meleeEnemyRange' | 'circleRadius' | 'lineLength' | 'lineWidth'
  | 'hitMsAttack1' | 'hitMsAttack2' | 'hitMsCircle' | 'hitMsLine';

/** 參數數值表 */
export type AttackTuningParams = ParamValues<AttackTuningKey>;

/** 編輯器顯示順序與各參數的範圍定義 */
export const ATTACK_TUNING_PARAM_DEFS: ReadonlyArray<ParamDef<AttackTuningKey>> = [
  { key: 'meleeRadius', label: '普攻扇形半徑', unit: 'px', hint: '打得到多遠', min: 60, max: 300, step: 10, defaultValue: GameConfig.melee.radius },
  { key: 'meleeArcDeg', label: '普攻扇形角度', unit: '°', hint: '打得到多寬', min: 30, max: 360, step: 10, defaultValue: GameConfig.melee.arcDeg },
  { key: 'meleeEnemyRange', label: '近戰觸發距離', unit: 'px', hint: '到怪身體邊緣，超過就衝刺', min: 40, max: 300, step: 10, defaultValue: GameConfig.melee.enemyRange },
  { key: 'circleRadius', label: '圓形斬半徑', unit: 'px', hint: '', min: 60, max: 400, step: 10, defaultValue: GameConfig.combo.circle.radius },
  { key: 'lineLength', label: '直線氣波長度', unit: 'px', hint: '', min: 100, max: 800, step: 20, defaultValue: GameConfig.combo.line.length },
  { key: 'lineWidth', label: '直線氣波寬度', unit: 'px', hint: '', min: 30, max: 300, step: 10, defaultValue: GameConfig.combo.line.width },
  { key: 'hitMsAttack1', label: '普攻第 1 段判定', unit: 'ms', hint: '出手後幾毫秒才打到', min: 0, max: 500, step: 10, defaultValue: GameConfig.melee.hitDelayMs[0] },
  { key: 'hitMsAttack2', label: '普攻第 2 段判定', unit: 'ms', hint: '', min: 0, max: 500, step: 10, defaultValue: GameConfig.melee.hitDelayMs[1] },
  { key: 'hitMsCircle', label: '圓形斬判定', unit: 'ms', hint: '', min: 0, max: 1000, step: 10, defaultValue: GameConfig.combo.circle.hitDelayMs },
  { key: 'hitMsLine', label: '直線氣波判定', unit: 'ms', hint: '', min: 0, max: 600, step: 10, defaultValue: GameConfig.combo.line.hitDelayMs }
];

/** localStorage 存檔鍵（只存與預設不同的項目；沿用加入判定時間點前的鍵，已調好的範圍不會不見；結構或語意大改時升版） */
const STORAGE_KEY = 'douqi.attackRange.v1';

/** 參數的讀寫介面（編輯器使用） */
export const attackTuningStore = createParamStore(ATTACK_TUNING_PARAM_DEFS, STORAGE_KEY);

/** 目前生效的參數（每局開始 / 編輯器調整時更新） */
let current: AttackTuningParams = attackTuningStore.load();

/** 目前生效的參數 */
export function attackTuning(): Readonly<AttackTuningParams> {
  return current;
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

/** 攻擊判定時發出的場景事件（參數：出招的角色、判定種類；範圍編輯器用來在判定那一刻閃一下範圍） */
export const ATTACK_HIT_EVENT = 'attack-hit';

/** 判定種類：普攻扇形 / 圓形斬 / 直線氣波 */
export type AttackHitKind = 'melee' | 'circle' | 'line';

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
