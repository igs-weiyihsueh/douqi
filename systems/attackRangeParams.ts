import { GameConfig } from '../config';
import { createParamStore, type ParamDef, type ParamValues } from './paramStore';

/**
 * 攻擊範圍參數（木樁模式的「範圍編輯器」可調整，所有模式都套用）。
 *
 * - 預設值取自 config 的 melee（普攻扇形、鎖定敵人的近戰門檻）與 combo（圓形斬、直線氣波）
 * - 遊戲中透過 attackRange() 讀取目前值；每局開始（GameScene.resetState）重新讀取存檔，編輯器每次調整即時套用並存檔
 */

/** 可調整的攻擊範圍參數鍵 */
export type AttackRangeKey = 'meleeRadius' | 'meleeArcDeg' | 'meleeEnemyRange' | 'circleRadius' | 'lineLength' | 'lineWidth';

/** 攻擊範圍參數數值表 */
export type AttackRangeParams = ParamValues<AttackRangeKey>;

/** 編輯器顯示順序與各參數的範圍定義 */
export const ATTACK_RANGE_PARAM_DEFS: ReadonlyArray<ParamDef<AttackRangeKey>> = [
  { key: 'meleeRadius', label: '普攻扇形半徑', unit: 'px', hint: '打得到多遠', min: 60, max: 300, step: 10, defaultValue: GameConfig.melee.radius },
  { key: 'meleeArcDeg', label: '普攻扇形角度', unit: '°', hint: '打得到多寬', min: 30, max: 360, step: 10, defaultValue: GameConfig.melee.arcDeg },
  { key: 'meleeEnemyRange', label: '近戰觸發距離', unit: 'px', hint: '到怪身體邊緣，超過就衝刺', min: 40, max: 300, step: 10, defaultValue: GameConfig.melee.enemyRange },
  { key: 'circleRadius', label: '圓形斬半徑', unit: 'px', hint: '', min: 60, max: 400, step: 10, defaultValue: GameConfig.combo.circle.radius },
  { key: 'lineLength', label: '直線氣波長度', unit: 'px', hint: '', min: 100, max: 800, step: 20, defaultValue: GameConfig.combo.line.length },
  { key: 'lineWidth', label: '直線氣波寬度', unit: 'px', hint: '', min: 30, max: 300, step: 10, defaultValue: GameConfig.combo.line.width }
];

/** localStorage 存檔鍵（只存與預設不同的項目；結構或語意大改時升版） */
const STORAGE_KEY = 'douqi.attackRange.v1';

/** 攻擊範圍參數的讀寫介面（編輯器使用） */
export const attackRangeStore = createParamStore(ATTACK_RANGE_PARAM_DEFS, STORAGE_KEY);

/** 目前生效的攻擊範圍參數（每局開始 / 編輯器調整時更新） */
let current: AttackRangeParams = attackRangeStore.load();

/** 目前生效的攻擊範圍參數 */
export function attackRange(): Readonly<AttackRangeParams> {
  return current;
}

/** 重新讀取存檔，更新目前生效的攻擊範圍參數 */
export function reloadAttackRange(): void {
  current = attackRangeStore.load();
}

/**
 * 套用並儲存攻擊範圍參數（編輯器每次調整呼叫）
 *
 * @param values 要生效的參數
 */
export function applyAttackRange(values: AttackRangeParams): void {
  current = { ...values };
  attackRangeStore.save(current);
}
