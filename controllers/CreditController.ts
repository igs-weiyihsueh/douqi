import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';

/** CreditController 需要場景提供的能力 */
export interface CreditHost {
  readonly scene: Phaser.Scene;
  /** 全部角色 */
  characters(): ReadonlyArray<Character>;
  /**
   * 角色回到戰局前的擺放與外觀：顯示本體（P1 新美術皮膚一併顯示）、不在目前場地內時移回場地
   *
   * @param c 要回到戰局的角色
   */
  prepareResume(c: Character): void;
  /**
   * 角色在場上是否看得見（尚未進場時隱藏，P1 新美術皮膚一併處理）
   *
   * @param c 角色
   * @param visible 是否顯示
   */
  setCharacterVisible(c: Character, visible: boolean): void;
  /** 角色 CREDIT 或狀態改變（更新 HUD） */
  onCreditChanged(): void;
  /**
   * 頭上投幣提示的下緣位置（世界座標）：頭頂 UI 基準（角色畫面上看到的圖像頂端再往上 headUi.gap），
   * 等待續關時仍顯示的頭上覆蓋圖要讓開
   *
   * @param c 角色
   */
  promptAnchorY(c: Character): number;
  /**
   * 投了一次幣（播放多投多送量條亮格與光效）
   *
   * @param c 投幣的角色
   * @param cycleIndex 這次投幣在 coinCycle 中的位置（0 起算）
   */
  onCoinInserted(c: Character, cycleIndex: number): void;
  /**
   * 扣了 1 點 CREDIT（回饋帳本依占比存進各獎項的 buffer）
   *
   * @param c 扣點的角色
   */
  onCreditSpent(c: Character): void;
}

/**
 * CREDIT（投幣）：每位玩家各自計算（config.credit）。
 *
 * - 狀態：尚未進場（absent，角色隱藏）→ 投幣 → 遊玩中（playing）→ CREDIT 用完 → 等待續關（waiting，停在原地倒數）
 *   → 倒數內投幣回到遊玩中；逾時離場回到尚未進場
 * - 不在遊玩中的角色以 Character.leavePlay 離開戰局（alive = false）：不能操作、無敵、敵人不鎖定、不影響出怪與鏡頭
 * - 扣點：每次出手（openAttackWindow）後 attackWindowMs 內第一次命中敵人或木箱扣 1 點，一招最多扣 1 點；空揮不扣
 * - 多投多送：每次投幣依 coinCycle 循環給點（逾時離場才回到第一檔），下方面板量條亮一格並飛出光效（host.onCoinInserted）
 * - BOT：加入時自動投幣，用完自動再投
 * - 免費模式（X 鍵切換）：開啟時攻擊不扣 CREDIT
 * - 等待中的角色頭上顯示「投幣續關」與倒數；未進場的提示在下方面板（UIScene）
 */
export class CreditController {
  /** 各角色的頭上投幣提示（需要時才建立） */
  private readonly prompts = new Map<Character, Phaser.GameObjects.Text>();
  /** 等待續關的角色與投幣期限（場景時間；逾時離場） */
  private readonly continueDeadline = new Map<Character, number>();
  /** CREDIT 剛用完、待下一幀進入等待的角色（不在攻擊結算途中切換狀態） */
  private readonly pendingPause = new Set<Character>();
  /** 多投多送：各角色下一次投幣在 coinCycle 中的位置（投幣續關逾時離場時歸零） */
  private readonly coinStep = new Map<Character, number>();
  /** 免費模式：開啟時攻擊不扣 CREDIT（X 鍵切換） */
  private freePlay = false;

  constructor(private readonly host: CreditHost) {
    host.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.prompts.clear();
      this.pendingPause.clear();
      this.continueDeadline.clear();
      this.coinStep.clear();
    });
  }

  /**
   * 切換免費模式（攻擊不扣 CREDIT）
   *
   * @returns 切換後是否為免費模式
   */
  toggleFreePlay(): boolean {
    this.freePlay = !this.freePlay;
    return this.freePlay;
  }

  /** 是否啟用 CREDIT 系統 */
  get enabled(): boolean {
    return GameConfig.credit.enabled;
  }

  /**
   * 新角色加入：CREDIT 歸 0；BOT 自動投幣進場，玩家則先隱藏、等投幣
   *
   * @param c 新加入的角色
   */
  setupCharacter(c: Character): void {
    if (!this.enabled) return;
    c.credit = 0;
    c.noHpLoss = true; // 啟用 CREDIT 時沒有血量：被打不扣血、不會陣亡
    if (c.isBot) {
      this.insertCoin(c);
      return;
    }
    c.creditState = 'absent';
    c.leavePlay();
    this.host.setCharacterVisible(c, false);
    this.host.onCreditChanged();
  }

  /**
   * 多投多送：角色下一次投幣在 coinCycle 中的位置（= 這一輪已投幾次）
   *
   * @param c 角色
   */
  coinCycleStep(c: Character): number {
    return this.coinStep.get(c) ?? 0;
  }

  /**
   * 投幣：依多投多送的檔位加 CREDIT 並推進到下一檔（通知場景播量條光效）；未進場或等待中的角色立刻回到戰局（短暫無敵）
   *
   * @param c 投幣的角色
   */
  insertCoin(c: Character): void {
    if (!this.enabled) return;
    const cycle = GameConfig.credit.coinCycle;
    const step = this.coinStep.get(c) ?? 0;
    const gain = cycle[step % cycle.length];
    this.coinStep.set(c, (step + 1) % cycle.length);
    c.credit += gain;
    this.pendingPause.delete(c);
    this.continueDeadline.delete(c);
    if (c.creditState !== 'playing') {
      c.creditState = 'playing';
      this.host.prepareResume(c);
      c.resumePlay();
      c.invulnUntil = this.host.scene.time.now + GameConfig.credit.resumeInvulnMs;
    }
    this.host.onCoinInserted(c, step % cycle.length);
    this.host.onCreditChanged();
  }

  /**
   * 出手：開始這一招的扣點期限
   *
   * @param c 出手的角色
   * @param time 目前場景時間
   */
  openAttackWindow(c: Character, time: number): void {
    c.chargeWindowUntil = time + GameConfig.credit.attackWindowMs;
  }

  /**
   * 取消扣點期限（例如變身 BOSS 的攻擊不扣點）
   *
   * @param c 角色
   */
  cancelAttackWindow(c: Character): void {
    c.chargeWindowUntil = 0;
  }

  /**
   * 角色的攻擊命中（敵人或可破壞物件）：在這一招的扣點期限內且還沒扣過就扣 1 點（免費模式時不扣）；用完時 BOT 自動投幣，玩家下一幀進入等待
   *
   * @param c 攻擊的角色
   * @param time 目前場景時間
   */
  onAttackHit(c: Character, time: number): void {
    if (!this.enabled || this.freePlay || c.creditState !== 'playing' || time >= c.chargeWindowUntil) return;
    c.chargeWindowUntil = 0;
    c.credit = Math.max(0, c.credit - 1);
    this.host.onCreditSpent(c);
    if (c.credit === 0) {
      if (c.isBot) this.insertCoin(c);
      else this.pendingPause.add(c);
    }
    this.host.onCreditChanged();
  }

  /** 每幀：CREDIT 用完的角色進入等待（開始倒數）；倒數結束還沒投幣的離場；更新頭上投幣提示 */
  update(): void {
    if (!this.enabled) return;
    const now = this.host.scene.time.now;
    for (const c of this.pendingPause) {
      if (c.credit > 0 || c.creditState !== 'playing') continue;
      c.creditState = 'waiting';
      c.leavePlay();
      this.continueDeadline.set(c, now + GameConfig.credit.continueSeconds * 1000);
      this.host.onCreditChanged();
    }
    this.pendingPause.clear();
    for (const [c, deadline] of this.continueDeadline) {
      if (now < deadline) continue;
      // 逾時：離場，回到未進場（下方面板改顯示投幣加入遊戲），多投多送回到第一檔，二段變身等戰鬥狀態清掉
      this.continueDeadline.delete(c);
      this.coinStep.delete(c);
      c.creditState = 'absent';
      c.resetProgress();
      this.host.setCharacterVisible(c, false);
      this.host.onCreditChanged();
    }
    this.updatePrompts(now);
  }

  /**
   * 等待續關的角色頭上顯示「投幣續關 N」（N = 剩餘秒數，閃動），其餘隱藏（未進場的提示在下方面板，由 UIScene 顯示）
   *
   * @param now 目前場景時間
   */
  private updatePrompts(now: number): void {
    const cfg = GameConfig.credit;
    const blinkOn = now % cfg.prompt.blinkMs < cfg.prompt.blinkMs / 2;
    for (const c of this.host.characters()) {
      const deadline = this.continueDeadline.get(c);
      let prompt = this.prompts.get(c);
      if (c.creditState !== 'waiting' || deadline === undefined) {
        prompt?.setVisible(false);
        continue;
      }
      if (!prompt) {
        prompt = this.createPrompt();
        this.prompts.set(c, prompt);
      }
      const text = `${cfg.continueText} ${Math.max(0, Math.ceil((deadline - now) / 1000))}`;
      if (prompt.text !== text) prompt.setText(text);
      prompt.setPosition(c.x, this.host.promptAnchorY(c)).setVisible(true).setAlpha(blinkOn ? 1 : 0.45);
    }
  }

  /** 建立一個頭上投幣提示文字 */
  private createPrompt(): Phaser.GameObjects.Text {
    const p = GameConfig.credit.prompt;
    // 粗體中文加描邊時字形上緣會超出量到的行高而被切掉，上下留 padding
    return this.host.scene.add.text(0, 0, '', {
      fontSize: `${p.fontSize}px`, fontStyle: 'bold', color: p.color, stroke: p.stroke, strokeThickness: p.strokeThickness,
      padding: { top: p.paddingY, bottom: p.paddingY }
    }).setOrigin(0.5, 1).setDepth(p.depth);
  }
}
