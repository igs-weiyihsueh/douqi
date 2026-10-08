import Phaser from 'phaser';

/**
 * 站立物件（角色、P1 皮膚、一般怪、可破壞物件）的前後遮擋：依腳底 y 決定深度（Y-sorting），
 * 腳越靠畫面下方（越前面）畫在越上層，側視站立圖互相交疊時呈現正確的 2.5D 透視。
 *
 * 深度區段夾在 [MIN, MAX]，位於這些固定圖層之間：
 * - 下方（地面 / 腳下效果）：腳下圓盤 1、蓄力警示 2、道具 6/7、角色光環 8、角色附屬特效 9、固定目標（塔 / BOSS / NPC）5
 * - 上方（一律不被遮住）：血條 11、標籤 / 鎖定標記 12、P1 頭上覆蓋圖 20 與各種戰鬥特效
 */

/** 站立物件深度下限（高於角色附屬特效 9） */
const STANDING_DEPTH_MIN = 9.1;
/** 站立物件深度上限（低於血條 11 與標籤 12；預留 MIN～MAX 給腳底 y 排序） */
const STANDING_DEPTH_MAX = 9.9;
/** 每像素腳底 y 增加的深度（0.8 深度區段可容納約 80 萬 px 的世界高度） */
const DEPTH_PER_PX = 1e-6;
/** 同一角色的疊加圖（例如 P1 皮膚疊在 P1 本體上）與本體的深度差，遠小於 1 px 的排序差 */
export const OVERLAY_DEPTH_STEP = DEPTH_PER_PX / 100;

/**
 * 依腳底 y（世界座標）算出站立物件的深度
 *
 * @param feetY 腳底 y
 */
export function standingDepth(feetY: number): number {
  return Phaser.Math.Clamp(STANDING_DEPTH_MIN + feetY * DEPTH_PER_PX, STANDING_DEPTH_MIN, STANDING_DEPTH_MAX);
}
