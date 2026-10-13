import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import { StageSettlementPanel, type SettlementColumn } from '../objects/StageSettlementPanel';

/**
 * StageSettlementController 需要場景提供的能力。
 */
export interface StageSettlementHost {
  readonly scene: Phaser.Scene;
  /** 已加入的角色（依 P 位順序） */
  characters(): ReadonlyArray<Character>;
  /** 角色在畫面上的位置（畫面座標；彩票飛去的終點） */
  screenPosOf(c: Character): { x: number; y: number };
  /** 依分數分配寶箱獎池（PayoutController.payStageChest），回傳各角色張數 */
  payStageChest(entries: ReadonlyArray<{ c: Character; score: number }>, tier: 'low' | 'high'): number[];
  /** 彩票送到角色身上（頭上飄字 + 下方面板特效） */
  onTicketsArrived(c: Character, tickets: number): void;
  /** 結算播完：場景開出口、恢復操作 */
  onFinished(): void;
}

/** 結算演出的畫面固定物件深度（面板在寶箱之上） */
const PANEL_DEPTH = 82;
const CHEST_DEPTH = 81;

/** 寶箱的排版與配色 */
const CHEST_CONFIG = {
  /** 降落起點 / 終點（畫面座標，寶箱中心） */
  X: 960,
  FROM_Y: -160,
  TO_Y: 520,
  /** 箱身與箱蓋尺寸（箱蓋疊在箱身上緣，打開時往上掀並傾斜淡出） */
  BODY_WIDTH: 240,
  BODY_HEIGHT: 140,
  LID_HEIGHT: 56,
  RADIUS: 14,
  TRIM_WIDTH: 6,
  LOCK_SIZE: 30,
  LID_OPEN_RISE: 90,
  LID_OPEN_ANGLE: -25,
  /** 打開時的金光：起始半徑、放大倍率、顏色 */
  GLOW_RADIUS: 120,
  GLOW_SCALE: 2.2,
  GLOW_COLOR: 0xfff3b0,
  /** 各階級配色：箱身 / 金屬邊 */
  COLORS: {
    low: { body: 0x8d5524, trim: 0xd0d4dc },
    high: { body: 0xe0a800, trim: 0xfff3b0 }
  },
  /** 寶箱上方的階級名稱 */
  LABEL_OFFSET_Y: -150,
  LABEL_STYLE: { fontFamily: 'monospace', fontSize: '40px', fontStyle: 'bold', color: '#ffe082', stroke: '#000000', strokeThickness: 6 },
  /** 飛出的彩票圖示：每人最多幾張、每張間隔、字型 */
  MAX_TICKET_ICONS: 5,
  TICKET_STAGGER_MS: 80,
  TICKET_STYLE: { fontSize: '44px' }
} as const;

/** 寶箱演出用的物件 */
interface ChestFx {
  root: Phaser.GameObjects.Container;
  lid: Phaser.GameObjects.Graphics;
  glow: Phaser.GameObjects.Arc;
}

/**
 * 關卡結算（config.stageSettlement）：一般清敵關打完、場上寶箱怪 / 亂入 BOSS / 變身 BOSS 都結束後由場景呼叫 start。
 *
 * 1. 結算面板：4 個 P 位這一關的擊敗 / 傷害 / 破壞、分數與名次（StageSettlementPanel）
 * 2. 面板收起 → 寶箱從畫面上方降下 → 打開，參與玩家這一階寶箱 buffer 合成的獎池依分數比例分配
 * 3. 彩票從寶箱飛到各玩家身上 → 通知場景結束（開出口、恢復操作）
 *
 * 參與者 = 開始結算時還在場上的角色；沒有人時直接結束。播放期間場景凍結角色（isActive）
 */
export class StageSettlementController {
  private active = false;

  constructor(private readonly host: StageSettlementHost) {}

  /** 結算演出播放中（場景據此凍結角色、不開出口） */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * 分數 = 擊敗 × perKill + 傷害 × perDamage + 破壞 × perBreak
   *
   * @param c 角色
   */
  static scoreOf(c: Character): number {
    const w = GameConfig.stageSettlement.score;
    const s = c.stageStats;
    return Math.round(s.kills * w.perKill + s.damage * w.perDamage + s.breaks * w.perBreak);
  }

  /**
   * 開始結算演出
   *
   * @param stageNumber 剛打完的關卡編號（標題用）
   * @param tier 這一關的寶箱階級
   */
  start(stageNumber: number, tier: 'low' | 'high'): void {
    const characters = this.host.characters();
    const entries = characters.filter((c) => c.alive).map((c) => ({ c, score: StageSettlementController.scoreOf(c) }));
    if (entries.length === 0) {
      this.host.onFinished();
      return;
    }
    this.active = true;
    const t = GameConfig.stageSettlement.timing;
    const panel = new StageSettlementPanel(this.host.scene, `第 ${stageNumber} 關 結算`, this.buildColumns(characters, entries), PANEL_DEPTH);
    // 依序排程各段演出：at = 這一段從結算開始算起的時間
    let at = 0;
    const schedule = (delayMs: number, fn: () => void): void => {
      at += delayMs;
      this.host.scene.time.delayedCall(at, fn);
    };
    panel.open(t.panelInMs);
    schedule(t.panelInMs, () => panel.countStats(t.statsCountMs));
    schedule(t.statsCountMs, () => panel.countScores(t.scoreCountMs));
    schedule(t.scoreCountMs, () => panel.revealRanks(t.rankPopMs));
    schedule(t.rankPopMs + t.holdMs, () => panel.close(t.panelOutMs));
    let chest: ChestFx | null = null;
    schedule(t.panelOutMs, () => { chest = this.dropChest(tier, t.chestDropMs); });
    let amounts: number[] = [];
    schedule(t.chestDropMs + t.chestOpenDelayMs, () => {
      if (chest) this.openChest(chest, t.chestOpenMs);
      amounts = this.host.payStageChest(entries, tier);
    });
    schedule(t.chestOpenMs, () => {
      entries.forEach((e, i) => this.flyTickets(e.c, amounts[i], t.ticketFlyMs));
    });
    schedule(t.ticketFlyMs + t.endHoldMs, () => {
      chest?.root.destroy();
      this.active = false;
      this.host.onFinished();
    });
  }

  /**
   * 組出面板 4 欄：參與者帶戰績、分數與名次（同分同名次），已加入但不在場上的為等待投幣，沒有人的 P 位為未加入
   *
   * @param characters 已加入的角色
   * @param entries 參與結算的角色與分數
   */
  private buildColumns(characters: ReadonlyArray<Character>, entries: ReadonlyArray<{ c: Character; score: number }>): SettlementColumn[] {
    const colors = GameConfig.characters.colors;
    const columns: SettlementColumn[] = [];
    for (let i = 0; i < GameConfig.characters.count; i++) {
      const c = characters[i];
      const entry = entries.find((e) => e.c === c);
      const base = { label: `${i + 1}P`, color: colors[i % colors.length], kills: 0, damage: 0, breaks: 0, score: 0, rank: 0 };
      if (!c || !entry) {
        columns.push({ ...base, state: c ? 'waiting' : 'empty' });
        continue;
      }
      const rank = 1 + entries.filter((e) => e.score > entry.score).length;
      columns.push({ ...base, state: 'playing', ...c.stageStats, score: entry.score, rank });
    }
    return columns;
  }

  /**
   * 寶箱從畫面上方彈跳降下
   *
   * @param tier 寶箱階級（配色與名稱）
   * @param ms 降落時長
   */
  private dropChest(tier: 'low' | 'high', ms: number): ChestFx {
    const cfg = CHEST_CONFIG;
    const colors = cfg.COLORS[tier];
    const scene = this.host.scene;
    const w = cfg.BODY_WIDTH, h = cfg.BODY_HEIGHT;
    const glow = scene.add.circle(0, -h / 2, cfg.GLOW_RADIUS, cfg.GLOW_COLOR, 0.8).setAlpha(0);
    const body = scene.add.graphics()
      .fillStyle(colors.body, 1).fillRoundedRect(-w / 2, -h / 2, w, h, cfg.RADIUS)
      .lineStyle(cfg.TRIM_WIDTH, colors.trim, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, cfg.RADIUS)
      .fillStyle(colors.trim, 1).fillRect(-cfg.LOCK_SIZE / 2, -h / 2, cfg.LOCK_SIZE, cfg.LOCK_SIZE);
    const lid = scene.add.graphics({ x: 0, y: -h / 2 })
      .fillStyle(colors.body, 1).fillRoundedRect(-w / 2, -cfg.LID_HEIGHT, w, cfg.LID_HEIGHT, cfg.RADIUS)
      .lineStyle(cfg.TRIM_WIDTH, colors.trim, 1).strokeRoundedRect(-w / 2, -cfg.LID_HEIGHT, w, cfg.LID_HEIGHT, cfg.RADIUS);
    const label = scene.add.text(0, cfg.LABEL_OFFSET_Y, tier === 'high' ? '高階寶箱' : '低階寶箱', cfg.LABEL_STYLE).setOrigin(0.5);
    const root = scene.add.container(cfg.X, cfg.FROM_Y, [glow, body, lid, label]).setScrollFactor(0).setDepth(CHEST_DEPTH);
    scene.tweens.add({ targets: root, y: cfg.TO_Y, duration: ms, ease: 'Bounce.easeOut' });
    return { root, lid, glow };
  }

  /**
   * 打開寶箱：箱蓋往上掀並淡出、金光擴散
   *
   * @param chest 寶箱物件
   * @param ms 打開時長
   */
  private openChest(chest: ChestFx, ms: number): void {
    const cfg = CHEST_CONFIG;
    const scene = this.host.scene;
    scene.tweens.add({
      targets: chest.lid, y: chest.lid.y - cfg.LID_OPEN_RISE, angle: cfg.LID_OPEN_ANGLE, alpha: 0, duration: ms, ease: 'Quad.easeOut'
    });
    scene.tweens.add({ targets: chest.glow, alpha: { from: 1, to: 0 }, scale: { from: 1, to: cfg.GLOW_SCALE }, duration: ms * 3 });
  }

  /**
   * 彩票圖示從寶箱飛到角色身上，最後一張到達時通知場景；0 張時不飛
   *
   * @param c 領獎的角色
   * @param tickets 張數
   * @param ms 整段飛行時長（含各張的間隔）
   */
  private flyTickets(c: Character, tickets: number, ms: number): void {
    if (tickets <= 0) return;
    const cfg = CHEST_CONFIG;
    const scene = this.host.scene;
    const icons = Math.min(tickets, cfg.MAX_TICKET_ICONS);
    const flyMs = Math.max(1, ms - cfg.TICKET_STAGGER_MS * (icons - 1));
    const to = this.host.screenPosOf(c);
    for (let i = 0; i < icons; i++) {
      const icon = scene.add.text(cfg.X, cfg.TO_Y - cfg.BODY_HEIGHT / 2, '🎫', cfg.TICKET_STYLE)
        .setOrigin(0.5).setScrollFactor(0).setDepth(PANEL_DEPTH);
      const last = i === icons - 1;
      scene.tweens.add({
        targets: icon, x: to.x, y: to.y, delay: i * cfg.TICKET_STAGGER_MS, duration: flyMs, ease: 'Cubic.easeIn',
        onComplete: () => {
          icon.destroy();
          if (last) this.host.onTicketsArrived(c, tickets);
        }
      });
    }
  }
}
