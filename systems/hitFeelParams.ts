import { GameConfig } from '../config';
import { createParamStore, type ParamDef, type ParamValues } from './paramStore';

/**
 * 打擊感參數（主選單「打擊感編輯器」可調整，快速 / 慢速模式都套用）。
 *
 * - 預設值取自 config 的 hitstop / juice（enemyFlashMs、hitReaction、hitSpark）/ cutIn
 * - 開關類參數以 0 / 1 表示
 * - 遊戲中透過 hitFeel() 讀取目前值；每局開始（GameScene.resetState）與編輯器儲存時重新讀取存檔，
 *   編輯器預覽時以 setHitFeel 暫時套用未儲存的數值
 */

/** 可調整的打擊感參數鍵 */
export type HitFeelKey =
  | 'hitstopEnabled' | 'freezeMs' | 'maxFreezeMs' | 'freezeCooldownMs'
  | 'enemyFlashMs' | 'reactionMs' | 'squash' | 'jitterPx' | 'jitterCycles'
  | 'sparkCount' | 'sparkConeDeg' | 'sparkSpeedMax' | 'sparkLifespanMs' | 'sparkScale'
  | 'cutInEnabled' | 'cutInMs' | 'cutInSpeedRatio' | 'streakEnabled';

/** 打擊感參數數值表 */
export type HitFeelParams = ParamValues<HitFeelKey>;

/** 單一參數的編輯定義 */
export type HitFeelParamDef = ParamDef<HitFeelKey>;

/** 參數分組（編輯器分頁 / 分段顯示用） */
export interface HitFeelGroup {
  title: string;
  keys: ReadonlyArray<HitFeelKey>;
}

const cfgJuice = GameConfig.juice;

/** 編輯器顯示順序與各參數的範圍定義 */
export const HIT_FEEL_PARAM_DEFS: ReadonlyArray<HitFeelParamDef> = [
  // 命中凍結（只凍結被打的怪；會改變遊戲節奏）
  { key: 'hitstopEnabled', label: '命中凍結', unit: '', hint: '0 關 / 1 開', min: 0, max: 1, step: 1, defaultValue: GameConfig.hitstop.enabled ? 1 : 0 },
  { key: 'freezeMs', label: '凍結時間', unit: 'ms', hint: '越大越頓', min: 0, max: 150, step: 5, defaultValue: GameConfig.hitstop.freezeMs },
  { key: 'maxFreezeMs', label: '連打凍結上限', unit: 'ms', hint: '', min: 0, max: 300, step: 10, defaultValue: GameConfig.hitstop.maxFreezeMs },
  { key: 'freezeCooldownMs', label: '凍結冷卻', unit: 'ms', hint: '防圍毆定住', min: 0, max: 400, step: 10, defaultValue: GameConfig.hitstop.cooldownMs },
  // 受擊反應（純視覺）
  { key: 'enemyFlashMs', label: '受擊閃白', unit: 'ms', hint: '', min: 0, max: 200, step: 10, defaultValue: cfgJuice.enemyFlashMs },
  { key: 'reactionMs', label: '受擊反應時間', unit: 'ms', hint: '', min: 0, max: 300, step: 10, defaultValue: cfgJuice.hitReaction.durationMs },
  { key: 'squash', label: '壓扁幅度', unit: '', hint: '越大越 Q', min: 0, max: 0.4, step: 0.02, defaultValue: cfgJuice.hitReaction.squash },
  { key: 'jitterPx', label: '抖動幅度', unit: 'px', hint: '', min: 0, max: 10, step: 1, defaultValue: cfgJuice.hitReaction.jitterPx },
  { key: 'jitterCycles', label: '抖動次數', unit: '', hint: '來回', min: 1, max: 5, step: 1, defaultValue: cfgJuice.hitReaction.jitterCycles },
  // 命中火花（純視覺；強化攻擊顆數 × empoweredCountMult）
  { key: 'sparkCount', label: '火花數量', unit: '顆', hint: '強化加倍', min: 0, max: 20, step: 1, defaultValue: cfgJuice.hitSpark.count },
  { key: 'sparkConeDeg', label: '火花角度', unit: '°', hint: '越大越散', min: 10, max: 180, step: 10, defaultValue: cfgJuice.hitSpark.coneDeg },
  { key: 'sparkSpeedMax', label: '火花速度', unit: '', hint: '噴多遠', min: 100, max: 800, step: 20, defaultValue: cfgJuice.hitSpark.speedMax },
  { key: 'sparkLifespanMs', label: '火花時間', unit: 'ms', hint: '', min: 100, max: 500, step: 10, defaultValue: cfgJuice.hitSpark.lifespanMs },
  { key: 'sparkScale', label: '火花大小', unit: '', hint: '', min: 0.4, max: 3, step: 0.1, defaultValue: cfgJuice.hitSpark.scale },
  // 衝刺切入（只影響攻擊者自己）+ 刀光
  { key: 'cutInEnabled', label: '衝刺切入', unit: '', hint: '0 關 / 1 開', min: 0, max: 1, step: 1, defaultValue: GameConfig.cutIn.enabled ? 1 : 0 },
  { key: 'cutInMs', label: '陷入時間', unit: 'ms', hint: '', min: 0, max: 150, step: 5, defaultValue: GameConfig.cutIn.durationMs },
  { key: 'cutInSpeedRatio', label: '陷入速度', unit: '', hint: '越小越卡', min: 0, max: 0.6, step: 0.05, defaultValue: GameConfig.cutIn.speedRatio },
  { key: 'streakEnabled', label: '刀光', unit: '', hint: '0 關 / 1 開', min: 0, max: 1, step: 1, defaultValue: GameConfig.cutIn.streakEnabled ? 1 : 0 }
];

/** 編輯器分組 */
export const HIT_FEEL_GROUPS: ReadonlyArray<HitFeelGroup> = [
  { title: '命中凍結', keys: ['hitstopEnabled', 'freezeMs', 'maxFreezeMs', 'freezeCooldownMs'] },
  { title: '受擊反應', keys: ['enemyFlashMs', 'reactionMs', 'squash', 'jitterPx', 'jitterCycles'] },
  { title: '命中火花', keys: ['sparkCount', 'sparkConeDeg', 'sparkSpeedMax', 'sparkLifespanMs', 'sparkScale'] },
  { title: '衝刺切入', keys: ['cutInEnabled', 'cutInMs', 'cutInSpeedRatio', 'streakEnabled'] }
];

/** 預設組合：以預設值為底，覆蓋列出的項目 */
export const HIT_FEEL_PRESETS: ReadonlyArray<{ name: string; values: Partial<HitFeelParams> }> = [
  { name: '重擊', values: { freezeMs: 80, maxFreezeMs: 160, squash: 0.26, jitterPx: 5, sparkCount: 12, sparkScale: 1.6, cutInMs: 90, cutInSpeedRatio: 0.15 } },
  { name: '爽快', values: { freezeMs: 40, maxFreezeMs: 100, squash: 0.16, sparkCount: 10, sparkSpeedMax: 480, sparkLifespanMs: 180, cutInMs: 50, cutInSpeedRatio: 0.35 } },
  { name: '溫和', values: { freezeMs: 30, maxFreezeMs: 80, enemyFlashMs: 80, squash: 0.1, jitterPx: 2, sparkCount: 5, sparkScale: 1, cutInMs: 40, cutInSpeedRatio: 0.4 } }
];

/** localStorage 存檔鍵（只存與預設不同的項目；結構或語意大改時升版） */
const STORAGE_KEY = 'douqi.hitFeel.v1';

/** 打擊感參數的讀寫介面（編輯器使用） */
export const hitFeelStore = createParamStore(HIT_FEEL_PARAM_DEFS, STORAGE_KEY);

/** 目前生效的打擊感參數（每局開始 / 編輯器儲存時重新讀取） */
let current: HitFeelParams = hitFeelStore.load();

/** 目前生效的打擊感參數 */
export function hitFeel(): Readonly<HitFeelParams> {
  return current;
}

/** 重新讀取存檔，更新目前生效的打擊感參數 */
export function reloadHitFeel(): void {
  current = hitFeelStore.load();
}

/**
 * 暫時改用指定的打擊感參數（編輯器即時預覽未儲存的數值用；取消時呼叫 reloadHitFeel 還原）
 *
 * @param values 要生效的參數
 */
export function setHitFeel(values: HitFeelParams): void {
  current = { ...values };
}

/**
 * 以預設值為底套用預設組合
 *
 * @param preset 預設組合的覆蓋項目
 */
export function applyHitFeelPreset(preset: Partial<HitFeelParams>): HitFeelParams {
  return { ...hitFeelStore.defaults(), ...preset };
}
