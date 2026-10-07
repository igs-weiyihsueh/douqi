import Phaser from 'phaser';

/**
 * 招式範圍判定用的幾何工具（純函式）。
 */

/**
 * 點 (px, py) 是否在「以 (ox, oy) 為起點、沿 dir 方向」的長方形內：
 * 縱向從 nearOffset 延伸 length，橫向總寬 width（左右各 width / 2）
 *
 * @param px 判定點 x
 * @param py 判定點 y
 * @param ox 起點 x
 * @param oy 起點 y
 * @param dir 長方形方向（弧度）
 * @param nearOffset 長方形近端離起點的距離
 * @param length 長方形縱向長度
 * @param width 長方形橫向總寬
 */
export function pointInOrientedRect(
  px: number, py: number,
  ox: number, oy: number,
  dir: number, nearOffset: number, length: number, width: number
): boolean {
  const dx = px - ox;
  const dy = py - oy;
  // 投影到 dir（縱向）與其垂直方向（橫向）
  const along = dx * Math.cos(dir) + dy * Math.sin(dir);
  const across = -dx * Math.sin(dir) + dy * Math.cos(dir);
  return along >= nearOffset && along <= nearOffset + length && Math.abs(across) <= width / 2;
}

/**
 * 點 (x, y) 到線段 (x1, y1)-(x2, y2) 的最短距離
 */
export function distanceToSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Phaser.Math.Clamp(((x - x1) * dx + (y - y1) * dy) / lenSq, 0, 1) : 0;
  return Phaser.Math.Distance.Between(x, y, x1 + dx * t, y1 + dy * t);
}
