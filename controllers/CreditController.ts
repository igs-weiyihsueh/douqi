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
}

/**
 * CREDIT（投幣）：每位玩家各自計算（config.credit）。
 *
 * - 狀態：尚未進場（absent，角色隱藏）→ 投幣 → 遊玩中（playing）→ CREDIT 用完 → 等待續關（waiting，停在原地）→ 投幣 → 遊玩中
 * - 不在遊玩中的角色以 Character.leavePlay 離開戰局（alive = false）：不能操作、無敵、敵人不鎖定、不影響出怪與鏡頭
 * - 扣點：每次出手（openAttackWindow）後 attackWindowMs 內第一次命中敵人扣 1 點，一招最多扣 1 點；空揮不扣
 * - BOT：加入時自動投幣，用完自動再投
 * - 免費攻擊（X 鍵切換）：開啟時攻擊不扣 CREDIT
 * - 未進場 / 等待中的角色頭上顯示投幣提示
 */
export class CreditController {
  /** 各角色的頭上投幣提示（需要時才建立） */
  private readonly prompts = new Map<Character, Phaser.GameObjects.Text>();
  /** CREDIT 剛用完、待下一幀進入等待的角色（不在攻擊結算途中切換狀態） */
  private readonly pendingPause = new Set<Character>();
  /** 免費攻擊：開啟時攻擊不扣 CREDIT（X 鍵切換） */
  private freePlay = false;

  constructor(private readonly host: CreditHost) {
    host.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.prompts.clear();
      this.pendingPause.clear();
    });
  }

  /**
   * 切換免費攻擊（攻擊不扣 CREDIT）
   *
   * @returns 切換後是否為免費攻擊
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
   * 投幣：CREDIT + coinValue；未進場或等待中的角色立刻回到戰局（短暫無敵）
   *
   * @param c 投幣的角色
   */
  insertCoin(c: Character): void {
    if (!this.enabled) return;
    c.credit += GameConfig.credit.coinValue;
    this.pendingPause.delete(c);
    if (c.creditState !== 'playing') {
      c.creditState = 'playing';
      this.host.prepareResume(c);
      c.resumePlay();
      c.invulnUntil = this.host.scene.time.now + GameConfig.credit.resumeInvulnMs;
    }
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
   * 角色命中敵人：在這一招的扣點期限內且還沒扣過就扣 1 點（免費攻擊時不扣）；用完時 BOT 自動投幣，玩家下一幀進入等待
   *
   * @param c 攻擊的角色
   * @param time 目前場景時間
   */
  onEnemyHit(c: Character, time: number): void {
    if (!this.enabled || this.freePlay || c.creditState !== 'playing' || time >= c.chargeWindowUntil) return;
    c.chargeWindowUntil = 0;
    c.credit = Math.max(0, c.credit - 1);
    if (c.credit === 0) {
      if (c.isBot) this.insertCoin(c);
      else this.pendingPause.add(c);
    }
    this.host.onCreditChanged();
  }

  /** 每幀：CREDIT 用完的角色進入等待；更新頭上投幣提示 */
  update(): void {
    if (!this.enabled) return;
    for (const c of this.pendingPause) {
      if (c.credit > 0 || c.creditState !== 'playing') continue;
      c.creditState = 'waiting';
      c.leavePlay();
      this.host.onCreditChanged();
    }
    this.pendingPause.clear();
    this.updatePrompts();
  }

  /** 未進場 / 等待中的角色頭上顯示投幣提示（閃動），其餘隱藏 */
  private updatePrompts(): void {
    const cfg = GameConfig.credit;
    const now = this.host.scene.time.now;
    const blinkOn = now % cfg.prompt.blinkMs < cfg.prompt.blinkMs / 2;
    for (const c of this.host.characters()) {
      const show = c.creditState !== 'playing';
      let prompt = this.prompts.get(c);
      if (!show) {
        prompt?.setVisible(false);
        continue;
      }
      if (!prompt) {
        prompt = this.createPrompt();
        this.prompts.set(c, prompt);
      }
      const text = c.creditState === 'absent' ? cfg.joinText : cfg.continueText;
      if (prompt.text !== text) prompt.setText(text);
      prompt.setPosition(c.x, c.y + cfg.prompt.offsetY).setVisible(true).setAlpha(blinkOn ? 1 : 0.45);
    }
  }

  /** 建立一個頭上投幣提示文字 */
  private createPrompt(): Phaser.GameObjects.Text {
    const p = GameConfig.credit.prompt;
    // 粗體中文加描邊時字形上緣會超出量到的行高而被切掉，上下留 padding
    return this.host.scene.add.text(0, 0, '', {
      fontSize: `${p.fontSize}px`, fontStyle: 'bold', color: p.color, stroke: p.stroke, strokeThickness: p.strokeThickness,
      padding: { top: p.paddingY, bottom: p.paddingY }
    }).setOrigin(0.5).setDepth(p.depth);
  }
}
