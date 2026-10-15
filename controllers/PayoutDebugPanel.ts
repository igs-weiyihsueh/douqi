import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import { PayoutController, SEAT_PRIZES, SHARED_PRIZES, type PayoutPrize } from './PayoutController';

/** 面板上各獎項的名稱 */
const PRIZE_LABELS: Record<PayoutPrize, string> = {
  secondForm: '二段變身獎勵',
  combo: '連段獎勵',
  crate: '木箱獎勵',
  treasure: '寶箱怪獎勵',
  lowChest: '低階寶箱',
  highChest: '高階寶箱',
  boss: 'BOSS獎勵',
  treasureRoom: '派對獎勵'
};
/** 文字更新間隔（毫秒） */
const REFRESH_MS = 200;

/**
 * 回饋帳本除錯面板（config.payout.debugKey 開關）：畫面左上角顯示累計投幣 / 扣掉的 CREDIT / 出票、實際 RTP 與上限、
 * 每 CREDIT 平均回饋、占比合計，以及各 P 位與共用 buffer 目前存的張數。開啟時才建立文字並定時更新
 */
export class PayoutDebugPanel {
  private text: Phaser.GameObjects.Text | null = null;
  private timer: Phaser.Time.TimerEvent | null = null;

  /**
   * @param scene 所在場景
   * @param payout 回饋帳本
   * @param characters 全部角色（依 P 位順序）
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly payout: PayoutController,
    private readonly characters: () => ReadonlyArray<Character>
  ) {
    scene.input.keyboard?.on(`keydown-${GameConfig.payout.debugKey}`, () => this.toggle());
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.disable());
  }

  /** 開關面板 */
  toggle(): void {
    if (this.text) this.disable();
    else this.enable();
  }

  /** 開啟：建立文字並定時更新 */
  private enable(): void {
    const cfg = GameConfig.payout.debugPanel;
    this.text = this.scene.add.text(cfg.x, cfg.y, '', {
      fontFamily: 'monospace', fontSize: cfg.fontSize, color: '#ffe066', backgroundColor: '#000000cc', padding: { x: 8, y: 6 }
    }).setScrollFactor(0).setDepth(cfg.depth);
    this.timer = this.scene.time.addEvent({ delay: REFRESH_MS, loop: true, callback: () => this.refresh() });
    this.refresh();
  }

  /** 關閉：移除文字與計時器 */
  private disable(): void {
    this.timer?.remove();
    this.timer = null;
    this.text?.destroy();
    this.text = null;
  }

  /** 重組面板文字 */
  private refresh(): void {
    if (!this.text) return;
    const p = this.payout;
    const cfg = GameConfig.payout;
    const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
    const lines = [
      `【回饋帳本】${cfg.debugKey} 關閉`,
      `投幣 ${p.coinsIn}（票值 ${p.coinsIn * cfg.coinTickets}）  CREDIT ${p.creditsSpent}  出票 ${p.ticketsOut}`,
      `實際 RTP ${pct(p.actualRtp)} / 上限 ${pct(cfg.rtpCap)}`,
      `每 CREDIT 平均回饋 ${PayoutController.ticketsPerCredit().toFixed(2)} 張  占比合計 ${pct(PayoutController.shareTotal())}`,
      '— 各 P 位 buffer（張）—',
      `${'獎項'.padEnd(6, '　')}${this.characters().map((c) => `P${c.index + 1}`.padStart(8)).join('')}`,
      ...SEAT_PRIZES.map((prize) =>
        `${PRIZE_LABELS[prize].padEnd(6, '　')}${this.characters().map((c) => p.seatBalance(c, prize).toFixed(1).padStart(8)).join('')}`),
      '— 共用 buffer（張）—',
      ...SHARED_PRIZES.map((prize) => `${PRIZE_LABELS[prize].padEnd(6, '　')}${p.sharedBalance(prize).toFixed(1).padStart(8)}`),
      `BOSS 門檻 ${cfg.boss.minBudget}${p.bossFunded ? '（已存夠）' : ''}  寶箱怪門檻 ${cfg.treasure.prize}${p.treasureFunded ? '（已存夠）' : ''}  密室預算 ${cfg.treasureRoom.budget}${p.roomFunded ? '（已存夠）' : ''}`
    ];
    this.text.setText(lines);
  }
}
