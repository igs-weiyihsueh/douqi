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

/**
 * 「以 (ox, oy) 為起點、沿 dir 方向」的長方形（同 pointInOrientedRect）是否與軸對齊矩形重疊（分離軸判定）
 *
 * @param ox 起點 x
 * @param oy 起點 y
 * @param dir 長方形方向（弧度）
 * @param nearOffset 長方形近端離起點的距離
 * @param length 長方形縱向長度
 * @param width 長方形橫向總寬
 * @param box 軸對齊矩形
 */
export function orientedRectIntersectsBox(
  ox: number, oy: number,
  dir: number, nearOffset: number, length: number, width: number,
  box: Phaser.Geom.Rectangle
): boolean {
  const cos = Math.cos(dir), sin = Math.sin(dir);
  // 定向長方形的中心與兩個半軸
  const along = nearOffset + length / 2;
  const cx = ox + cos * along, cy = oy + sin * along;
  const halfLen = length / 2, halfWid = width / 2;
  const boxHalfW = box.width / 2, boxHalfH = box.height / 2;
  const dx = box.centerX - cx, dy = box.centerY - cy;
  // 軸 1、2：世界 x / y（矩形的邊）
  if (Math.abs(dx) > boxHalfW + Math.abs(cos) * halfLen + Math.abs(sin) * halfWid) return false;
  if (Math.abs(dy) > boxHalfH + Math.abs(sin) * halfLen + Math.abs(cos) * halfWid) return false;
  // 軸 3、4：定向長方形的縱向 / 橫向
  if (Math.abs(dx * cos + dy * sin) > halfLen + boxHalfW * Math.abs(cos) + boxHalfH * Math.abs(sin)) return false;
  if (Math.abs(-dx * sin + dy * cos) > halfWid + boxHalfW * Math.abs(sin) + boxHalfH * Math.abs(cos)) return false;
  return true;
}

/** sectorIntersectsBox 沿扇形兩條邊取樣的點數 */
const SECTOR_EDGE_SAMPLES = 8;

/**
 * 扇形（圓心 (cx, cy)、半徑 radius、朝 aim ± half）是否與軸對齊矩形重疊。
 * 依序檢查：矩形上離圓心最近的點、矩形四角是否落在扇形內，最後沿扇形兩條邊取樣看是否穿過矩形
 * （矩形比扇形寬、只被扇形邊切過時也算到）
 *
 * @param cx 圓心 x
 * @param cy 圓心 y
 * @param radius 半徑
 * @param aim 扇形中心方向（弧度）
 * @param half 扇形半角（弧度）
 * @param box 軸對齊矩形
 */
export function sectorIntersectsBox(cx: number, cy: number, radius: number, aim: number, half: number, box: Phaser.Geom.Rectangle): boolean {
  const inSector = (x: number, y: number): boolean => {
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy > radius * radius) return false;
    if (dx === 0 && dy === 0) return true;
    return Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - aim)) <= half;
  };
  const nearX = Phaser.Math.Clamp(cx, box.left, box.right);
  const nearY = Phaser.Math.Clamp(cy, box.top, box.bottom);
  if ((nearX - cx) ** 2 + (nearY - cy) ** 2 > radius * radius) return false; // 整個矩形在半徑外
  if (inSector(nearX, nearY)) return true;
  if (inSector(box.left, box.top) || inSector(box.right, box.top) || inSector(box.left, box.bottom) || inSector(box.right, box.bottom)) return true;
  for (const edge of [aim - half, aim + half]) {
    const ex = Math.cos(edge), ey = Math.sin(edge);
    for (let i = 1; i <= SECTOR_EDGE_SAMPLES; i++) {
      const d = (radius * i) / SECTOR_EDGE_SAMPLES;
      if (box.contains(cx + ex * d, cy + ey * d)) return true;
    }
  }
  return false;
}
