import Phaser from 'phaser';
import { GameConfig } from '../config';

/** 彩票圖示紋理 key（第一次使用時以 Graphics 畫出並產生，整個遊戲共用） */
export const TICKET_TEXTURE = 'ticket-icon';

/** 彩票圖示的繪製尺寸與配色（像素，產生紋理用；顯示大小由各特效的縮放決定） */
const ICON = {
  WIDTH: 48,
  HEIGHT: 30,
  RADIUS: 5,
  /** 左右兩側的半圓缺口半徑 */
  NOTCH_RADIUS: 5,
  /** 存根虛線離左緣的距離與虛線段長 / 間隔 */
  STUB_X: 14,
  DASH: 4,
  GAP: 3,
  /** 中央星形：外 / 內半徑 */
  STAR_OUTER: 7,
  STAR_INNER: 3,
  FILL: 0xffc94a,
  BORDER: 0x8a5a00,
  BORDER_WIDTH: 2,
  ACCENT: 0xd9480f
} as const;

/** 星形的角數 */
const STAR_POINTS = 5;

/**
 * 確保彩票圖示紋理存在：金色票券、左右半圓缺口、左側存根虛線、中央紅色星形
 *
 * @param scene 任一場景（紋理由整個遊戲共用）
 */
export function ensureTicketTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TICKET_TEXTURE)) return;
  const w = ICON.WIDTH, h = ICON.HEIGHT, pad = ICON.BORDER_WIDTH;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(ICON.FILL, 1).fillRoundedRect(pad, pad, w, h, ICON.RADIUS);
  g.lineStyle(ICON.BORDER_WIDTH, ICON.BORDER, 1).strokeRoundedRect(pad, pad, w, h, ICON.RADIUS);
  // 左右缺口：用透明色挖不出來，改畫成邊框色的半圓（看起來像打孔）
  g.fillStyle(ICON.BORDER, 1)
    .fillCircle(pad, pad + h / 2, ICON.NOTCH_RADIUS)
    .fillCircle(pad + w, pad + h / 2, ICON.NOTCH_RADIUS);
  g.lineStyle(1.5, ICON.BORDER, 0.8);
  for (let y = pad + ICON.GAP; y < pad + h - ICON.GAP; y += ICON.DASH + ICON.GAP) {
    g.lineBetween(pad + ICON.STUB_X, y, pad + ICON.STUB_X, Math.min(y + ICON.DASH, pad + h - ICON.GAP));
  }
  const cx = pad + ICON.STUB_X + (w - ICON.STUB_X) / 2, cy = pad + h / 2;
  const star: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < STAR_POINTS * 2; i++) {
    const r = i % 2 === 0 ? ICON.STAR_OUTER : ICON.STAR_INNER;
    const a = -Math.PI / 2 + (i * Math.PI) / STAR_POINTS;
    star.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  g.fillStyle(ICON.ACCENT, 1).fillPoints(star, true);
  g.generateTexture(TICKET_TEXTURE, w + pad * 2, h + pad * 2);
  g.destroy();
}

/** 彩票特效的顯示選項 */
export interface TicketFxOptions {
  /** 深度 */
  depth: number;
  /** 捲動係數（UI 場景的畫面固定物件傳 0） */
  scrollFactor?: number;
  /** 放大倍率（例：打倒寶箱怪的大獎） */
  scale?: number;
}

/**
 * 彩票獲得提示：彩票圖示 + 張數（不加「+」），從小彈出放大、停一下，再往上飄並淡出
 *
 * @param scene 場景
 * @param x 中心 x
 * @param y 中心 y
 * @param tickets 張數（0 以下不顯示）
 * @param opts 深度等顯示選項
 */
export function popTicketReward(scene: Phaser.Scene, x: number, y: number, tickets: number, opts: TicketFxOptions): void {
  if (tickets <= 0) return;
  const cfg = GameConfig.ticketFx.popup;
  ensureTicketTexture(scene);
  const icon = scene.add.image(0, 0, TICKET_TEXTURE).setScale(cfg.iconScale).setOrigin(1, 0.5);
  const text = scene.add.text(cfg.gap, 0, String(tickets), {
    fontFamily: 'monospace', fontStyle: 'bold', fontSize: cfg.fontSize, color: cfg.color,
    stroke: cfg.stroke, strokeThickness: cfg.strokeThickness
  }).setOrigin(0, 0.5);
  // 圖示 + 數字整組置中
  const offsetX = (icon.displayWidth - text.width - cfg.gap) / 2;
  const scale = opts.scale ?? 1;
  const root = scene.add.container(x + offsetX * scale, y, [icon, text])
    .setDepth(opts.depth).setScrollFactor(opts.scrollFactor ?? 1).setScale(scale * cfg.popFromScale);
  scene.tweens.add({ targets: root, scale, duration: cfg.popMs, ease: 'Back.easeOut' });
  scene.tweens.add({
    targets: root, y: y - cfg.riseY, alpha: 0, delay: cfg.popMs + cfg.holdMs, duration: cfg.fadeMs, ease: 'Cubic.easeIn',
    onComplete: () => root.destroy()
  });
}

/**
 * 彩票噴泉：count 張彩票圖示從 (x, y) 往上四散噴出、受重力落下並淡出（純視覺）
 *
 * @param scene 場景
 * @param x 噴發點 x
 * @param y 噴發點 y
 * @param count 張數（上限 fountain.maxIcons）
 * @param opts 深度等顯示選項
 */
export function ticketFountain(scene: Phaser.Scene, x: number, y: number, count: number, opts: TicketFxOptions): void {
  const cfg = GameConfig.ticketFx.fountain;
  ensureTicketTexture(scene);
  const n = Math.min(count, cfg.maxIcons);
  const spread = Phaser.Math.DegToRad(cfg.spreadDeg) / 2;
  for (let i = 0; i < n; i++) {
    const icon = scene.add.image(x, y, TICKET_TEXTURE).setScale(cfg.iconScale * (opts.scale ?? 1))
      .setDepth(opts.depth).setScrollFactor(opts.scrollFactor ?? 1);
    const a = -Math.PI / 2 + Phaser.Math.FloatBetween(-spread, spread);
    const speed = Phaser.Math.FloatBetween(cfg.speedMin, cfg.speedMax);
    const vx = Math.cos(a) * speed, vy = Math.sin(a) * speed;
    const spin = Phaser.Math.FloatBetween(-cfg.spinDeg, cfg.spinDeg);
    const life = cfg.lifeMs * Phaser.Math.FloatBetween(1 - cfg.lifeJitter, 1 + cfg.lifeJitter);
    scene.tweens.addCounter({
      from: 0, to: life, duration: life,
      onUpdate: (tween) => {
        const t = (tween.getValue() ?? 0) / 1000;
        // 拋物線：等速水平 + 重力垂直
        icon.setPosition(x + vx * t, y + vy * t + 0.5 * cfg.gravity * t * t);
        icon.setAngle(spin * t);
        icon.setAlpha(Math.min(1, (life / 1000 - t) / (cfg.fadeMs / 1000)));
      },
      onComplete: () => icon.destroy()
    });
  }
}

/** 合併中的一筆彩票：位置與張數 */
interface PendingTicket {
  x: number;
  y: number;
  tickets: number;
}

/**
 * 彩票提示合併器（GameConfig.ticketFx.combine）：同一個角色在 windowMs 內得到的多筆彩票（例如一刀打中多隻怪）合成一次表演——
 * 只有一筆時照常顯示彩票圖示 + 張數；多筆時在各筆位置的中心爆開彩票噴泉，並只顯示一組放大的圖示 + 總張數
 */
export class TicketPopBatcher {
  /** 各領獎者合併窗口內的彩票 */
  private readonly pending = new Map<unknown, PendingTicket[]>();

  /**
   * @param scene 場景
   * @param depth 提示與噴泉的深度
   */
  constructor(private readonly scene: Phaser.Scene, private readonly depth: number) {}

  /**
   * 加入一筆彩票（0 張忽略）；這個角色的第一筆開始計時，windowMs 後一起表演
   *
   * @param owner 領獎者（同一位領獎者的彩票才合併）
   * @param x 位置 x
   * @param y 位置 y
   * @param tickets 張數
   */
  add(owner: unknown, x: number, y: number, tickets: number): void {
    if (tickets <= 0) return;
    const entries = this.pending.get(owner);
    if (entries) {
      entries.push({ x, y, tickets });
      return;
    }
    this.pending.set(owner, [{ x, y, tickets }]);
    this.scene.time.delayedCall(GameConfig.ticketFx.combine.windowMs, () => this.flush(owner));
  }

  /**
   * 表演並清掉一位領獎者的合併結果
   *
   * @param owner 領獎者
   */
  private flush(owner: unknown): void {
    const entries = this.pending.get(owner);
    this.pending.delete(owner);
    if (!entries) return;
    if (entries.length === 1) {
      popTicketReward(this.scene, entries[0].x, entries[0].y, entries[0].tickets, { depth: this.depth });
      return;
    }
    const cfg = GameConfig.ticketFx.combine;
    const total = entries.reduce((sum, e) => sum + e.tickets, 0);
    const cx = entries.reduce((sum, e) => sum + e.x, 0) / entries.length;
    const cy = entries.reduce((sum, e) => sum + e.y, 0) / entries.length;
    ticketFountain(this.scene, cx, cy, total, { depth: this.depth });
    popTicketReward(this.scene, cx, cy - cfg.offsetY, total, { depth: this.depth + 1, scale: cfg.scale });
  }
}
