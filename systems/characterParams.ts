import { GameConfig } from '../config';

/**
 * 角色參數（主選單「角色編輯器」可調整，慢速模式套用於 P1 與 BOT）。
 *
 * - 預設值取自 config（player.attackCooldownMs、slow.moveSpeed / dashSpeed / dashDistance）
 * - 編輯後存在瀏覽器 localStorage，重新整理仍保留；讀取時會夾在合法範圍內，資料損壞則回到預設
 * - 快速模式不受影響（仍讀 config 常數）
 */

/** 可調整的角色參數鍵 */
export type CharacterParamKey = 'attackCooldownMs' | 'moveSpeed' | 'dashSpeed' | 'dashDistance';

/** 角色參數數值表 */
export type CharacterParams = Record<CharacterParamKey, number>;

/** 單一參數的編輯定義：顯示名稱、單位、調整範圍與每格幅度 */
export interface CharacterParamDef {
  key: CharacterParamKey;
  /** 編輯器顯示名稱 */
  label: string;
  /** 數值單位（顯示用） */
  unit: string;
  /** 補充說明（顯示在名稱旁） */
  hint: string;
  min: number;
  max: number;
  /** 每次 −/+ 或方向鍵調整的幅度 */
  step: number;
  /** 預設值（取自 config） */
  defaultValue: number;
}

/** 編輯器顯示順序與各參數的範圍定義 */
export const CHARACTER_PARAM_DEFS: ReadonlyArray<CharacterParamDef> = [
  {
    key: 'attackCooldownMs', label: '普攻攻擊間隔', unit: 'ms', hint: '越小越快',
    min: 100, max: 800, step: 20, defaultValue: GameConfig.player.attackCooldownMs
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
  }
];

/** localStorage 存檔鍵（結構變更時改版號，舊存檔自動失效） */
const STORAGE_KEY = 'douqi.characterParams.v1';

/** 取得一份全部為預設值的角色參數 */
export function defaultCharacterParams(): CharacterParams {
  const params = {} as CharacterParams;
  for (const def of CHARACTER_PARAM_DEFS) params[def.key] = def.defaultValue;
  return params;
}

/**
 * 將數值夾在該參數的合法範圍內；非數字時回傳預設值
 *
 * @param def 參數定義
 * @param value 原始數值
 * @returns 合法的參數值
 */
export function clampCharacterParam(def: CharacterParamDef, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return def.defaultValue;
  return Math.min(def.max, Math.max(def.min, value));
}

/**
 * 讀取已儲存的角色參數；沒有存檔、無法存取 localStorage 或資料損壞時，對應項目回到預設值
 *
 * @returns 角色參數（每項皆已夾在合法範圍）
 */
export function loadCharacterParams(): CharacterParams {
  const params = defaultCharacterParams();
  let saved: Record<string, unknown> = {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return params; // 無痕模式 / 封鎖儲存 / 資料損壞 → 全部用預設
  }
  for (const def of CHARACTER_PARAM_DEFS) {
    if (def.key in saved) params[def.key] = clampCharacterParam(def, saved[def.key]);
  }
  return params;
}

/**
 * 儲存角色參數到 localStorage（無法存取時忽略，參數仍在本次遊戲有效）
 *
 * @param params 要儲存的角色參數
 */
export function saveCharacterParams(params: CharacterParams): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // 無法寫入（無痕模式 / 封鎖儲存）：不影響遊戲
  }
}

/** 清除已儲存的角色參數（恢復預設） */
export function clearCharacterParams(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 無法存取時忽略
  }
}
