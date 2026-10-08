import type { Enemy } from '../objects/Enemy';

/**
 * 敵人種類分類（純函式）。各系統用同一套判斷，避免各處重複手寫型別條件。
 */

/**
 * 固定目標：BOSS、塔、守護 NPC。
 * 這些目標各有自己的站位邏輯，推擠分離、擊飛位移都會跳過它們
 */
export function isFixedEnemy(e: Enemy): boolean {
  return e.isBoss || e.enemyType === 'tower' || e.enemyType === 'npc';
}

/** 結構：BOSS、塔（本體會擋住角色與一般怪，攻擊時停在外緣） */
export function isStructureEnemy(e: Enemy): boolean {
  return e.isBoss || e.enemyType === 'tower';
}

/** 一般怪：不是固定目標、也不是寶箱怪（計入關卡擊殺數與場上存活數） */
export function isRegularEnemy(e: Enemy): boolean {
  return !isFixedEnemy(e) && e.enemyType !== 'treasure';
}
