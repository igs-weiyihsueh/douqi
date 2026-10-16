import { GameConfig } from '../config';
import { createParamStore, type ParamDef } from './paramStore';

/**
 * 木箱排列參數（招式編輯器的「木箱」頁可調整，調整後下一次落下就套用；招式編輯器可直接在演示區落下一波預覽，跟遊戲同一套落下流程）。
 *
 * - 每波共 total 個，分成每群 groupMin ~ groupMax 個的數群；群中心彼此相隔至少 groupSpacing，同群木箱間隔 groupGap
 * - shape：同一群的排法（見 CRATE_SHAPES）
 * - 預設值取自 GameConfig.breakable.drop；只存跟預設不同的項目，每局開始（GameScene.resetState）重新讀取
 */

/** 木箱排列參數鍵 */
export type CrateLayoutKey = 'total' | 'groupMin' | 'groupMax' | 'groupSpacing' | 'groupGap' | 'shape';

/** 木箱排列參數數值表 */
export type CrateLayout = Record<CrateLayoutKey, number>;

/** 同一群的排法（shape 參數的值 = 索引）：隨機緊貼成一堆 / 排成一橫排 / 排成接近正方形的方陣 */
export const CRATE_SHAPES = ['隨機堆', '橫排', '方陣'] as const;

/** 排法的索引 */
export const CRATE_SHAPE = { CLUSTER: 0, ROW: 1, GRID: 2 } as const;

const drop = GameConfig.breakable.drop;

/** 木箱排列參數的編輯定義（編輯器顯示順序） */
export const CRATE_LAYOUT_DEFS: ReadonlyArray<ParamDef<CrateLayoutKey>> = [
  { key: 'total', label: '每波木箱數', unit: '個', hint: '場上滿 maxAlive 就不再掉', min: 1, max: 30, step: 1, defaultValue: drop.total },
  { key: 'groupMin', label: '每群最少', unit: '個', hint: '', min: 1, max: 10, step: 1, defaultValue: drop.groupSize[0] },
  { key: 'groupMax', label: '每群最多', unit: '個', hint: '', min: 1, max: 10, step: 1, defaultValue: drop.groupSize[1] },
  { key: 'groupSpacing', label: '群間距', unit: 'px', hint: '群中心彼此至少隔多遠', min: 40, max: 400, step: 10, defaultValue: drop.groupSpacing },
  { key: 'groupGap', label: '群內間隔', unit: 'px', hint: '同一群木箱之間的空隙', min: 0, max: 40, step: 2, defaultValue: drop.groupGap },
  { key: 'shape', label: '排法', unit: '', hint: '◀ ▶ 切換', min: 0, max: CRATE_SHAPES.length - 1, step: 1, defaultValue: drop.shape }
];

const store = createParamStore(CRATE_LAYOUT_DEFS, 'douqi.crateLayout.v1');
let layout = store.load();

/** 目前的木箱排列參數 */
export function crateLayout(): Readonly<CrateLayout> {
  return layout;
}

/** 每群木箱數的範圍 [最少, 最多]（兩個參數調反時自動對調） */
export function crateGroupSizeRange(): [number, number] {
  return [Math.min(layout.groupMin, layout.groupMax), Math.max(layout.groupMin, layout.groupMax)];
}

/**
 * 設定一項木箱排列參數（夾在合法範圍內、取整數）並存檔
 *
 * @param key 參數
 * @param value 數值
 */
export function setCrateLayoutParam(key: CrateLayoutKey, value: number): void {
  const def = CRATE_LAYOUT_DEFS.find((d) => d.key === key)!;
  layout = { ...layout, [key]: Math.round(store.clamp(def, value)) };
  store.save(layout);
}

/**
 * 某項參數的顯示文字（排法顯示名稱，其他為數值 + 單位）
 *
 * @param key 參數
 */
export function crateLayoutValueText(key: CrateLayoutKey): string {
  if (key === 'shape') return CRATE_SHAPES[layout.shape] ?? CRATE_SHAPES[0];
  const def = CRATE_LAYOUT_DEFS.find((d) => d.key === key)!;
  return `${layout[key]}${def.unit}`;
}

/** 全部恢復預設 */
export function resetCrateLayout(): void {
  layout = store.defaults();
  store.save(layout);
}

/**
 * 套用一份木箱排列參數（匯入 / A/B 比較）：有列出的項目逐項夾在合法範圍內套用，其他維持不變
 *
 * @param data 木箱排列參數（crateLayout 的格式）
 * @returns 是否有套用任何一項
 */
export function applyCrateLayout(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<Record<CrateLayoutKey, unknown>>;
  let applied = false;
  for (const { key } of CRATE_LAYOUT_DEFS) {
    const value = d[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    setCrateLayoutParam(key, value);
    applied = true;
  }
  return applied;
}

/** 重新讀取存檔 */
export function reloadCrateLayout(): void {
  layout = store.load();
}
