import Phaser from 'phaser';
import { GameConfig } from '../config';

/**
 * BootScene：程序化產生占位像素貼圖（不依賴外部素材檔）。
 * 之後可替換成真正的美術素材。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    // v17：4 個角色改「程式繪製人型剪影」（不同顏色；朝右=aimAngle 0），與敵人圓塊區隔
    const colors = GameConfig.characters.colors;
    for (let i = 0; i < GameConfig.characters.count; i++) {
      this.makeHumanoidTexture(`char-${i}`, GameConfig.player.radius, colors[i], 0xffffff);
    }
    // 各敵人類型各一張貼圖
    const types = GameConfig.enemy.types;
    this.makeCircleTexture('enemy-normal', types.normal.radius, types.normal.color, types.normal.stroke);
    this.makeCircleTexture('enemy-tank', types.tank.radius, types.tank.color, types.tank.stroke);
    this.makeCircleTexture('enemy-shielder', types.shielder.radius, types.shielder.color, types.shielder.stroke);
    this.makeCircleTexture('enemy-shooter', types.shooter.radius, types.shooter.color, types.shooter.stroke);
    this.makeCircleTexture('enemy-charger', types.charger.radius, types.charger.color, types.charger.stroke);
    this.makeCircleTexture('enemy-bomber', types.bomber.radius, types.bomber.color, types.bomber.stroke);
    this.makeCircleTexture('enemy-boss', GameConfig.boss.radius, GameConfig.boss.color, GameConfig.boss.stroke);
    this.makeCircleTexture('enemy-tower', GameConfig.event.tower.radius, GameConfig.event.tower.color, GameConfig.event.tower.stroke);
    // v35(9)：NPC 專屬貼圖——藍色圓角方塊 + 白十字 + 外環，一眼跟「圓形怪物」區別
    this.makeNpcTexture('enemy-npc', GameConfig.event.guard.radius, GameConfig.event.guard.color, GameConfig.event.guard.stroke);
    // v36：BOSS 戰錨點專屬貼圖——青色發光菱形+外環，跟圓形怪/藍方塊NPC 都不同（走位落點）
    this.makeAnchorTexture('enemy-anchor', GameConfig.enemy.types.anchor.radius);
    // ★寶箱怪貼圖:金色寶箱(箱身+鎖扣+金邊高光),一眼金光閃閃
    this.makeTreasureTexture('enemy-treasure', GameConfig.enemy.types.treasure.radius);
    // ★金幣特效貼圖(金色小圓幣,噴散用)
    this.makeCoinTexture('coin');
    // 子彈貼圖
    this.makeCircleTexture('bullet', GameConfig.enemy.shooter.bulletRadius, 0x9dff5a, 0x1a3300);
    // 4 種道具貼圖（圓角方塊 + 白描邊，字母圖示由 Item 疊上）
    const ic = GameConfig.items.colors;
    this.makeItemTexture('item-A', ic.A);
    this.makeItemTexture('item-B', ic.B);
    this.makeItemTexture('item-C', ic.C);
    this.makeItemTexture('item-E', ic.E);
    this.makeItemTexture('item-F', ic.F);
    this.makeItemTexture('item-H', ic.H);
    this.makeItemTexture('item-T', ic.T);
    // v57 可打破物件（木箱）貼圖：棕色方箱 + 十字木紋，跟圓形怪/道具方塊區分
    this.makeBreakableTexture('breakable-jar');
    // v61 爆炸桶貼圖：橘紅桶身 + 黃黑危險條紋 + 圓角，一眼跟木箱區別
    this.makeBarrelTexture('breakable-barrel');
    // 小遊戲「收集競賽」4 種形狀物件貼圖（鑽石藍/星星黃/心形紅/寶石綠）
    this.makeCollectShapeTexture('collect-diamond', 0x4aa3ff, 0x0a3a6b);
    this.makeCollectShapeTexture('collect-star', 0xffd23f, 0x8a6a00);
    this.makeCollectShapeTexture('collect-heart', 0xff5a7a, 0x7a1030);
    this.makeCollectShapeTexture('collect-gem', 0x4ade80, 0x0a5a2a);
    // 小遊戲「炸彈人對戰」:炸彈貼圖(黑圓身 + 引信 + 高光)
    this.makeBombTexture('bomb');
    this.makeGroundTexture();
    this.makeParticleTexture();

    // v16：貼圖產生完 → 先進標題畫面（按下開始才進 GameScene 生怪）
    this.scene.start('TitleScene');
  }

  /** ★寶箱怪貼圖:金色寶箱——金邊描邊 + 箱身漸層 + 蓋縫 + 中央鎖扣 + 高光,金光閃閃。 */
  private makeTreasureTexture(key: string, radius: number): void {
    const size = radius * 2 + 6;
    const g = this.add.graphics();
    const cx = size / 2, cy = size / 2;
    const w = radius * 2, h = radius * 1.7;
    const left = cx - w / 2, top = cy - h / 2;
    // 金色外框
    g.fillStyle(0x8a6a00, 1);
    g.fillRoundedRect(left - 3, top - 3, w + 6, h + 6, 6);
    // 箱身(亮金)
    g.fillStyle(0xffd23f, 1);
    g.fillRoundedRect(left, top, w, h, 5);
    // 箱蓋(上 1/3 深一點金)
    g.fillStyle(0xf5a623, 1);
    g.fillRoundedRect(left, top, w, h * 0.4, 5);
    // 蓋縫線
    g.fillStyle(0x8a6a00, 1);
    g.fillRect(left, top + h * 0.4 - 1, w, 2);
    // 中央鎖扣
    g.fillStyle(0x8a6a00, 1);
    g.fillRect(cx - 4, cy - 2, 8, 8);
    g.fillStyle(0xfff4c2, 1);
    g.fillCircle(cx, cy + 1, 2);
    // 高光
    g.fillStyle(0xffffff, 0.5);
    g.fillRect(left + 3, top + 3, w * 0.3, 3);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /** ★金幣特效貼圖:金色小圓幣 + 白高光。 */
  private makeCoinTexture(key: string): void {
    const r = 6;
    const size = r * 2 + 4;
    const c = size / 2;
    const g = this.add.graphics();
    g.fillStyle(0x8a6a00, 1);
    g.fillCircle(c, c, r + 1);
    g.fillStyle(0xffd700, 1);
    g.fillCircle(c, c, r);
    g.fillStyle(0xfff4c2, 0.9);
    g.fillCircle(c - r * 0.3, c - r * 0.3, r * 0.4);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /** 小遊戲「炸彈人對戰」炸彈貼圖:黑圓身 + 白描邊 + 頂部引信(橘火花) + 高光 */
  private makeBombTexture(key: string): void {
    const r = 13;
    const size = r * 2 + 12;
    const cx = size / 2, cy = size / 2 + 3;
    const g = this.add.graphics();
    // 描邊
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx, cy, r + 2);
    // 黑身
    g.fillStyle(0x22262e, 1);
    g.fillCircle(cx, cy, r);
    // 高光
    g.fillStyle(0xffffff, 0.4);
    g.fillCircle(cx - r * 0.35, cy - r * 0.35, r * 0.3);
    // 引信(頂部小柱)
    g.fillStyle(0x8a6a00, 1);
    g.fillRect(cx - 2, cy - r - 6, 4, 8);
    // 火花
    g.fillStyle(0xff8a1a, 1);
    g.fillCircle(cx, cy - r - 7, 3.5);
    g.fillStyle(0xffe066, 1);
    g.fillCircle(cx, cy - r - 7, 1.8);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /** 產生道具貼圖：帶白描邊的圓角方塊 */
  private makeItemTexture(key: string, fill: number): void {    const r = GameConfig.items.radius;
    const size = r * 2 + 6;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(0, 0, size, size, 6);
    g.fillStyle(fill, 1);
    g.fillRoundedRect(3, 3, size - 6, size - 6, 5);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /**
   * 小遊戲「收集競賽」形狀物件貼圖：白描邊 + 填色的 4 種可辨識形狀。
   * key: collect-diamond(菱形) / collect-star(五角星) / collect-heart(心形) / collect-gem(六角寶石)。
   */
  private makeCollectShapeTexture(key: string, fill: number, stroke: number): void {
    const R = 16;                 // 形狀半徑
    const pad = 4;
    const size = (R + pad) * 2;
    const cx = size / 2, cy = size / 2;
    const g = this.add.graphics();
    const shape = key.replace('collect-', '');
    const drawPoly = (pts: Array<[number, number]>): void => {
      g.beginPath();
      g.moveTo(cx + pts[0][0], cy + pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(cx + pts[i][0], cy + pts[i][1]);
      g.closePath();
    };
    // 先描邊(較粗白底)，再填色形狀(略小) → 白邊效果
    const strokePts: Array<[number, number]> = [];
    void strokePts;
    if (shape === 'diamond') {
      const pts: Array<[number, number]> = [[0, -R], [R * 0.8, 0], [0, R], [-R * 0.8, 0]];
      g.fillStyle(0xffffff, 1); drawPoly(pts.map(([x, y]) => [x * 1.18, y * 1.18] as [number, number])); g.fillPath();
      g.fillStyle(fill, 1); drawPoly(pts); g.fillPath();
    } else if (shape === 'star') {
      const star = (scale: number): Array<[number, number]> => {
        const out: Array<[number, number]> = [];
        for (let i = 0; i < 10; i++) {
          const ang = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = (i % 2 === 0 ? R : R * 0.45) * scale;
          out.push([Math.cos(ang) * rr, Math.sin(ang) * rr]);
        }
        return out;
      };
      g.fillStyle(0xffffff, 1); drawPoly(star(1.2)); g.fillPath();
      g.fillStyle(fill, 1); drawPoly(star(1)); g.fillPath();
    } else if (shape === 'heart') {
      const heart = (scale: number): Array<[number, number]> => {
        const out: Array<[number, number]> = [];
        for (let i = 0; i <= 24; i++) {
          const t = (i / 24) * Math.PI * 2;
          const x = 16 * Math.pow(Math.sin(t), 3);
          const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
          out.push([(x / 16) * R * scale, (y / 16) * R * scale]);
        }
        return out;
      };
      g.fillStyle(0xffffff, 1); drawPoly(heart(1.15)); g.fillPath();
      g.fillStyle(fill, 1); drawPoly(heart(1)); g.fillPath();
    } else { // gem：六角寶石
      const hex = (scale: number): Array<[number, number]> => {
        const out: Array<[number, number]> = [];
        for (let i = 0; i < 6; i++) {
          const ang = -Math.PI / 2 + (i * Math.PI) / 3;
          out.push([Math.cos(ang) * R * scale, Math.sin(ang) * R * scale]);
        }
        return out;
      };
      g.fillStyle(0xffffff, 1); drawPoly(hex(1.18)); g.fillPath();
      g.fillStyle(fill, 1); drawPoly(hex(1)); g.fillPath();
      // 寶石切面線
      g.lineStyle(1.5, stroke, 0.8);
      g.strokeCircle(cx, cy, R * 0.4);
    }
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /** v57 可打破物件貼圖：棕色木箱(方形+木紋十字+描邊)，跟圓形怪/道具方塊明顯不同 */
  private makeBreakableTexture(key: string): void {
    const r = GameConfig.breakable.radius;
    const size = r * 2 + 4;
    const g = this.add.graphics();
    // 外框(深棕描邊)
    g.fillStyle(GameConfig.breakable.stroke, 1);
    g.fillRect(0, 0, size, size);
    // 箱身
    g.fillStyle(GameConfig.breakable.color, 1);
    g.fillRect(3, 3, size - 6, size - 6);
    // 木紋十字(對角板 + 中線)
    g.lineStyle(2, GameConfig.breakable.stroke, 0.9);
    g.beginPath();
    g.moveTo(3, 3); g.lineTo(size - 3, size - 3);
    g.moveTo(size - 3, 3); g.lineTo(3, size - 3);
    g.strokePath();
    g.lineStyle(2, 0xffffff, 0.25);
    g.strokeRect(4, 4, size - 8, size - 8);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /** v61 爆炸桶貼圖：橘紅圓角桶身 + 黃色危險橫條紋 + 深紅描邊，一眼跟木箱(棕方箱)區別 */
  private makeBarrelTexture(key: string): void {
    const bcfg = GameConfig.breakable.barrel;
    const r = GameConfig.breakable.radius;
    const size = r * 2 + 4;
    const g = this.add.graphics();
    // 描邊桶身(圓角矩形)
    g.fillStyle(bcfg.stroke, 1);
    g.fillRoundedRect(0, 0, size, size, 6);
    g.fillStyle(bcfg.color, 1);
    g.fillRoundedRect(3, 3, size - 6, size - 6, 5);
    // 危險黃橫條紋(2 條)
    g.fillStyle(bcfg.stripe, 0.95);
    g.fillRect(3, size * 0.30, size - 6, size * 0.14);
    g.fillRect(3, size * 0.58, size - 6, size * 0.14);
    // 中央深色警示點
    g.fillStyle(bcfg.stroke, 0.9);
    g.fillCircle(size / 2, size / 2, r * 0.22);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /** 產生一個帶描邊的實心圓（角色/敵人占位圖） */
  private makeCircleTexture(
    key: string,
    radius: number,
    fill: number,
    stroke: number
  ): void {
    const size = radius * 2 + 4;
    const g = this.add.graphics();
    g.fillStyle(stroke, 1);
    g.fillCircle(size / 2, size / 2, radius + 1);
    g.fillStyle(fill, 1);
    g.fillCircle(size / 2, size / 2, radius);
    // 高光點，增加像素立體感
    g.fillStyle(0xffffff, 0.5);
    g.fillCircle(size / 2 - radius * 0.35, size / 2 - radius * 0.35, radius * 0.28);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /**
   * v35(9)：NPC 專屬貼圖——「要守護的友軍」外觀，跟圓形怪物明顯區別：
   * 藍色圓角方塊本體 + 白色十字（醫療/守護意象）+ 明亮外環光暈。
   * @param fill/stroke 沿用 config.event.guard 的色（此處另用固定藍為主，讓辨識度高）。
   */
  private makeNpcTexture(key: string, radius: number, _fill: number, _stroke: number): void {
    const size = radius * 2 + 12; // 留外環空間
    const cx = size / 2;
    const cy = size / 2;
    const bodyColor = 0x3d7bff;   // 亮藍本體（跟綠/紅/紫等怪色區別）
    const strokeColor = 0x0a1f5a; // 深藍描邊
    const ringColor = 0x9fd0ff;   // 淺藍外環光暈
    const g = this.add.graphics();

    // 外環光暈（雙層淡藍圓）
    g.fillStyle(ringColor, 0.22);
    g.fillCircle(cx, cy, radius + 5);
    g.lineStyle(3, ringColor, 0.9);
    g.strokeCircle(cx, cy, radius + 3);

    // 本體：圓角方塊（描邊 + 填色）
    const s = radius * 1.5;        // 方塊邊長
    const half = s / 2;
    const rad = radius * 0.35;     // 圓角
    g.fillStyle(strokeColor, 1);
    g.fillRoundedRect(cx - half - 2, cy - half - 2, s + 4, s + 4, rad + 2);
    g.fillStyle(bodyColor, 1);
    g.fillRoundedRect(cx - half, cy - half, s, s, rad);

    // 白色十字（守護/醫療標誌）
    const armW = s * 0.22;         // 十字臂寬
    const armL = s * 0.62;         // 十字臂長
    g.fillStyle(0xffffff, 0.95);
    g.fillRect(cx - armW / 2, cy - armL / 2, armW, armL); // 直
    g.fillRect(cx - armL / 2, cy - armW / 2, armL, armW); // 橫

    g.generateTexture(key, size, size);
    g.destroy();
  }

  /**
   * v36：BOSS 戰錨點貼圖——青色發光菱形 + 外環 + 中心亮點（走位落點標記）。
   * 跟圓形怪、藍方塊 NPC 明顯區別，一眼認出是「可衝過去的走位點」。
   */
  private makeAnchorTexture(key: string, radius: number): void {
    const size = radius * 2 + 14;
    const cx = size / 2, cy = size / 2;
    const body = 0x00e5ff, stroke = 0x063842, ring = 0x7bf5ff;
    const g = this.add.graphics();
    // 外環光暈
    g.fillStyle(ring, 0.20); g.fillCircle(cx, cy, radius + 6);
    g.lineStyle(2, ring, 0.9); g.strokeCircle(cx, cy, radius + 4);
    // 菱形（旋轉 45° 的方塊）：用四點多邊形
    const rr = radius + 2;
    const diamond = (rad: number, color: number): void => {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(cx, cy - rad); g.lineTo(cx + rad, cy);
      g.lineTo(cx, cy + rad); g.lineTo(cx - rad, cy);
      g.closePath(); g.fillPath();
    };
    diamond(rr, stroke);            // 描邊底
    diamond(radius - 1, body);      // 本體
    // 中心亮點
    g.fillStyle(0xffffff, 0.9); g.fillCircle(cx, cy, radius * 0.28);
    g.generateTexture(key, size, size);
    g.destroy();
  }
  private makeHumanoidTexture(key: string, radius: number, fill: number, stroke: number): void {
    const size = radius * 2 + 8; // 留描邊/四肢空間
    const cx = size / 2;
    const cy = size / 2;
    const g = this.add.graphics();

    // 深色描邊底（先畫大一號的相同形狀當外框）
    const drawFigure = (color: number, grow: number): void => {
      g.fillStyle(color, 1);
      // 軀幹：沿朝向(x)的橢圓身體
      g.fillEllipse(cx, cy, radius * 1.15 + grow, radius * 1.5 + grow);
      // 頭：偏向前方(+x)的圓
      g.fillCircle(cx + radius * 0.62, cy, radius * 0.5 + grow * 0.5);
      // 雙臂：身體兩側往前的小橢圓（上下各一）
      g.fillEllipse(cx + radius * 0.15, cy - radius * 0.72, radius * 0.7 + grow, radius * 0.42 + grow);
      g.fillEllipse(cx + radius * 0.15, cy + radius * 0.72, radius * 0.7 + grow, radius * 0.42 + grow);
      // 雙腿：身體後方(-x)兩條
      g.fillEllipse(cx - radius * 0.62, cy - radius * 0.38, radius * 0.55 + grow, radius * 0.32 + grow);
      g.fillEllipse(cx - radius * 0.62, cy + radius * 0.38, radius * 0.55 + grow, radius * 0.32 + grow);
    };

    // 1) 描邊層（放大一點的深色輪廓）
    drawFigure(stroke, 2);
    // 2) 主體色
    drawFigure(fill, 0);
    // 3) 朝向提示：頭前方一個亮色小三角（指向 +x），強化「面朝方向」
    g.fillStyle(0xffffff, 0.9);
    const noseX = cx + radius * 1.05;
    g.fillTriangle(
      noseX, cy,
      cx + radius * 0.7, cy - radius * 0.28,
      cx + radius * 0.7, cy + radius * 0.28
    );
    // 4) 頭部高光，增加立體感
    g.fillStyle(0xffffff, 0.4);
    g.fillCircle(cx + radius * 0.62, cy - radius * 0.12, radius * 0.16);

    g.generateTexture(key, size, size);
    g.destroy();
  }
  private makeGroundTexture(): void {
    const tile = 64;
    const g = this.add.graphics();
    g.fillStyle(0x1b1d2a, 1);
    g.fillRect(0, 0, tile, tile);
    g.lineStyle(2, 0x252a3d, 1);
    g.strokeRect(0, 0, tile, tile);
    // 內部小點綴
    g.fillStyle(0x222538, 1);
    g.fillRect(tile / 2 - 3, tile / 2 - 3, 6, 6);
    g.generateTexture('ground', tile, tile);
    g.destroy();
  }

  /** 產生粒子/命中特效用的小白塊 */
  private makeParticleTexture(): void {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 8, 8);
    g.generateTexture('spark', 8, 8);
    g.destroy();
  }
}
