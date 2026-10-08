import { GameConfig } from '../config';
import { createParamStore, type ParamDef } from './paramStore';

/**
 * 角色參數（主選單「角色編輯器」可調整，慢速模式套用於 P1 與 BOT）。
 *
 * - 預設值取自 config 的 slow.attackCooldownMs / moveSpeed / dashSpeed / dashDistance / vacuumRadius / vacuumFlatten / vacuumOffsetX / vacuumOffsetY
 * - 編輯後只存跟預設不同的項目到瀏覽器 localStorage，重新整理仍保留；讀取時會夾在合法範圍內，資料損壞則回到預設
 * - 結構或預設語意大改時升版，舊存檔自動失效
 * - 快速模式不受影響（仍讀 config 常數）
 */

/** 可調整的角色參數鍵 */
export type CharacterParamKey = 'attackCooldownMs' | 'moveSpeed' | 'dashSpeed' | 'dashDistance' | 'vacuumRadius' | 'vacuumFlatten' | 'vacuumOffsetY' | 'vacuumOffsetX';

/** 角色參數數值表 */
export type CharacterParams = Record<CharacterParamKey, number>;

/** 單一參數的編輯定義（見 ParamDef） */
export type CharacterParamDef = ParamDef<CharacterParamKey>;

/** 編輯器顯示順序與各參數的範圍定義 */
export const CHARACTER_PARAM_DEFS: ReadonlyArray<CharacterParamDef> = [
  {
    key: 'attackCooldownMs', label: '普攻攻擊間隔', unit: 'ms', hint: '越小越快',
    min: 100, max: 800, step: 20, defaultValue: GameConfig.slow.attackCooldownMs
  },
  {
    key: 'moveSpeed', label: '移動速度', unit: '', hint: '',
    min: 100, max: 500, step: 10, defaultValue: GameConfig.slow.moveSpeed
  },
  {
    key: 'dashSpeed', label: '衝刺速度', unit: '', hint: '',
    min: 200, max: 1500, step: 20, defaultValue: GameConfig.slow.dashSpeed
  },
  {
    key: 'dashDistance', label: '衝刺距離', unit: 'px', hint: '',
    min: 60, max: 400, step: 10, defaultValue: GameConfig.slow.dashDistance
  },
  {
    key: 'vacuumRadius', label: '真空圈大小', unit: 'px', hint: '',
    min: 30, max: 150, step: 5, defaultValue: GameConfig.slow.vacuumRadius
  },
  {
    key: 'vacuumFlatten', label: '真空圈扁度', unit: '', hint: '越小越扁',
    min: 0.2, max: 1.0, step: 0.05, defaultValue: GameConfig.slow.vacuumFlatten
  },
  {
    key: 'vacuumOffsetY', label: '真空圈上下偏移', unit: 'px', hint: '負=上',
    min: -60, max: 60, step: 2, defaultValue: GameConfig.slow.vacuumOffsetY
  },
  {
    key: 'vacuumOffsetX', label: '真空圈左右偏移', unit: 'px', hint: '負=左',
    min: -60, max: 60, step: 2, defaultValue: GameConfig.slow.vacuumOffsetX
  }
];

/** localStorage 存檔鍵（只存與預設不同的項目；結構或預設語意大改時升版） */
const STORAGE_KEY = 'douqi.characterParams.v2';

/** 舊版存檔鍵，需要清除避免殘留 */
const LEGACY_STORAGE_KEYS = ['douqi.characterParams.v1'];

const store = createParamStore(CHARACTER_PARAM_DEFS, STORAGE_KEY, LEGACY_STORAGE_KEYS);

/** 取得一份全部為預設值的角色參數 */
export const defaultCharacterParams = (): CharacterParams => store.defaults();

/**
 * 將數值夾在該參數的合法範圍內；非數字時回傳預設值
 *
 * @param def 參數定義
 * @param value 原始數值
 */
export const clampCharacterParam = (def: CharacterParamDef, value: unknown): number => store.clamp(def, value);

/** 讀取已儲存的角色參數；沒有存檔、無法存取 localStorage 或資料損壞時，對應項目回到預設值 */
export const loadCharacterParams = (): CharacterParams => store.load();

/**
 * 儲存角色參數到 localStorage（只存與預設不同的項目；全部等於預設時移除存檔）
 *
 * @param params 要儲存的角色參數
 */
export const saveCharacterParams = (params: CharacterParams): void => store.save(params);

/** 清除已儲存的角色參數（恢復預設） */
export const clearCharacterParams = (): void => store.clear();
