import { GameConfig } from '../config';
import { createParamStore, type ParamDef } from './paramStore';

/**
 * 衝刺參數（招式編輯器的「一般衝刺」「強化衝刺」頁可調整，調整後立即生效）。
 *
 * - 衝刺距離 / 速度：慢速模式 P1 與 BOT 的衝刺（快速模式仍讀 config 常數）；衝刺距離同時是慢速模式的鎖敵範圍
 * - 強化衝刺距離 / 速度倍率：二段變身中衝刺的距離與速度再乘上這個倍率
 * - 預設值取自 config 的 slow.dashDistance / slow.dashSpeed / combo.empower.moveMult / combo.empower.dashSpeedMult；
 *   只存跟預設不同的項目，每局開始（GameScene.resetState）重新讀取
 */

/** 衝刺參數鍵 */
export type DashParamKey = 'dashDistance' | 'dashSpeed' | 'empowerDistanceMult' | 'empowerSpeedMult';

/** 衝刺參數數值表 */
export type DashParams = Record<DashParamKey, number>;

/** 衝刺參數的編輯定義 */
export const DASH_PARAM_DEFS: Readonly<Record<DashParamKey, ParamDef<DashParamKey>>> = {
  dashDistance: {
    key: 'dashDistance', label: '衝刺距離', unit: 'px', hint: '同時是鎖敵範圍',
    min: 60, max: 400, step: 10, defaultValue: GameConfig.slow.dashDistance
  },
  dashSpeed: {
    key: 'dashSpeed', label: '衝刺速度', unit: '', hint: '每秒像素',
    min: 200, max: 1500, step: 20, defaultValue: GameConfig.slow.dashSpeed
  },
  empowerDistanceMult: {
    key: 'empowerDistanceMult', label: '強化衝刺距離倍率', unit: '×', hint: '二段變身中衝刺距離再乘上',
    min: 1, max: 3, step: 0.05, defaultValue: GameConfig.combo.empower.moveMult
  },
  empowerSpeedMult: {
    key: 'empowerSpeedMult', label: '強化衝刺速度倍率', unit: '×', hint: '二段變身中衝刺速度再乘上',
    min: 1, max: 3, step: 0.05, defaultValue: GameConfig.combo.empower.dashSpeedMult
  }
};

/** 一般衝刺頁 / 強化衝刺頁各自顯示的衝刺參數 */
export const PIERCE_DASH_KEYS: ReadonlyArray<DashParamKey> = ['dashDistance', 'dashSpeed'];
export const EMPOWER_DASH_KEYS: ReadonlyArray<DashParamKey> = ['empowerDistanceMult', 'empowerSpeedMult'];

/** 倍率類參數存檔與顯示的小數位數（每格 0.05，避免浮點誤差累積成 1.4000000001） */
const DECIMALS = 2;

const store = createParamStore(Object.values(DASH_PARAM_DEFS), 'douqi.dashParams.v1');
let params = store.load();

/** 目前的衝刺參數 */
export function dashParams(): Readonly<DashParams> {
  return params;
}

/**
 * 設定一項衝刺參數（夾在合法範圍、四捨五入到 DECIMALS 位）並存檔
 *
 * @param key 參數
 * @param value 數值
 */
export function setDashParam(key: DashParamKey, value: number): void {
  const factor = 10 ** DECIMALS;
  params = { ...params, [key]: Math.round(store.clamp(DASH_PARAM_DEFS[key], value) * factor) / factor };
  store.save(params);
}

/**
 * 幾項衝刺參數恢復預設
 *
 * @param keys 參數
 */
export function resetDashParams(keys: ReadonlyArray<DashParamKey>): void {
  for (const key of keys) setDashParam(key, DASH_PARAM_DEFS[key].defaultValue);
}

/**
 * 套用一份衝刺參數（匯入 / A/B 比較）：有列出的項目逐項夾在合法範圍內套用，其他維持不變
 *
 * @param data 衝刺參數（dashParams 的格式）
 * @returns 是否有套用任何一項
 */
export function applyDashParams(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<Record<DashParamKey, unknown>>;
  let applied = false;
  for (const key of Object.keys(DASH_PARAM_DEFS) as DashParamKey[]) {
    const value = d[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    setDashParam(key, value);
    applied = true;
  }
  return applied;
}

/** 重新讀取存檔 */
export function reloadDashParams(): void {
  params = store.load();
}
