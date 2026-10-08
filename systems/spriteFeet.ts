import type Phaser from 'phaser';

/** 視為「看得見」的最低透明度（0~255） */
const OPAQUE_ALPHA = 40;

/** 各紋理可見部分最下緣離中心的距離（未縮放），第一次查詢時掃描後快取 */
const bottomOffsetCache = new Map<string, number>();

/**
 * 紋理可見部分（不透明像素）最下緣離紋理中心的垂直距離（未縮放；原點在中心的 Sprite / Image 適用）。
 * 用來找出角色 / 敵人圖像的「腳底」：圖檔下方常有透明留白，不能直接用圖高的一半。
 * 結果依紋理 key 快取；換新美術素材時自動重新量
 *
 * @param textures 紋理管理器
 * @param key 紋理 key
 */
export function visibleBottomOffset(textures: Phaser.Textures.TextureManager, key: string): number {
  const cached = bottomOffsetCache.get(key);
  if (cached !== undefined) return cached;
  const frame = textures.getFrame(key);
  const w = frame.width, h = frame.height;
  let bottom = h - 1;
  scan: for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      if ((textures.getPixelAlpha(x, y, key) ?? 0) > OPAQUE_ALPHA) { bottom = y; break scan; }
    }
  }
  const offset = bottom + 1 - h / 2;
  bottomOffsetCache.set(key, offset);
  return offset;
}
