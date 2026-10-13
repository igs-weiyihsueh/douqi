import { GameConfig } from '../config';
import type { Character } from '../objects/Character';

/** 各 P 位自己的 buffer：個人打到的獎項 */
export type SeatPrize = 'secondForm' | 'combo' | 'crate' | 'lowChest' | 'highChest';
/** 4 個 P 位共用的 buffer：全隊一起的獎項 */
export type SharedPrize = 'boss' | 'treasureRoom';
/** 全部獎項 */
export type PayoutPrize = SeatPrize | SharedPrize;

/** 各 P 位 buffer 的獎項（顯示 / 走訪順序） */
export const SEAT_PRIZES: ReadonlyArray<SeatPrize> = ['secondForm', 'combo', 'crate', 'lowChest', 'highChest'];
/** 共用 buffer 的獎項（顯示 / 走訪順序） */
export const SHARED_PRIZES: ReadonlyArray<SharedPrize> = ['boss', 'treasureRoom'];

/** 亂入 BOSS 這一次鎖定的預算（張）：打中小獎 / 打倒大獎 / 變身 BOSS 期間打怪的獎 */
interface BossBudget {
  hit: number;
  kill: number;
  form: number;
  /** 每次打中給幾張 */
  perHit: number;
  /** 變身 BOSS 期間每打倒一隻怪給幾張（變身開始時才決定） */
  perFormKill: number;
}

/** 寶藏密室這一次鎖定的加碼預算（張） */
interface RoomBudget {
  remaining: number;
  perHit: number;
  perKill: number;
}

/**
 * 回饋（RTP）帳本與 buffer（config.payout）：彩票機每投 1 幣長期平均回饋 coinTickets × rtpCap 張。
 *
 * - 每扣 1 CREDIT，依 shares 把「每 CREDIT 平均回饋」存進各獎項的 buffer（各 P 位自己的 + 4 個 P 位共用的）
 * - 獎項觸發時從 buffer 發（只發整數張，零頭留在 buffer）；發不完、沒觸發的票留著下次再發，不會消失也不會超發
 * - 存進的總量 ≤ 每 CREDIT 平均回饋 × 扣掉的 CREDIT；多投多送累計 CREDIT 不超過「平均 1 幣 CREDIT × 投幣數」，
 *   所以整台機器的實際 RTP 不會超過 rtpCap（投滿一輪且 CREDIT 打完時剛好到）
 * - 亂入 BOSS 與寶藏密室用共用 buffer：存到門檻才出現，出現時鎖定預算，沒發完的退回
 * - 帳本記錄累計投幣、扣掉的 CREDIT 與出票，供除錯面板顯示實際 RTP
 */
export class PayoutController {
  /** 累計投幣數（4 個 P 位合計，含 BOT 自動投幣） */
  coinsIn = 0;
  /** 累計扣掉的 CREDIT */
  creditsSpent = 0;
  /** 累計出票 */
  ticketsOut = 0;
  /** 各 P 位的 buffer（張，含零頭） */
  private readonly seats = new Map<Character, Record<SeatPrize, number>>();
  /** 共用 buffer（張，含零頭） */
  private readonly shared: Record<SharedPrize, number> = { boss: 0, treasureRoom: 0 };
  /** 二段變身中的角色：這次變身每打中一下給幾張（變身期間第一次打中時依 buffer 決定） */
  private readonly secondFormPerHit = new Map<Character, number>();
  private bossBudget: BossBudget | null = null;
  private roomBudget: RoomBudget | null = null;

  /** 平均 1 幣 CREDIT（多投多送一輪的平均） */
  static averageCreditsPerCoin(): number {
    const cycle = GameConfig.credit.coinCycle;
    return cycle.reduce((sum, v) => sum + v, 0) / cycle.length;
  }

  /** 每 CREDIT 平均回饋（張）= 1 幣票值 × RTP 上限 ÷ 平均 1 幣 CREDIT */
  static ticketsPerCredit(): number {
    const cfg = GameConfig.payout;
    return (cfg.coinTickets * cfg.rtpCap) / PayoutController.averageCreditsPerCoin();
  }

  /** 各獎項占比的合計（應等於 rtpCap） */
  static shareTotal(): number {
    const shares = GameConfig.payout.shares;
    return [...SEAT_PRIZES, ...SHARED_PRIZES].reduce((sum, p) => sum + shares[p], 0);
  }

  /** 目前實際 RTP（累計出票 ÷ 累計投幣票值；還沒投幣時為 0） */
  get actualRtp(): number {
    return this.coinsIn > 0 ? this.ticketsOut / (this.coinsIn * GameConfig.payout.coinTickets) : 0;
  }

  /**
   * 某 P 位某獎項 buffer 的目前量（張，含零頭）
   *
   * @param c 角色
   * @param prize 獎項
   */
  seatBalance(c: Character, prize: SeatPrize): number {
    return this.seats.get(c)?.[prize] ?? 0;
  }

  /**
   * 共用獎項 buffer 的目前量（張，含零頭；不含已鎖定、正在發的預算）
   *
   * @param prize 獎項
   */
  sharedBalance(prize: SharedPrize): number {
    return this.shared[prize];
  }

  /**
   * 投了一枚幣
   *
   * @param _c 投幣的角色（帳本只記整台合計）
   */
  onCoinInserted(_c: Character): void {
    this.coinsIn++;
  }

  /**
   * 扣了 1 CREDIT：依占比把每 CREDIT 平均回饋存進該 P 位與共用的 buffer
   *
   * @param c 扣點的角色
   */
  onCreditSpent(c: Character): void {
    this.creditsSpent++;
    const shares = GameConfig.payout.shares;
    // 占比以 RTP 計（合計 = rtpCap），換成每 CREDIT 張數：占比 ÷ rtpCap × 每 CREDIT 平均回饋
    const perShare = PayoutController.ticketsPerCredit() / GameConfig.payout.rtpCap;
    const seat = this.seatOf(c);
    for (const p of SEAT_PRIZES) seat[p] += shares[p] * perShare;
    for (const p of SHARED_PRIZES) this.shared[p] += shares[p] * perShare;
  }

  /**
   * 關卡結算寶箱：把參與玩家這一階寶箱 buffer 合成一個獎池，整數部分依分數比例分給各玩家（最大餘數法，總張數不變），
   * 零頭依各自存入的比例退回各 P 位 buffer。全隊分數都是 0 時改依存入比例分。
   *
   * @param entries 參與結算的角色與分數
   * @param tier 寶箱階級
   * @returns 各角色發出的張數（與 entries 同順序）
   */
  payStageChest(entries: ReadonlyArray<{ c: Character; score: number }>, tier: 'low' | 'high'): number[] {
    const prize: SeatPrize = tier === 'high' ? 'highChest' : 'lowChest';
    const deposits = entries.map((e) => this.seatOf(e.c)[prize]);
    const pool = deposits.reduce((sum, v) => sum + v, 0);
    const total = Math.floor(pool);
    const scores = entries.map((e) => Math.max(0, e.score));
    const weights = scores.some((s) => s > 0) ? scores : deposits;
    const amounts = PayoutController.splitByWeight(total, weights);
    const leftover = pool - total;
    entries.forEach((e, i) => { this.seatOf(e.c)[prize] = pool > 0 ? (leftover * deposits[i]) / pool : 0; });
    return entries.map((e, i) => (amounts[i] > 0 ? this.pay(e.c, amounts[i]) : 0));
  }

  /**
   * 把 total 張依權重分成整數（最大餘數法：先發各自的整數部分，剩下的依小數部分大到小各補 1 張），合計剛好 total
   *
   * @param total 要分的總張數
   * @param weights 各份的權重（合計 0 時全部 0 張）
   */
  private static splitByWeight(total: number, weights: ReadonlyArray<number>): number[] {
    const weightSum = weights.reduce((sum, w) => sum + w, 0);
    if (weightSum <= 0 || total <= 0) return weights.map(() => 0);
    const exact = weights.map((w) => (total * w) / weightSum);
    const amounts = exact.map((v) => Math.floor(v));
    let rest = total - amounts.reduce((sum, v) => sum + v, 0);
    const byFraction = exact.map((_, i) => i).sort((a, b) => (exact[b] - amounts[b]) - (exact[a] - amounts[a]));
    for (const i of byFraction) {
      if (rest <= 0) break;
      amounts[i]++;
      rest--;
    }
    return amounts;
  }

  /**
   * 木箱中獎：把木箱 buffer 的整數部分全部發出（沒打的木箱票留著，下次中獎更多）
   *
   * @param c 打破木箱的角色
   * @returns 發出的張數（0 = buffer 不到 1 張）
   */
  payCrate(c: Character): number {
    return this.takeSeat(c, 'crate', 1);
  }

  /**
   * HIT 連擊報獎：達到的階越高，發出連擊 buffer 的比例越高（payout.comboTierShares）
   *
   * @param c 領獎的角色
   * @param tierIndex 達到的里程碑索引
   * @returns 發出的張數
   */
  payCombo(c: Character, tierIndex: number): number {
    const tiers = GameConfig.payout.comboTierShares;
    return this.takeSeat(c, 'combo', tiers[Math.min(tierIndex, tiers.length - 1)]);
  }

  /**
   * 二段變身期間打中敵人：每打中一下發一份，份量在這次變身第一次打中時決定（buffer ÷ secondFormExpectedHits），發完為止
   *
   * @param c 攻擊的角色
   * @param time 目前場景時間
   * @returns 發出的張數（不在二段變身或 buffer 已空時為 0）
   */
  paySecondFormHit(c: Character, time: number): number {
    if (!c.isEmpowered(time)) return 0;
    let perHit = this.secondFormPerHit.get(c);
    if (perHit === undefined) {
      perHit = Math.max(1, Math.round(this.seatBalance(c, 'secondForm') / GameConfig.payout.secondFormExpectedHits));
      this.secondFormPerHit.set(c, perHit);
    }
    const seat = this.seatOf(c);
    const amount = Math.min(perHit, Math.floor(seat.secondForm));
    if (amount <= 0) return 0;
    seat.secondForm -= amount;
    return this.pay(c, amount);
  }

  /**
   * 每幀：二段變身結束的角色收掉這次變身的份量（下次變身依當時的 buffer 重算）
   *
   * @param time 目前場景時間
   */
  update(time: number): void {
    for (const c of this.secondFormPerHit.keys()) {
      if (!c.isEmpowered(time)) this.secondFormPerHit.delete(c);
    }
  }

  /** 共用 BOSS buffer 是否已存到亂入門檻 */
  get bossFunded(): boolean {
    return this.bossBudget === null && this.shared.boss >= GameConfig.payout.boss.minBudget;
  }

  /** 亂入 BOSS 登場：鎖定 BOSS buffer 的整數部分，拆成打中 / 打倒 / 變身三份 */
  startBoss(): void {
    const cfg = GameConfig.payout.boss;
    const budget = Math.floor(this.shared.boss);
    this.shared.boss -= budget;
    const hit = Math.floor(budget * cfg.hitShare);
    const kill = Math.floor(budget * cfg.killShare);
    this.bossBudget = {
      hit, kill, form: budget - hit - kill,
      perHit: Math.max(1, Math.round(hit / cfg.expectedHits)),
      perFormKill: 0
    };
  }

  /**
   * 亂入 BOSS 被打中：從打中預算發一份
   *
   * @param c 打中的角色
   * @returns 發出的張數
   */
  payBossHit(c: Character): number {
    const b = this.bossBudget;
    if (!b) return 0;
    const amount = Math.min(b.perHit, b.hit);
    b.hit -= amount;
    return amount > 0 ? this.pay(c, amount) : 0;
  }

  /**
   * 亂入 BOSS 被打倒：打倒預算全部發給擊殺者，沒發完的打中預算退回；變身預算留給變身 BOSS
   *
   * @param c 擊殺的角色
   * @returns 發出的張數
   */
  payBossKill(c: Character): number {
    const b = this.bossBudget;
    if (!b) return 0;
    const amount = b.kill;
    this.shared.boss += b.hit;
    b.hit = 0;
    b.kill = 0;
    return amount > 0 ? this.pay(c, amount) : 0;
  }

  /** 變身 BOSS 開始：變身預算平均分給預期打倒的怪數 */
  startBossForm(): void {
    const b = this.bossBudget;
    if (!b) return;
    b.perFormKill = Math.max(1, Math.round(b.form / GameConfig.payout.boss.formExpectedKills));
  }

  /**
   * 變身 BOSS 期間打倒一隻怪：從變身預算發一份
   *
   * @param c 變身中的角色
   * @returns 發出的張數
   */
  payBossFormKill(c: Character): number {
    const b = this.bossBudget;
    if (!b || b.perFormKill <= 0) return 0;
    const amount = Math.min(b.perFormKill, b.form);
    b.form -= amount;
    return amount > 0 ? this.pay(c, amount) : 0;
  }

  /** 這一次亂入 BOSS 結束（離場、屍體消失沒變身、變身結束）：沒發完的預算全部退回共用 buffer */
  endBoss(): void {
    const b = this.bossBudget;
    if (!b) return;
    this.shared.boss += b.hit + b.kill + b.form;
    this.bossBudget = null;
  }

  /** 共用密室 buffer 是否已存到一次密室的加碼預算 */
  get roomFunded(): boolean {
    return this.roomBudget === null && this.shared.treasureRoom >= GameConfig.payout.treasureRoom.budget;
  }

  /** 進入寶藏密室：鎖定一次的加碼預算，分成打倒獎與每下的打中獎 */
  startRoom(): void {
    const cfg = GameConfig.payout.treasureRoom;
    const budget = Math.min(cfg.budget, Math.floor(this.shared.treasureRoom));
    this.shared.treasureRoom -= budget;
    const killPart = budget * cfg.killShare;
    this.roomBudget = {
      remaining: budget,
      perKill: Math.max(1, Math.round(killPart / cfg.expectedKills)),
      perHit: Math.max(1, Math.round((budget - killPart) / (cfg.expectedKills * GameConfig.stage.treasureRoom.hitsToKill)))
    };
  }

  /**
   * 密室寶箱怪被打中：從密室預算發一份
   *
   * @param c 打中的角色
   * @returns 發出的張數
   */
  payRoomHit(c: Character): number {
    return this.takeRoom(c, this.roomBudget?.perHit ?? 0);
  }

  /**
   * 密室寶箱怪被打倒：從密室預算發打倒獎
   *
   * @param c 擊殺的角色
   * @returns 發出的張數
   */
  payRoomKill(c: Character): number {
    return this.takeRoom(c, this.roomBudget?.perKill ?? 0);
  }

  /** 離開寶藏密室：沒發完的加碼退回共用 buffer */
  endRoom(): void {
    if (!this.roomBudget) return;
    this.shared.treasureRoom += this.roomBudget.remaining;
    this.roomBudget = null;
  }

  /**
   * 從密室預算發最多 amount 張
   *
   * @param c 領獎的角色
   * @param amount 想發的張數
   */
  private takeRoom(c: Character, amount: number): number {
    const r = this.roomBudget;
    if (!r) return 0;
    const paid = Math.min(amount, r.remaining);
    r.remaining -= paid;
    return paid > 0 ? this.pay(c, paid) : 0;
  }

  /**
   * 從該 P 位某獎項 buffer 發出 fraction 比例（取整數張，零頭留著）
   *
   * @param c 領獎的角色
   * @param prize 獎項
   * @param fraction 發出的比例（0 ~ 1）
   */
  private takeSeat(c: Character, prize: SeatPrize, fraction: number): number {
    const seat = this.seatOf(c);
    const amount = Math.floor(seat[prize] * fraction);
    if (amount <= 0) return 0;
    seat[prize] -= amount;
    return this.pay(c, amount);
  }

  /**
   * 發票給角色並記入帳本
   *
   * @param c 領獎的角色
   * @param amount 張數
   */
  private pay(c: Character, amount: number): number {
    c.tickets += amount;
    this.ticketsOut += amount;
    return amount;
  }

  /**
   * 取得（必要時建立）角色的 P 位 buffer
   *
   * @param c 角色
   */
  private seatOf(c: Character): Record<SeatPrize, number> {
    let seat = this.seats.get(c);
    if (!seat) {
      seat = { secondForm: 0, combo: 0, crate: 0, lowChest: 0, highChest: 0 };
      this.seats.set(c, seat);
    }
    return seat;
  }
}
