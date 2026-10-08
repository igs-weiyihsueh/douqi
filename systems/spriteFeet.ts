import type Phaser from 'phaser';

/** 視為「看得見」的最低透明度（0~255） */
const OPAQUE_ALPHA = 40;
/** 量腳寬時取可見高度最下方的比例（只看腳，避開手臂 / 武器） */
const FOOT_BAND_RATIO = 0.1;

/** 紋理可見部分的腳底量測（未縮放；原點在中心的 Sprite / Image 適用） */
interface FeetMetrics {
  /** 最下緣離紋理中心的垂直距離 */
  bottomOffset: number;
  /** 腳部（最下方 FOOT_BAND_RATIO 高度）不透明像素的左右寬度的一半 */
  footHalfWidth: number;
}

/** 各紋理的腳底量測，第一次查詢時掃描後快取 */
const metricsCache = new Map<string, FeetMetrics>();

/**
 * 掃描紋理的不透明像素，量出腳底位置與腳寬（依紋理 key 快取；換新美術素材時自動重新量）
 *
 * @param textures 紋理管理器
 * @param key 紋理 key
 */
function feetMetrics(textures: Phaser.Textures.TextureManager, key: string): FeetMetrics {
  const cached = metricsCache.get(key);
  if (cached !== undefined) return cached;
  const frame = textures.getFrame(key);
  const w = frame.width, h = frame.height;
  const opaque = (x: number, y: number): boolean => (textures.getPixelAlpha(x, y, key) ?? 0) > OPAQUE_ALPHA;
  const rowHasPixel = (y: number): boolean => {
    for (let x = 0; x < w; x++) if (opaque(x, y)) return true;
    return false;
  };
  let bottom = h - 1, top = 0;
  while (bottom > 0 && !rowHasPixel(bottom)) bottom--;
  while (top < bottom && !rowHasPixel(top)) top++;
  // 腳部範圍：可見高度最下方 FOOT_BAND_RATIO（至少 1 列）
  const bandTop = Math.max(top, Math.floor(bottom - (bottom - top + 1) * FOOT_BAND_RATIO));
  let left = w, right = -1;
  for (let y = bandTop; y <= bottom; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  const metrics: FeetMetrics = {
    bottomOffset: bottom + 1 - h / 2,
    footHalfWidth: right >= left ? (right - left + 1) / 2 : 0
  };
  metricsCache.set(key, metrics);
  return metrics;
}

/**
 * 紋理可見部分（不透明像素）最下緣離紋理中心的垂直距離（未縮放；原點在中心的 Sprite / Image 適用）。
 * 用來找出角色 / 敵人圖像的「腳底」：圖檔下方常有透明留白，不能直接用圖高的一半
 *
 * @param textures 紋理管理器
 * @param key 紋理 key
 */
export function visibleBottomOffset(textures: Phaser.Textures.TextureManager, key: string): number {
  return feetMetrics(textures, key).bottomOffset;
}

/**
 * 紋理腳部（可見高度最下方一小段）的左右寬度的一半（未縮放）。
 * 側視站立圖的身體 / 武器比腳寬，地面佔位只看腳，避免怪群被撐得過散
 *
 * @param textures 紋理管理器
 * @param key 紋理 key
 */
export function visibleFootHalfWidth(textures: Phaser.Textures.TextureManager, key: string): number {
  return feetMetrics(textures, key).footHalfWidth;
}
