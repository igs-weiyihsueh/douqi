import Phaser from 'phaser';
import { GameConfig } from '../config';

/**
 * 程式繪製的場景外觀（無狀態）：子區的遠景、外圍荒地、地面底圖、圍欄、餘燼粒子，以及子區間的走廊。
 *
 * 函式只負責建立物件並回傳，登記、回收由呼叫端（GameScene 的 sceneLayers / slotLayers）管理。
 * 散布數量、尺寸等數字是美術調整用的視覺參數，只在這裡使用。
 */

/** 一關的場景配色（config.scene.levels 每一項的形狀） */
export interface ScenePalette {
  name: string;
  groundBase: number;
  groundDark: number;
  groundLight: number;
  crackColor: number;
  pebble: number;
  /** 熔岩發光色；0 = 無熔岩 */
  glow: number;
  skyTop: number;
  skyBottom: number;
}

/** 子區變體：A = 荒城遠景，B = 火山遠景 */
export type ZoneVariant = 'A' | 'B';

/** 場景圖層深度：天空 / 遠景 / 外圍 / 地面 / 圍欄 / 粒子 */
const DEPTH = { sky: -3, far: -2, outer: -1, ground: 0, border: 1, embers: 2 } as const;

/**
 * 取得某關的配色；超出範圍時回到第 1 關
 *
 * @param level 關卡（scene.levels 的 key）
 */
export function paletteOf(level: number): ScenePalette {
  const levels: Record<number, ScenePalette> = GameConfig.scene.levels;
  return levels[level] ?? levels[1];
}

/**
 * 繪製一個子區的場景：遠景（畫滿整個 slot）→ 外圍荒地 → 移動區地面 → 圍欄 → 餘燼粒子
 *
 * @param scene 建立物件的場景
 * @param slot 子區所在的整格（移動區 + 四周遠景邊距）
 * @param zone 移動區
 * @param level 場景配色關卡
 * @param variant 子區變體
 * @returns 建立的場景物件（呼叫端負責登記與回收）
 */
export function drawZoneScenery(
  scene: Phaser.Scene, slot: Phaser.Geom.Rectangle, zone: Phaser.Geom.Rectangle, level: number, variant: ZoneVariant
): Phaser.GameObjects.GameObject[] {
  const lv = paletteOf(level);
  const objects: Phaser.GameObjects.GameObject[] = [];

  // 1) 遠景天空漸層（畫滿整個 slot）
  const sky = scene.add.graphics().setDepth(DEPTH.sky);
  sky.fillGradientStyle(lv.skyTop, lv.skyTop, lv.skyBottom, lv.skyBottom, 1);
  sky.fillRect(slot.x, slot.y, slot.width, slot.height);
  objects.push(sky);

  // 2) 遠景剪影（上方天際線帶）
  const far = scene.add.graphics().setDepth(DEPTH.far);
  const bandH = Math.round((zone.top - slot.top) * 1.15);
  const bandTop = slot.top + Math.max(16, (zone.top - slot.top) * 0.1);
  if (variant === 'A') drawFarRuinedCity(far, slot.x + 16, bandTop, slot.width - 32, bandH);
  else drawFarVolcano(far, slot.x + 16, bandTop, slot.width - 32, bandH);
  objects.push(far);

  // 3) 移動區外圍荒地（slot 內、移動區外）
  objects.push(drawOuterWasteland(scene, slot, zone, lv, variant, bandH));

  // 4) 移動區地面：一次性產生靜態底圖
  objects.push(scene.add.image(zone.x, zone.y, makeGroundTexture(scene, zone, level, variant, lv)).setOrigin(0, 0).setDepth(DEPTH.ground));

  // 5) 圍欄：標出可走範圍
  const border = scene.add.graphics().setDepth(DEPTH.border);
  border.lineStyle(GameConfig.arena.borderThickness, GameConfig.arena.borderColor, 1);
  border.strokeRect(zone.x, zone.y, zone.width, zone.height);
  objects.push(border);

  // 6) 餘燼粒子
  const embers = createEmbers(scene, slot, level, variant, lv);
  if (embers) objects.push(embers);
  return objects;
}

/**
 * 繪製子區之間的走廊（天空 + 地面帶），填滿兩個移動區之間、整個 slot 高度，避免轉場時露出黑塊
 *
 * @param scene 建立物件的場景
 * @param x0 走廊左緣
 * @param x1 走廊右緣
 * @param slot 走廊所在列的 slot（決定垂直範圍）
 * @param zone 移動區（決定地面帶的上下緣）
 * @param level 場景配色關卡
 */
export function drawCorridorScenery(
  scene: Phaser.Scene, x0: number, x1: number, slot: Phaser.Geom.Rectangle, zone: Phaser.Geom.Rectangle, level: number
): Phaser.GameObjects.Graphics {
  const lv = paletteOf(level);
  const w = x1 - x0;
  const g = scene.add.graphics().setDepth(DEPTH.sky);
  g.fillGradientStyle(lv.skyTop, lv.skyTop, lv.skyBottom, lv.skyBottom, 1);
  g.fillRect(x0, slot.y, w, slot.height);
  g.fillStyle(lv.groundBase, 1);
  g.fillRect(x0, zone.top, w, zone.height);
  g.lineStyle(3, lv.groundDark, 0.8);
  g.strokeRect(x0, zone.top, w, zone.height);
  return g;
}

/**
 * 建立一張蓋滿指定矩形的背景圖：等比放大（cover）後裁掉超出部分，保持原圖比例不變形
 *
 * @param scene 建立物件的場景
 * @param textureKey 紋理 key
 * @param rect 要蓋滿的世界座標矩形
 * @param depth 深度
 * @param visible 初始是否顯示
 */
export function createCoverImage(
  scene: Phaser.Scene, textureKey: string, rect: Phaser.Geom.Rectangle, depth: number, visible: boolean
): Phaser.GameObjects.Image {
  const img = scene.add.image(rect.centerX, rect.centerY, textureKey)
    .setOrigin(0.5, 0.5)
    .setDepth(depth)
    .setVisible(visible);
  // cover：取寬、高放大倍率中較大者，確保整個矩形都被蓋滿
  const scale = Math.max(rect.width / img.width, rect.height / img.height);
  img.setScale(scale);
  // 裁切（紋理座標）：只保留置中、對應 rect 大小的區域，避免溢出到相鄰 slot
  const cropW = rect.width / scale;
  const cropH = rect.height / scale;
  img.setCrop((img.width - cropW) / 2, (img.height - cropH) / 2, cropW, cropH);
  return img;
}

/**
 * 外圍荒地：鋪暗色底，並在 slot 內、移動區外散布碎石、殘骸、熔岩窪，避免留下大片空白
 */
function drawOuterWasteland(
  scene: Phaser.Scene, slot: Phaser.Geom.Rectangle, zone: Phaser.Geom.Rectangle, lv: ScenePalette, variant: ZoneVariant, bandH: number
): Phaser.GameObjects.Graphics {
  const outer = scene.add.graphics().setDepth(DEPTH.outer);
  outer.fillStyle(lv.groundDark, 0.7);
  outer.fillRect(slot.x, zone.bottom, slot.width, slot.bottom - zone.bottom); // 下方
  outer.fillRect(slot.x, zone.top, zone.left - slot.left, zone.height);       // 左
  outer.fillRect(zone.right, zone.top, slot.right - zone.right, zone.height); // 右
  const inZone = (x: number, y: number): boolean =>
    x > zone.left - 10 && x < zone.right + 10 && y > zone.top - 10 && y < zone.bottom + 10;
  for (let i = 0; i < 140; i++) {
    const x = Phaser.Math.Between(slot.left + 6, slot.right - 6);
    const y = Phaser.Math.Between(slot.top + bandH, slot.bottom - 6); // 天際線帶以下
    if (inZone(x, y)) continue;
    const roll = Math.random();
    if (roll < 0.5) { // 碎石
      outer.fillStyle(lv.pebble, 0.5); outer.fillCircle(x, y, Phaser.Math.Between(2, 5));
    } else if (roll < 0.82) { // 斷牆 / 岩塊殘骸
      outer.fillStyle(lv.groundLight, 0.28); outer.fillRect(x, y, Phaser.Math.Between(10, 28), Phaser.Math.Between(6, 16));
    } else if (variant === 'B' || lv.glow) { // 火山 / 熔岩關：發光熔岩窪
      outer.fillStyle(GameConfig.scene.farB.lava, 0.35); outer.fillCircle(x, y, Phaser.Math.Between(4, 10));
    } else { // 荒城關：土斑
      outer.fillStyle(lv.groundBase, 0.4); outer.fillCircle(x, y, Phaser.Math.Between(8, 20));
    }
  }
  return outer;
}

/**
 * 產生移動區地面的靜態紋理：乾裂土塊、龜裂縫線、（熔岩關）發光裂縫、碎石，第 3 / 4 關各有特色地貌
 *
 * @returns 紋理 key（同 key 已存在時先移除重建）
 */
function makeGroundTexture(
  scene: Phaser.Scene, zone: Phaser.Geom.Rectangle, level: number, variant: ZoneVariant, lv: ScenePalette
): string {
  const key = `zone-ground-L${level}-${variant}-${Math.round(zone.x)}`;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const gt = scene.make.graphics({ x: 0, y: 0 }, false);
  const w = Math.round(zone.width), h = Math.round(zone.height);
  gt.fillStyle(lv.groundBase, 1); gt.fillRect(0, 0, w, h);
  // 不規則多邊斑塊（像乾裂土塊）
  for (let i = 0; i < 120; i++) {
    gt.fillStyle(Math.random() < 0.5 ? lv.groundDark : lv.groundLight, 0.14);
    gt.fillPoints(randomPolygon(Phaser.Math.Between(0, w), Phaser.Math.Between(0, h), Phaser.Math.Between(10, 34), Phaser.Math.Between(4, 6), 0.6, 0.5), true);
  }
  // 龜裂縫線
  gt.lineStyle(2, lv.crackColor, 0.85);
  for (let c = 0; c < 16; c++) strokeRandomCrack(gt, w, h, Phaser.Math.Between(3, 6), 70, 55);
  // 熔岩關：發光裂縫
  if (lv.glow) {
    gt.lineStyle(4, lv.glow, 0.5);
    for (let c = 0; c < 5; c++) strokeRandomCrack(gt, w, h, 4, 50, 40);
  }
  // 碎石
  for (let i = 0; i < 70; i++) {
    gt.fillStyle(lv.pebble, 0.8);
    gt.fillCircle(Phaser.Math.Between(4, w - 4), Phaser.Math.Between(4, h - 4), Phaser.Math.Between(1, 3));
  }
  // 第 3 關（焦黑廢墟）：散落的斷裂城磚
  if (level === 3) {
    for (let i = 0; i < 30; i++) {
      const bx = Phaser.Math.Between(6, w - 26), by = Phaser.Math.Between(6, h - 16);
      const bw = Phaser.Math.Between(14, 28), bh = Phaser.Math.Between(8, 16);
      const stone = [0x6a6058, 0x554b44, 0x736658][Phaser.Math.Between(0, 2)];
      gt.fillStyle(stone, 0.9); gt.fillRect(bx, by, bw, bh);
      gt.fillStyle(0x1a1512, 0.6); gt.fillRect(bx, by + bh / 2 - 1, bw, 2); // 磚縫
      gt.lineStyle(1, 0x2a241f, 0.7); gt.strokeRect(bx, by, bw, bh);
    }
    gt.lineStyle(0, 0, 0);
  }
  // 第 4 關（火山岩盤）：深色岩板裂塊
  if (level === 4) {
    for (let i = 0; i < 18; i++) {
      gt.fillStyle(0x1a1211, 0.5);
      gt.fillPoints(randomPolygon(Phaser.Math.Between(10, w - 10), Phaser.Math.Between(10, h - 10), Phaser.Math.Between(18, 40), Phaser.Math.Between(5, 6), 0.7, 0.4), true);
    }
  }
  gt.generateTexture(key, w, h);
  gt.destroy();
  return key;
}

/**
 * 以 (cx, cy) 為中心、頂點半徑在 r × [minRatio, minRatio + jitter) 之間的不規則多邊形
 */
function randomPolygon(cx: number, cy: number, r: number, sides: number, minRatio: number, jitter: number): Phaser.Geom.Point[] {
  const pts: Phaser.Geom.Point[] = [];
  for (let s = 0; s < sides; s++) {
    const a = (s / sides) * Math.PI * 2;
    const rad = r * (minRatio + Math.random() * jitter);
    pts.push(new Phaser.Geom.Point(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad));
  }
  return pts;
}

/**
 * 從隨機起點畫一條 segs 段的折線裂縫（每段位移在 ±dx / ±dy 內），使用目前的 lineStyle
 */
function strokeRandomCrack(g: Phaser.GameObjects.Graphics, w: number, h: number, segs: number, dx: number, dy: number): void {
  let cx = Phaser.Math.Between(0, w), cy = Phaser.Math.Between(0, h);
  g.beginPath(); g.moveTo(cx, cy);
  for (let s = 0; s < segs; s++) { cx += Phaser.Math.Between(-dx, dx); cy += Phaser.Math.Between(-dy, dy); g.lineTo(cx, cy); }
  g.strokePath();
}

/**
 * 餘燼火點粒子（畫在整個 slot）：第 4 關最多、第 2 關次之，B 變體（火山遠景）更多
 *
 * @returns 粒子發射器；config.scene.emberCount 為 0 時不建立
 */
function createEmbers(
  scene: Phaser.Scene, slot: Phaser.Geom.Rectangle, level: number, variant: ZoneVariant, lv: ScenePalette
): Phaser.GameObjects.Particles.ParticleEmitter | null {
  const sc = GameConfig.scene;
  if (sc.emberCount <= 0) return null;
  const glowColor = variant === 'B' ? sc.farB.lava : (lv.glow || 0xff8a3a);
  const levelMult = level === 4 ? 1.8 : level === 2 ? 1.3 : 1.0;
  const base = variant === 'B' ? sc.emberCount : Math.round(sc.emberCount * 0.6);
  const count = Math.max(4, Math.round(base * levelMult));
  return scene.add.particles(0, 0, 'spark', {
    x: { min: slot.x, max: slot.right },
    y: { min: slot.y, max: slot.bottom },
    lifespan: 2600, speedY: { min: -18, max: -42 }, speedX: { min: -8, max: 8 },
    scale: { start: 0.5, end: 0 }, alpha: { start: 0.9, end: 0 },
    tint: glowColor, frequency: Math.max(45, 1800 / count), quantity: 1, blendMode: 'ADD'
  }).setDepth(DEPTH.embers);
}

/** 遠景：荒城天際線（遠層小剪影 + 傾頹城牆 + 破塔） */
function drawFarRuinedCity(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  const f = GameConfig.scene.farA;
  g.fillStyle(f.hazeTop, 0.5); g.fillRect(x, y, w, h);
  const base = y + h;
  // 遠層小剪影（墊背景層次）
  g.fillStyle(f.tower, 0.5);
  for (let bx = x; bx < x + w; bx += Phaser.Math.Between(30, 55)) {
    const bh = Phaser.Math.Between(14, Math.max(20, h * 0.4));
    g.fillRect(bx, base - bh, Phaser.Math.Between(14, 26), bh);
  }
  // 城牆（約 12% 機率留缺口）+ 城垛
  g.fillStyle(f.wall, 0.95);
  let wx = x;
  const wallMax = Math.max(24, h * 0.55);
  while (wx < x + w) {
    const seg = Phaser.Math.Between(30, 60);
    const wh = Phaser.Math.Between(Math.round(wallMax * 0.4), Math.round(wallMax)) * (Math.random() < 0.12 ? 0 : 1);
    g.fillRect(wx, base - wh, seg, wh);
    if (wh > 0) for (let m = wx; m < wx + seg; m += 14) g.fillRect(m, base - wh - 6, 7, 6);
    wx += seg + Phaser.Math.Between(2, 8);
  }
  // 破塔
  g.fillStyle(f.tower, 0.95);
  const towers = Math.max(4, Math.round(w / 220));
  for (let t = 0; t < towers; t++) {
    const tx = x + 20 + (t + 0.5) * (w / towers) + Phaser.Math.Between(-30, 30);
    const tw = Phaser.Math.Between(18, 28), th = Phaser.Math.Between(Math.round(wallMax * 0.8), Math.round(wallMax * 1.4));
    g.fillRect(tx, base - th, tw, th);
    g.fillTriangle(tx, base - th, tx + tw, base - th, tx + tw * 0.5, base - th - Phaser.Math.Between(5, 14));
  }
}

/** 遠景：火山噴發（低矮山巒 + 兩座主火山、熔岩流、噴煙） */
function drawFarVolcano(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  const f = GameConfig.scene.farB;
  g.fillStyle(f.glowSky, 0.4); g.fillRect(x, y, w, h);
  const base = y + h;
  // 遠層低矮山巒
  g.fillStyle(f.smoke, 0.55);
  for (let mx = x; mx < x + w; mx += Phaser.Math.Between(70, 120)) {
    const mw = Phaser.Math.Between(70, 130), mh = Phaser.Math.Between(Math.round(h * 0.3), Math.round(h * 0.55));
    g.fillTriangle(mx - mw / 2, base, mx + mw / 2, base, mx, base - mh);
  }
  // 主火山
  const peaks = 2;
  for (let p = 0; p < peaks; p++) {
    const mx = x + (p + 0.5) * (w / peaks) + Phaser.Math.Between(-40, 40);
    const mw = Phaser.Math.Between(Math.round(w * 0.18), Math.round(w * 0.26));
    const mh = Math.max(30, h * 0.7);
    const mtop = base - mh;
    g.fillStyle(f.smoke, 0.98);
    g.fillTriangle(mx - mw / 2, base, mx + mw / 2, base, mx, mtop);
    // 熔岩流
    g.lineStyle(2, f.lava, 0.85);
    for (let l = 0; l < 2; l++) {
      let lx = mx + Phaser.Math.Between(-10, 10), ly = mtop + 4;
      g.beginPath(); g.moveTo(lx, ly);
      for (let s = 0; s < 4; s++) { lx += Phaser.Math.Between(-12, 12); ly += Phaser.Math.Between(10, 18); g.lineTo(lx, ly); }
      g.strokePath();
    }
    // 噴煙 + 山口亮點
    for (let s = 0; s < 4; s++) { g.fillStyle(f.smoke, 0.35); g.fillCircle(mx + Phaser.Math.Between(-20, 20), mtop - Phaser.Math.Between(2, 26), Phaser.Math.Between(10, 20)); }
    g.fillStyle(f.lava, 0.9); g.fillCircle(mx, mtop + 3, 6);
  }
}
