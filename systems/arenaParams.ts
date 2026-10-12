import { GameConfig } from '../config';
import { createParamStore, type ParamDef, type ParamValues } from './paramStore';

/**
 * 地圖邊界參數（主選單「地圖邊界編輯器」可調整，關卡制套用）：玩家可活動範圍在每一格背景（2520 × SLOT_HEIGHT）中的上 / 下邊界。
 *
 * - 預設值取自 config.stage.sceneMarginTop / sceneMarginBottom；左右維持貼齊（左右平移換區需要）
 * - 背景格高度固定（= 預設的 arenaH + 上下邊距），調整邊界只改變活動範圍的高度，活動範圍至少 MIN_ARENA_HEIGHT
 * - 每局開始時讀取（SlotWorldController 建立三格佈局時）
 */

/** 可調整的地圖邊界參數鍵 */
export type ArenaParamKey = 'marginTop' | 'marginBottom';

/** 地圖邊界參數數值表 */
export type ArenaParams = ParamValues<ArenaParamKey>;

/** 單一參數的編輯定義 */
export type ArenaParamDef = ParamDef<ArenaParamKey>;

const st = GameConfig.stage;

/** 每一格背景的高度（世界像素，固定）：預設活動範圍高度 + 上下邊距 */
export const SLOT_HEIGHT = st.arenaH + st.sceneMarginTop + st.sceneMarginBottom;

/** 活動範圍的最小高度（避免調到無法遊玩） */
export const MIN_ARENA_HEIGHT = 500;

/** 調整幅度（像素） */
const STEP_PX = 8;

/** 編輯器顯示順序與各參數的範圍定義 */
export const ARENA_PARAM_DEFS: ReadonlyArray<ArenaParamDef> = [
  { key: 'marginTop', label: '上邊界', unit: 'px', hint: '背景上緣往下', min: 0, max: SLOT_HEIGHT - MIN_ARENA_HEIGHT, step: STEP_PX, defaultValue: st.sceneMarginTop },
  { key: 'marginBottom', label: '下邊界', unit: 'px', hint: '背景下緣往上', min: 0, max: SLOT_HEIGHT - MIN_ARENA_HEIGHT, step: STEP_PX, defaultValue: st.sceneMarginBottom }
];

/** 存檔鍵 */
const STORAGE_KEY = 'douqi.arenaParams.v1';

const store = createParamStore(ARENA_PARAM_DEFS, STORAGE_KEY);

/** 取得一份全部為預設值的地圖邊界參數 */
export const defaultArenaParams = (): ArenaParams => store.defaults();

/**
 * 將數值夾在該參數的合法範圍內；非數字時回傳預設值
 *
 * @param def 參數定義
 * @param value 原始數值
 */
export const clampArenaParam = (def: ArenaParamDef, value: unknown): number => store.clamp(def, value);

/**
 * 讓上下邊界留下至少 MIN_ARENA_HEIGHT 的活動範圍：超過時縮減另一側（keep 指定的那一側不動）
 *
 * @param values 地圖邊界參數（會被修改）
 * @param keep 剛調整、要保留的那一側
 */
export function fitArenaParams(values: ArenaParams, keep: ArenaParamKey = 'marginTop'): ArenaParams {
  const excess = values.marginTop + values.marginBottom - (SLOT_HEIGHT - MIN_ARENA_HEIGHT);
  if (excess > 0) {
    if (keep === 'marginTop') values.marginBottom = Math.max(0, values.marginBottom - excess);
    else values.marginTop = Math.max(0, values.marginTop - excess);
  }
  return values;
}

/** 讀取已儲存的地圖邊界參數（每項夾在合法範圍、活動範圍至少 MIN_ARENA_HEIGHT） */
export const loadArenaParams = (): ArenaParams => fitArenaParams(store.load());

/**
 * 儲存地圖邊界參數到 localStorage（只存與預設不同的項目；全部等於預設時移除存檔）
 *
 * @param params 要儲存的參數
 */
export const saveArenaParams = (params: ArenaParams): void => store.save(fitArenaParams({ ...params }));
