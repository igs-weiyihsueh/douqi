import { GameConfig } from '../config';
import { createParamStore, type ParamDef } from './paramStore';

/**
 * 移動手感參數（招式編輯器的「移動手感」頁可調整，調整後立即生效）。
 *
 * - 走路動畫基準速度：以這個速度（像素 / 秒）移動時走路動畫照原速播放；實際走得慢，腳步就放慢，走得快就加快（播放速度 = 實際速度 ÷ 基準速度），
 *   腳步和位移對得上，不會像在地上滑。P1 與各 Spine 怪種各一個
 * - P1 起步 / 停下：從靜止加速到全速、從全速減到停下各花多少毫秒（0 = 立刻）
 * - 衝刺蓄力（慢速模式）：衝刺前原地停住並壓扁身體多久（撿道具的衝刺不蓄力）；衝刺速度依已衝距離的比例，從初速倍率線性降到結尾倍率，
 *   衝刺距離不變（1.8 → 0.5 時總時間跟等速差不多，但起步有蹬出去的爆發感）
 * - 預設值取自 GameConfig.moveFeel；只存跟預設不同的項目，每局開始（GameScene.resetState）重新讀取
 */

/** 移動手感參數鍵 */
export type MoveFeelKey = 'playerWalkAnimSpeed' | 'normalWalkAnimSpeed' | 'tankWalkAnimSpeed' | 'playerAccelMs' | 'playerDecelMs'
  | 'dashWindupMs' | 'dashWindupSquash' | 'dashStartSpeedMult' | 'dashEndSpeedMult';

/** 移動手感參數數值表 */
export type MoveFeel = Record<MoveFeelKey, number>;

const cfg = GameConfig.moveFeel;

/** 移動手感參數的編輯定義（編輯器顯示順序） */
export const MOVE_FEEL_DEFS: ReadonlyArray<ParamDef<MoveFeelKey>> = [
  { key: 'playerWalkAnimSpeed', label: 'P1 走路動畫基準速度', unit: 'px/s', hint: '這個速度時腳步照原速播放', min: 50, max: 1000, step: 10, defaultValue: cfg.playerWalkAnimSpeed },
  { key: 'playerAccelMs', label: 'P1 起步加速時間', unit: 'ms', hint: '0 = 一按就全速', min: 0, max: 400, step: 10, defaultValue: cfg.playerAccelMs },
  { key: 'playerDecelMs', label: 'P1 停下減速時間', unit: 'ms', hint: '0 = 一放就停', min: 0, max: 400, step: 10, defaultValue: cfg.playerDecelMs },
  { key: 'normalWalkAnimSpeed', label: '一般兵走路動畫基準速度', unit: 'px/s', hint: '', min: 20, max: 400, step: 5, defaultValue: cfg.enemyWalkAnimSpeed.normal },
  { key: 'tankWalkAnimSpeed', label: '大怪走路動畫基準速度', unit: 'px/s', hint: '', min: 20, max: 400, step: 5, defaultValue: cfg.enemyWalkAnimSpeed.tank },
  { key: 'dashWindupMs', label: '衝刺蓄力時間', unit: 'ms', hint: '衝出前原地停住多久（0 = 不蓄力）', min: 0, max: 300, step: 10, defaultValue: cfg.dashWindupMs },
  { key: 'dashWindupSquash', label: '衝刺蓄力壓扁', unit: '', hint: '蓄力時身體壓扁幅度', min: 0, max: 0.4, step: 0.02, defaultValue: cfg.dashWindupSquash },
  { key: 'dashStartSpeedMult', label: '衝刺初速倍率', unit: '×', hint: '剛衝出時 = 衝刺速度 × 此倍率', min: 0.5, max: 3, step: 0.05, defaultValue: cfg.dashStartSpeedMult },
  { key: 'dashEndSpeedMult', label: '衝刺結尾倍率', unit: '×', hint: '到終點前降到 衝刺速度 × 此倍率', min: 0.1, max: 2, step: 0.05, defaultValue: cfg.dashEndSpeedMult }
];

/** 參數存檔與顯示的小數位數（倍率每格 0.05、壓扁每格 0.02，避免浮點誤差累積） */
const DECIMALS = 2;

const store = createParamStore(MOVE_FEEL_DEFS, 'douqi.moveFeel.v1');
let feel = store.load();

/** 目前的移動手感參數 */
export function moveFeel(): Readonly<MoveFeel> {
  return feel;
}

/**
 * 走路動畫的播放速度倍率：實際速度 ÷ 基準速度，夾在 GameConfig.moveFeel.walkAnimScaleRange 內
 *
 * @param speed 實際移動速度（像素 / 秒）
 * @param baseSpeed 走路動畫基準速度（像素 / 秒）
 */
export function walkAnimScale(speed: number, baseSpeed: number): number {
  const [min, max] = GameConfig.moveFeel.walkAnimScaleRange;
  return Math.min(max, Math.max(min, speed / Math.max(1, baseSpeed)));
}

/**
 * 某 Spine 怪種的走路動畫基準速度（沒有設定的怪種回傳 null，照原速播放）
 *
 * @param type Spine 怪種
 */
export function enemyWalkAnimSpeed(type: string): number | null {
  if (type === 'normal') return feel.normalWalkAnimSpeed;
  if (type === 'tank') return feel.tankWalkAnimSpeed;
  return null;
}

/**
 * 衝刺速度倍率：依已衝距離的比例（0 = 起點、1 = 終點）從初速倍率線性降到結尾倍率
 *
 * @param progress 已衝距離 ÷ 總距離
 */
export function dashSpeedCurve(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return feel.dashStartSpeedMult + (feel.dashEndSpeedMult - feel.dashStartSpeedMult) * t;
}

/**
 * 設定一項移動手感參數（夾在合法範圍內、四捨五入到 DECIMALS 位）並存檔
 *
 * @param key 參數
 * @param value 數值
 */
export function setMoveFeelParam(key: MoveFeelKey, value: number): void {
  const def = MOVE_FEEL_DEFS.find((d) => d.key === key)!;
  const factor = 10 ** DECIMALS;
  feel = { ...feel, [key]: Math.round(store.clamp(def, value) * factor) / factor };
  store.save(feel);
}

/** 全部恢復預設 */
export function resetMoveFeel(): void {
  feel = store.defaults();
  store.save(feel);
}

/**
 * 套用一份移動手感參數（匯入 / A/B 比較）：有列出的項目逐項夾在合法範圍內套用，其他維持不變
 *
 * @param data 移動手感參數（moveFeel 的格式）
 * @returns 是否有套用任何一項
 */
export function applyMoveFeel(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<Record<MoveFeelKey, unknown>>;
  let applied = false;
  for (const { key } of MOVE_FEEL_DEFS) {
    const value = d[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    setMoveFeelParam(key, value);
    applied = true;
  }
  return applied;
}

/** 重新讀取存檔 */
export function reloadMoveFeel(): void {
  feel = store.load();
}
