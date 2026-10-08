/**
 * 左右面向（側視站立圖的鏡像翻轉，無狀態）。
 *
 * 美術圖只有一個固定面向，依物件的方向角決定面左 / 面右，再用 flipX 鏡像；
 * 只改畫面，不影響任何判定（腳底 / 腳寬量測左右對稱）。
 */

/** 方向角的水平分量（cos）絕對值小於此值（接近正上 / 正下）時維持原面向，避免上下移動時左右亂翻 */
const FACING_DEADZONE = 0.2;

/**
 * 依方向角更新面向
 *
 * @param angle 方向角（弧度，0 = 右）
 * @param facingRight 目前是否面右
 * @returns 新的面向（true = 面右）
 */
export function facingRightFrom(angle: number, facingRight: boolean): boolean {
  const c = Math.cos(angle);
  if (c > FACING_DEADZONE) return true;
  if (c < -FACING_DEADZONE) return false;
  return facingRight;
}
