import { GameConfig } from '../config';
import { sanitizeHitShape, type HitPointFieldDef } from './attackTuningParams';
import { placeHitShape, type HitShape, type PlacedHitShape } from './hitShapes';

/**
 * 怪物攻擊參數（木樁模式「範圍 / 判定編輯器」的怪物頁可調整，所有模式都套用；BOSS 另有自己的規則，不在這裡）。
 *
 * - 怪種：一般兵（normal）、大怪（tank）是近戰怪，遠程幽靈（bomber）丟炸彈
 * - 每種怪：攻擊範圍（形狀 / 位置偏移 / 尺寸，同我方招式的判定範圍，見 systems/hitShapes）、出手距離、蓄力時間、冷卻、傷害
 *   - 近戰怪的範圍以怪為基準、朝目標；遠程幽靈的範圍是爆炸範圍，以炸彈落點為基準、朝投擲方向
 *   - 近戰怪的出手距離 = 慢速模式離角色真空圈邊緣多少像素內開始蓄力；遠程幽靈的出手距離 = 投擲距離
 * - 預設值取自 GameConfig.monsterAttack；存成 JSON（只存跟預設不同的怪種），每局開始（GameScene.resetState）重新讀取
 */

/** 可調整的怪種 */
export type MonsterKind = 'normal' | 'tank' | 'bomber';

/** 怪種顯示順序與名稱 */
export const MONSTER_KINDS: ReadonlyArray<{ kind: MonsterKind; label: string }> = [
  { kind: 'normal', label: '一般兵' },
  { kind: 'tank', label: '大怪' },
  { kind: 'bomber', label: '遠程幽靈' }
];

/** 一種怪的攻擊設定 */
export interface MonsterAttack {
  /** 攻擊範圍（近戰：以怪為基準朝目標；遠程：爆炸範圍，以落點為基準朝投擲方向） */
  shape: HitShape;
  /** 出手距離（近戰：離真空圈邊緣的像素；遠程：投擲距離） */
  engage: number;
  /** 蓄力時間（毫秒） */
  chargeMs: number;
  /** 出手後的冷卻（毫秒） */
  cooldownMs: number;
  /** 傷害 */
  damage: number;
}

/** 怪物攻擊的數值欄位（範圍的欄位沿用 HIT_POINT_FIELDS） */
export type MonsterValueField = 'engage' | 'chargeMs' | 'cooldownMs' | 'damage';

/** 近戰怪 / 遠程幽靈各數值欄位的編輯定義（出手距離的意義不同） */
const MELEE_FIELDS: Readonly<Record<MonsterValueField, HitPointFieldDef>> = {
  engage: { label: '出手距離', unit: 'px', hint: '離角色腳下圈邊多近開始蓄力', min: 0, max: 200, step: 5 },
  chargeMs: { label: '蓄力時間', unit: 'ms', hint: '預警填滿多久後出手', min: 100, max: 3000, step: 50 },
  cooldownMs: { label: '攻擊冷卻', unit: 'ms', hint: '出手後多久才能再蓄力', min: 0, max: 6000, step: 100 },
  damage: { label: '傷害', unit: '', hint: '慢速模式 P1 不扣血，只算被打一次', min: 0, max: 200, step: 1 }
};
const BOMBER_FIELDS: Readonly<Record<MonsterValueField, HitPointFieldDef>> = {
  ...MELEE_FIELDS,
  engage: { label: '投擲距離', unit: 'px', hint: '角色在這個距離內才蓄力投擲', min: 100, max: 1000, step: 10 },
  chargeMs: { label: '蓄力時間', unit: 'ms', hint: '鎖定落點後多久丟出', min: 100, max: 3000, step: 50 }
};

/**
 * 怪種的數值欄位編輯定義
 *
 * @param kind 怪種
 */
export function monsterFieldDefs(kind: MonsterKind): Readonly<Record<MonsterValueField, HitPointFieldDef>> {
  return kind === 'bomber' ? BOMBER_FIELDS : MELEE_FIELDS;
}

/**
 * 把數值欄位夾在合法範圍內（四捨五入成整數）；非數字時回傳 fallback
 *
 * @param kind 怪種
 * @param field 欄位
 * @param value 數值
 * @param fallback 非數字時的值
 */
export function clampMonsterField(kind: MonsterKind, field: MonsterValueField, value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const def = monsterFieldDefs(kind)[field];
  return Math.min(def.max, Math.max(def.min, Math.round(value)));
}

/**
 * 一種怪的預設攻擊設定（範圍預設為圓形，其他形狀的尺寸給合理初值）
 *
 * @param kind 怪種
 */
export function defaultMonsterAttack(kind: MonsterKind): MonsterAttack {
  const cfg = GameConfig.monsterAttack[kind];
  return {
    shape: { kind: 'circle', offsetForward: 0, offsetSide: 0, radius: cfg.radius, arcDeg: 120, length: cfg.radius, width: cfg.radius },
    engage: cfg.engage,
    chargeMs: cfg.chargeMs,
    cooldownMs: cfg.cooldownMs,
    damage: cfg.damage
  };
}

/**
 * 整理成合法的怪物攻擊設定（缺漏或錯誤的欄位用預設）
 *
 * @param kind 怪種
 * @param raw 讀到的資料
 */
function sanitizeMonsterAttack(kind: MonsterKind, raw: unknown): MonsterAttack {
  const base = defaultMonsterAttack(kind);
  const r = (raw ?? {}) as Partial<Record<keyof MonsterAttack, unknown>>;
  return {
    shape: sanitizeHitShape(r.shape, base.shape),
    engage: clampMonsterField(kind, 'engage', r.engage, base.engage),
    chargeMs: clampMonsterField(kind, 'chargeMs', r.chargeMs, base.chargeMs),
    cooldownMs: clampMonsterField(kind, 'cooldownMs', r.cooldownMs, base.cooldownMs),
    damage: clampMonsterField(kind, 'damage', r.damage, base.damage)
  };
}

/** localStorage 存檔鍵（JSON：只存跟預設不同的怪種） */
const STORAGE_KEY = 'douqi.monsterAttacks.v1';

/** 讀取各怪種攻擊設定（無法存取 / 資料損壞時用預設） */
function loadMonsterAttacks(): Record<MonsterKind, MonsterAttack> {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') saved = parsed as Record<string, unknown>;
  } catch {
    // 無法讀取或格式錯誤：全部用預設
  }
  const result = {} as Record<MonsterKind, MonsterAttack>;
  for (const { kind } of MONSTER_KINDS) result[kind] = sanitizeMonsterAttack(kind, saved[kind]);
  return result;
}

/** 目前生效的各怪種攻擊設定 */
let attacks: Record<MonsterKind, MonsterAttack> = loadMonsterAttacks();

/** 存檔：只存跟預設不同的怪種（全部都是預設時移除存檔；無法寫入時忽略，本次遊戲仍有效） */
function saveMonsterAttacks(): void {
  const changed: Record<string, MonsterAttack> = {};
  for (const { kind } of MONSTER_KINDS) {
    if (JSON.stringify(attacks[kind]) !== JSON.stringify(defaultMonsterAttack(kind))) changed[kind] = attacks[kind];
  }
  try {
    if (Object.keys(changed).length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
  } catch {
    // 無法寫入（無痕模式 / 封鎖儲存）：不影響遊戲
  }
}

/**
 * 一種怪目前的攻擊設定
 *
 * @param kind 怪種
 */
export function monsterAttack(kind: MonsterKind): Readonly<MonsterAttack> {
  return attacks[kind];
}

/**
 * 敵人種類對應的攻擊設定：大怪、遠程幽靈用自己的，其他近戰 AI 的怪（一般兵、寶箱怪等）用一般兵的
 *
 * @param enemyType 敵人種類（Enemy.enemyType）
 */
export function monsterAttackFor(enemyType: string): Readonly<MonsterAttack> {
  return attacks[enemyType === 'tank' || enemyType === 'bomber' ? enemyType : 'normal'];
}

/**
 * 設定一種怪的攻擊（逐欄夾在合法範圍內）並存檔
 *
 * @param kind 怪種
 * @param value 新的設定
 */
export function setMonsterAttack(kind: MonsterKind, value: MonsterAttack): void {
  attacks[kind] = sanitizeMonsterAttack(kind, value);
  saveMonsterAttacks();
}

/**
 * 一種怪恢復預設
 *
 * @param kind 怪種
 */
export function resetMonsterAttack(kind: MonsterKind): void {
  attacks[kind] = defaultMonsterAttack(kind);
  saveMonsterAttacks();
}

/** 全部怪種恢復預設 */
export function resetAllMonsterAttacks(): void {
  for (const { kind } of MONSTER_KINDS) attacks[kind] = defaultMonsterAttack(kind);
  saveMonsterAttacks();
}

/** 目前所有怪種的攻擊設定（匯出設定用，含沒改過的） */
export function monsterAttackSnapshot(): Readonly<Record<MonsterKind, MonsterAttack>> {
  return attacks;
}

/**
 * 套用一份怪物攻擊設定（匯入 / A/B 比較）：有列出的怪種換成它的設定（逐欄夾在合法範圍內），其他維持不變
 *
 * @param data 各怪種的設定（monsterAttackSnapshot 的格式）
 * @returns 套用的怪種數
 */
export function applyMonsterAttacks(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;
  const d = data as Record<string, unknown>;
  let count = 0;
  for (const { kind } of MONSTER_KINDS) {
    if (!d[kind] || typeof d[kind] !== 'object') continue;
    attacks[kind] = sanitizeMonsterAttack(kind, d[kind]);
    count++;
  }
  saveMonsterAttacks();
  return count;
}

/** 重新讀取存檔 */
export function reloadMonsterAttacks(): void {
  attacks = loadMonsterAttacks();
}

/**
 * 近戰怪出手的攻擊範圍放到世界座標（以怪為基準、朝它的面向 = 目標方向）
 *
 * @param e 近戰怪
 */
export function placeMeleeAttack(e: { x: number; y: number; facing: number; enemyType: string }): PlacedHitShape {
  return placeHitShape(monsterAttackFor(e.enemyType).shape, e.x, e.y, e.facing);
}

/**
 * 遠程幽靈炸彈的爆炸範圍放到世界座標（以落點為基準、朝投擲方向）
 *
 * @param fromX 投擲者 x
 * @param fromY 投擲者 y
 * @param tx 落點 x
 * @param ty 落點 y
 * @param sizeMult 尺寸倍率（蓄力預警由內而外填滿用）
 */
export function placeBombAttack(fromX: number, fromY: number, tx: number, ty: number, sizeMult = 1): PlacedHitShape {
  return placeHitShape(monsterAttack('bomber').shape, tx, ty, Math.atan2(ty - fromY, tx - fromX), sizeMult);
}
