import Phaser from 'phaser';
import { GameConfig } from '../config';

/**
 * TreasureRoomController 需要場景提供的能力。
 */
export interface TreasureRoomHost {
  readonly scene: Phaser.Scene;
  /** 獎勵關所在的移動區 */
  zone(): Phaser.Geom.Rectangle;
  /** 獎勵關所在的整格（覆蓋金色色調用） */
  slot(): Phaser.Geom.Rectangle;
  /** 場上獎勵關寶箱怪的數量 */
  roomTreasureCount(): number;
  /** 在 (x, y) 生成一隻獎勵關寶箱怪 */
  spawnRoomTreasure(x: number, y: number): void;
  /** 讓場上的獎勵關寶箱怪全部離場 */
  dismissRoomTreasures(): void;
  /** 時間到（寶箱怪已離場）：場景開出口 */
  onFinished(): void;
}

/** 倒數 HUD 文字樣式（畫面上方中央） */
const HUD_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace', fontSize: '40px', color: '#ffd166', stroke: '#000000', strokeThickness: 7, fontStyle: 'bold'
};
/** 最後倒數大數字樣式（畫面中央） */
const BIG_COUNT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace', fontSize: '180px', color: '#fff59d', stroke: '#7a3b00', strokeThickness: 12, fontStyle: 'bold'
};
/** 畫面固定 UI 的深度 */
const UI_DEPTH = 60;

/**
 * 隱藏入口後的獎勵關（寶藏密室）：在目前區域鋪上金色色調與金幣、寶石、寶箱裝飾，限時 durationMs 倒數；
 * 期間每 spawnIntervalMs 從隨機一處裝飾跳出一隻寶箱怪（場上最多 maxAlive 隻）。
 * 剩 finalCountdownSec 秒時畫面中央依序顯示大倒數數字；時間到寶箱怪全部離場，通知場景開出口。
 */
export class TreasureRoomController {
  private active = false;
  private endsAt = 0;
  private decor: Phaser.GameObjects.GameObject[] = [];
  private hud: Phaser.GameObjects.Text | null = null;
  /** 最後倒數已顯示到的秒數（避免同一秒重複顯示） */
  private lastBigSecond = 0;
  /** 下一次補寶箱怪的時間 */
  private nextSpawnAt = 0;
  private points: Array<{ x: number; y: number }> = [];

  constructor(private readonly host: TreasureRoomHost) {}

  /** 是否正在獎勵關中（倒數進行中） */
  get isActive(): boolean {
    return this.active;
  }

  /** 剩餘毫秒（不在獎勵關中為 0） */
  get remainingMs(): number {
    return this.active ? Math.max(0, this.endsAt - this.host.scene.time.now) : 0;
  }

  /** 金銀財寶裝飾的位置（寶箱怪從這些位置跳出） */
  get spawnPoints(): ReadonlyArray<{ x: number; y: number }> {
    return this.points;
  }

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /**
   * 開始獎勵關：鋪裝飾、顯示倒數
   *
   * @param time 目前場景時間
   */
  begin(time: number): void {
    this.end();
    const cfg = GameConfig.stage.treasureRoom;
    this.active = true;
    this.endsAt = time + cfg.durationMs;
    this.lastBigSecond = 0;
    this.drawDecor();
    this.nextSpawnAt = time + cfg.firstSpawnDelayMs;
    this.hud = this.scene.add.text(GameConfig.width / 2, cfg.hudY, '', HUD_STYLE)
      .setOrigin(0.5).setScrollFactor(0).setDepth(UI_DEPTH);
    this.showBanner(cfg.enterBanner);
    this.updateHud(time);
  }

  /**
   * 每幀：更新倒數 HUD 與最後大倒數，時間到通知場景
   *
   * @param time 目前場景時間
   */
  update(time: number): void {
    if (!this.active) return;
    this.updateHud(time);
    if (time < this.endsAt) {
      this.spawnTick(time);
      return;
    }
    this.active = false;
    this.host.dismissRoomTreasures();
    this.hud?.destroy();
    this.hud = null;
    this.showBanner(GameConfig.stage.treasureRoom.endBanner);
    this.host.onFinished();
  }

  /**
   * 時停結束：倒數順延凍結時間
   *
   * @param frozenMs 凍結時長
   */
  onTimeStopEnd(frozenMs: number): void {
    if (!this.active) return;
    this.endsAt += frozenMs;
    this.nextSpawnAt += frozenMs;
  }

  /** 離開獎勵關：移除裝飾與 HUD（不在獎勵關中時也可安全呼叫） */
  end(): void {
    if (this.active) this.host.dismissRoomTreasures();
    this.active = false;
    for (const o of this.decor) o.destroy();
    this.decor = [];
    this.points = [];
    this.hud?.destroy();
    this.hud = null;
  }

  /**
   * 到了補怪時間且場上未滿 maxAlive 隻，就從隨機一處裝飾跳出一隻寶箱怪
   *
   * @param time 目前場景時間
   */
  private spawnTick(time: number): void {
    const cfg = GameConfig.stage.treasureRoom;
    if (time < this.nextSpawnAt || this.points.length === 0) return;
    this.nextSpawnAt = time + cfg.spawnIntervalMs;
    if (this.host.roomTreasureCount() >= cfg.maxAlive) return;
    const p = this.points[Phaser.Math.Between(0, this.points.length - 1)];
    this.host.spawnRoomTreasure(p.x, p.y);
  }

  /** 倒數 HUD；剩 finalCountdownSec 秒內每秒在畫面中央跳一個大數字 */
  private updateHud(time: number): void {
    const cfg = GameConfig.stage.treasureRoom;
    const sec = Math.ceil(Math.max(0, this.endsAt - time) / 1000);
    this.hud?.setText(`${cfg.hudLabel} ${sec}s`);
    if (sec > 0 && sec <= cfg.finalCountdownSec && sec !== this.lastBigSecond) {
      this.lastBigSecond = sec;
      this.showBigNumber(sec);
    }
  }

  /** 畫面中央的大倒數數字：放大出現後縮回並淡出 */
  private showBigNumber(n: number): void {
    const t = this.scene.add.text(GameConfig.width / 2, GameConfig.height / 2, String(n), BIG_COUNT_STYLE)
      .setOrigin(0.5).setScrollFactor(0).setDepth(UI_DEPTH + 1).setScale(1.6);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 250, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: 600, duration: 350, onComplete: () => t.destroy() });
  }

  /** 畫面中央的提示橫幅 */
  private showBanner(text: string): void {
    const t = this.scene.add.text(GameConfig.width / 2, GameConfig.height * 0.32, text, { ...HUD_STYLE, fontSize: '48px' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(UI_DEPTH).setAlpha(0);
    this.scene.tweens.add({ targets: t, alpha: 1, scale: { from: 0.6, to: 1.1 }, duration: 400, yoyo: true, hold: 900, onComplete: () => t.destroy() });
  }

  /**
   * 寶藏密室裝飾：整格覆蓋金色色調，移動區內隨機散布金幣堆、寶石、寶箱（避開中央入口附近）
   */
  private drawDecor(): void {
    const cfg = GameConfig.stage.treasureRoom;
    const slot = this.host.slot(), zone = this.host.zone();
    const tint = this.scene.add.rectangle(slot.x, slot.y, slot.width, slot.height, cfg.tintColor, cfg.tintAlpha)
      .setOrigin(0, 0).setDepth(cfg.tintDepth);
    this.decor.push(tint);
    const g = this.scene.add.graphics().setDepth(cfg.decorDepth);
    this.decor.push(g);
    const margin = cfg.decorMargin;
    for (let i = 0, tries = 0; i < cfg.decorCount && tries < cfg.decorCount * 20; tries++) {
      const x = Phaser.Math.Between(zone.left + margin, zone.right - margin);
      const y = Phaser.Math.Between(zone.top + margin, zone.bottom - margin);
      if (Phaser.Math.Distance.Between(x, y, zone.centerX, zone.bottom) < cfg.entryClearRadius) continue;
      if (this.points.some((p) => Phaser.Math.Distance.Between(x, y, p.x, p.y) < cfg.decorSpacing)) continue;
      this.points.push({ x, y });
      const kind = i % 3;
      if (kind === 0) this.drawCoinPile(g, x, y);
      else if (kind === 1) this.drawGems(g, x, y);
      else this.drawChest(g, x, y);
      i++;
    }
  }

  /** 金幣堆：幾層由下往上縮小的金色橢圓 */
  private drawCoinPile(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    for (let k = 0; k < 4; k++) {
      const w = 70 - k * 14, yy = y - k * 9;
      g.fillStyle(0xb8860b, 1); g.fillEllipse(x, yy + 3, w, 18);
      g.fillStyle(0xffd23f, 1); g.fillEllipse(x, yy, w, 16);
    }
    g.fillStyle(0xfff4b0, 0.9); g.fillCircle(x - 8, y - 30, 3);
  }

  /** 寶石：幾顆不同顏色的菱形 */
  private drawGems(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    const colors = [0xe0115f, 0x50c878, 0x0f52ba, 0x9966cc];
    for (let k = 0; k < 4; k++) {
      const gx = x + (k - 1.5) * 18, gy = y + (k % 2) * 8;
      g.fillStyle(colors[k], 1);
      g.fillPoints([new Phaser.Geom.Point(gx, gy - 12), new Phaser.Geom.Point(gx + 9, gy), new Phaser.Geom.Point(gx, gy + 12), new Phaser.Geom.Point(gx - 9, gy)], true);
      g.fillStyle(0xffffff, 0.6); g.fillCircle(gx - 2, gy - 4, 2);
    }
  }

  /** 寶箱：木箱身 + 金色箍條 + 鎖扣，箱口溢出金光 */
  private drawChest(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.fillStyle(0xffd23f, 0.5); g.fillEllipse(x, y - 24, 60, 18);
    g.fillStyle(0x7a4a1e, 1); g.fillRect(x - 32, y - 22, 64, 40);
    g.fillStyle(0xd4a017, 1);
    g.fillRect(x - 32, y - 22, 64, 6);
    g.fillRect(x - 24, y - 22, 6, 40);
    g.fillRect(x + 18, y - 22, 6, 40);
    g.fillRect(x - 5, y - 6, 10, 12);
  }
}
