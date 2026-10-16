import { ATTACK_MOVES, HIT_POINT_FIELDS, applyAttackTuning, attackTuningSnapshot, type HitPoint } from './attackTuningParams';
import { CRATE_LAYOUT_DEFS, CRATE_SHAPES, applyCrateLayout, crateLayout, type CrateLayout } from './crateLayoutParams';
import { MOVE_FEEL_DEFS, applyMoveFeel, moveFeel, type MoveFeel } from './moveFeelParams';
import { DASH_PARAM_DEFS, applyDashParams, dashParams, type DashParamKey, type DashParams } from './dashParams';
import { HIT_SHAPE_LABELS, type HitShape } from './hitShapes';
import { MONSTER_KINDS, applyMonsterAttacks, monsterAttackSnapshot, monsterFieldDefs, type MonsterAttack, type MonsterKind } from './monsterAttackParams';

/**
 * 範圍 / 判定編輯器的整份設定（我方各招的打擊點、近戰觸發距離、衝刺參數、各怪種的攻擊設定、木箱排列、移動手感）：
 * 匯出 / 匯入 JSON 與 A / B 兩組設定的存放、套用、比較
 */

/** 整份設定（匯出的 JSON 格式） */
export interface TuningSettings {
  moveTimelines: Record<string, ReadonlyArray<HitPoint>>;
  meleeEnemyRange: number;
  /** 衝刺參數（較早存的 A / B 沒有這一項） */
  dash?: Readonly<DashParams>;
  monsterAttacks: Readonly<Record<MonsterKind, MonsterAttack>>;
  /** 木箱排列（較早存的 A / B 沒有這一項） */
  crateLayout?: Readonly<CrateLayout>;
  /** 移動手感（較早存的 A / B 沒有這一項） */
  moveFeel?: Readonly<MoveFeel>;
}

/** 套用一份設定的結果：套用了幾招、幾種怪、是否含近戰觸發距離 / 衝刺參數 / 木箱排列 / 移動手感 */
export interface ApplyResult {
  moves: number;
  monsters: number;
  meleeRange: boolean;
  dash: boolean;
  crate: boolean;
  feel: boolean;
}

/** 比較用的兩組設定 */
export type TuningSlot = 'A' | 'B';
export const TUNING_SLOTS: ReadonlyArray<TuningSlot> = ['A', 'B'];

/** A / B 兩組設定的 localStorage 存檔鍵 */
const SLOT_STORAGE_KEY = 'douqi.tuningSlots.v1';

/** 目前生效的整份設定（深複製，之後調整不會改到它） */
export function currentSettings(): TuningSettings {
  return JSON.parse(JSON.stringify({ ...attackTuningSnapshot(), dash: dashParams(), monsterAttacks: monsterAttackSnapshot(), crateLayout: crateLayout(), moveFeel: moveFeel() })) as TuningSettings;
}

/**
 * 套用一份設定（匯入的 JSON 或 A / B）：有列出的招式 / 怪種、近戰觸發距離與衝刺參數換成它的，其他維持不變；數值逐欄夾在合法範圍內
 *
 * @param data 設定
 */
export function applySettings(data: unknown): ApplyResult {
  const tuning = applyAttackTuning(data);
  const d = data as { monsterAttacks?: unknown; dash?: unknown; crateLayout?: unknown; moveFeel?: unknown } | null;
  const monsters = applyMonsterAttacks(d?.monsterAttacks);
  return { ...tuning, monsters, dash: applyDashParams(d?.dash), crate: applyCrateLayout(d?.crateLayout), feel: applyMoveFeel(d?.moveFeel) };
}

/**
 * 解析匯入的 JSON 文字並套用
 *
 * @param text JSON 文字
 * @returns 套用結果；格式錯誤或什麼都沒套用時為 null
 */
export function importSettings(text: string): ApplyResult | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const result = applySettings(data);
  return result.moves + result.monsters > 0 || result.meleeRange || result.dash || result.crate || result.feel ? result : null;
}

/** 讀取 A / B 存檔（無法讀取時為空） */
function loadSlots(): Partial<Record<TuningSlot, TuningSettings>> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SLOT_STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<TuningSlot, TuningSettings>>) : {};
  } catch {
    return {};
  }
}

/**
 * 一組比較用設定（沒存過為 null）
 *
 * @param slot A / B
 */
export function slotSettings(slot: TuningSlot): TuningSettings | null {
  return loadSlots()[slot] ?? null;
}

/**
 * 把目前的設定存成 A / B（無法寫入時忽略）
 *
 * @param slot A / B
 */
export function saveSlot(slot: TuningSlot): void {
  const slots = loadSlots();
  slots[slot] = currentSettings();
  try {
    window.localStorage.setItem(SLOT_STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // 無法寫入（無痕模式 / 封鎖儲存）：不影響遊戲
  }
}

/**
 * 套用 A / B
 *
 * @param slot A / B
 * @returns 是否有存過、已套用
 */
export function applySlot(slot: TuningSlot): boolean {
  const settings = slotSettings(slot);
  if (!settings) return false;
  applySettings(settings);
  return true;
}

/** 打擊點欄位的比較順序（範圍以外） */
const POINT_FIELDS = ['timeMs', 'durationMs', 'damagePct', 'pauseMs'] as const;
/** 範圍欄位的比較順序 */
const SHAPE_FIELDS = ['offsetForward', 'offsetSide', 'radius', 'arcDeg', 'length', 'width'] as const;
/** 怪物數值欄位的比較順序 */
const MONSTER_FIELDS = ['engage', 'chargeMs', 'cooldownMs', 'damage'] as const;

/**
 * 兩個範圍的差異（形狀不同時只列形狀，尺寸意義不同不逐欄比）
 *
 * @param prefix 列的開頭（招式 / 怪種名稱）
 * @param a A 的範圍
 * @param b B 的範圍
 */
function diffShape(prefix: string, a: HitShape | undefined, b: HitShape | undefined): string[] {
  if (!a || !b) return [];
  if (a.kind !== b.kind) return [`${prefix} 形狀：${HIT_SHAPE_LABELS[a.kind]} ｜ ${HIT_SHAPE_LABELS[b.kind]}`];
  return SHAPE_FIELDS.filter((f) => a[f] !== b[f]).map((f) => `${prefix} ${HIT_POINT_FIELDS[f].label}：${a[f]} ｜ ${b[f]}`);
}

/**
 * 列出 A、B 兩組設定的差異（每列「名稱 欄位：A 的值 ｜ B 的值」；打擊點數不同時只列數量）
 *
 * @param a A
 * @param b B
 */
export function diffSettings(a: TuningSettings, b: TuningSettings): string[] {
  const lines: string[] = [];
  for (const { move, label } of ATTACK_MOVES) {
    const pa = a.moveTimelines[move] ?? [], pb = b.moveTimelines[move] ?? [];
    if (pa.length !== pb.length) {
      lines.push(`${label} 打擊點數：${pa.length} ｜ ${pb.length}`);
      continue;
    }
    pa.forEach((p, i) => {
      const q = pb[i];
      const prefix = pa.length > 1 ? `${label} #${i + 1}` : label;
      for (const f of POINT_FIELDS) if (p[f] !== q[f]) lines.push(`${prefix} ${HIT_POINT_FIELDS[f].label}：${p[f]} ｜ ${q[f]}`);
      lines.push(...diffShape(prefix, p.shape, q.shape));
    });
  }
  if (a.meleeEnemyRange !== b.meleeEnemyRange) lines.push(`近戰觸發距離：${a.meleeEnemyRange} ｜ ${b.meleeEnemyRange}`);
  if (a.dash && b.dash) {
    for (const key of Object.keys(DASH_PARAM_DEFS) as DashParamKey[]) {
      if (a.dash[key] !== b.dash[key]) lines.push(`${DASH_PARAM_DEFS[key].label}：${a.dash[key]} ｜ ${b.dash[key]}`);
    }
  }
  if (a.crateLayout && b.crateLayout) {
    for (const def of CRATE_LAYOUT_DEFS) {
      const va = a.crateLayout[def.key], vb = b.crateLayout[def.key];
      if (va === vb) continue;
      const show = (v: number): string | number => (def.key === 'shape' ? CRATE_SHAPES[v] ?? v : v);
      lines.push(`木箱${def.label}：${show(va)} ｜ ${show(vb)}`);
    }
  }
  if (a.moveFeel && b.moveFeel) {
    for (const def of MOVE_FEEL_DEFS) {
      if (a.moveFeel[def.key] !== b.moveFeel[def.key]) lines.push(`${def.label}：${a.moveFeel[def.key]} ｜ ${b.moveFeel[def.key]}`);
    }
  }
  for (const { kind, label } of MONSTER_KINDS) {
    const ma = a.monsterAttacks?.[kind], mb = b.monsterAttacks?.[kind];
    if (!ma || !mb) continue;
    const defs = monsterFieldDefs(kind);
    for (const f of MONSTER_FIELDS) if (ma[f] !== mb[f]) lines.push(`${label} ${defs[f].label}：${ma[f]} ｜ ${mb[f]}`);
    lines.push(...diffShape(label, ma.shape, mb.shape));
  }
  return lines;
}
