import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';

/** 角色的 COMBO 連擊狀態（頭上 UI 顯示用） */
type ComboState = Character['comboState'];

/** UIScene 播放 COMBO 報獎特效的入口 */
interface ComboRewardFxScene {
  playComboRewardFx?: (index: number, tickets: number, milestone: number) => void;
}

/**
 * 連擊中斷時間：1 HIT 時 STREAK_TIMEOUT_MAX_MS，線性遞減到 STREAK_TIMEOUT_MIN_AT_HITS 時的 STREAK_TIMEOUT_MIN_MS（之後維持）
 *
 * @param streak 目前連擊數
 * @returns 多久沒命中就中斷（毫秒）
 */
export function streakTimeoutMs(streak: number): number {
  const cfg = GameConfig.comboReward;
  const t = Phaser.Math.Clamp((streak - 1) / (cfg.STREAK_TIMEOUT_MIN_AT_HITS - 1), 0, 1);
  return cfg.STREAK_TIMEOUT_MAX_MS + (cfg.STREAK_TIMEOUT_MIN_MS - cfg.STREAK_TIMEOUT_MAX_MS) * t;
}

/**
 * COMBO 連擊獎勵：每次出手命中至少一隻敵人連擊 +1（普攻、衝刺、連段技、變身 AOE 各算一下，爆發整招算一下；
 * 打中幾隻都只算一下，擊殺不另外加），連擊達到里程碑時記下待發獎勵，中斷時才發；
 * 達到最高里程碑時立即發獎並歸零。
 *
 * 被敵人打中（實際受傷判定成立）時立即中斷（interrupt）。每幀依距上次命中的時間：超過中斷時間 × WARNING_START_RATIO 進入警告（HIT 圖閃爍淡出）、超過中斷時間就中斷
 * （先發待發的獎勵再歸零）；中斷時間隨連擊數線性遞減（見 streakTimeoutMs）。CREDIT 等待續關期間與波間休息時暫停倒數（連擊停在當下），
 * 續關逾時離場時結算。小關卡通關時立即結算（settleAll）。沒達到任何里程碑但連擊數 ≥ MIN_REWARD_HITS 時發保底報獎。
 * 獎勵張數由回饋 buffer 決定（達到的階越高發得越多，至少 payout.comboMinTickets），
 * 加到該角色的彩票數，並在下方面板播放彩票噴發特效
 */
export class ComboRewardController {
  /** 上一次 update 的場景時間（算每幀經過時間，暫停倒數用） */
  private lastUpdateAt?: number;

  /**
   * @param scene 場景
   * @param characters 全部角色
   * @param isCountdownPaused 全員暫停倒數中（波間休息）
   * @param payReward 發連擊報獎：從角色的連擊 buffer 依達到的里程碑索引發票（null = 保底報獎），回傳發出的張數
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly characters: () => ReadonlyArray<Character>,
    private readonly isCountdownPaused: () => boolean,
    private readonly payReward: (actor: Character, tierIndex: number | null) => number
  ) {}

  /**
   * 一次命中：連擊 +1（同時更新本關最高連擊）、更新最後命中時間並解除警告，再檢查里程碑
   *
   * @param actor 命中的角色
   */
  hit(actor: Character): void {
    const combo = actor.comboState;
    combo.currentStreak++;
    actor.stageStats.maxCombo = Math.max(actor.stageStats.maxCombo, combo.currentStreak);
    combo.lastKillTime = this.scene.time.now; // 欄位沿用舊名，實際記錄最後命中時間
    combo.isWarning = false;
    this.checkMilestone(actor);
  }

  /**
   * 每幀：依距上次命中的時間切換警告狀態，或中斷連擊（先發待發獎勵）；
   * 波間休息時全員、等待續關的角色暫停倒數，逾時離場（回到未進場）的角色結算
   */
  update(): void {
    const now = this.scene.time.now;
    const elapsed = now - (this.lastUpdateAt ?? now);
    this.lastUpdateAt = now;
    const cfg = GameConfig.comboReward;
    const allPaused = this.isCountdownPaused();
    for (const character of this.characters()) {
      const combo = character.comboState;
      if (combo.currentStreak <= 0) continue;
      if (character.creditState === 'absent') {
        this.settle(character);
        continue;
      }
      if (allPaused || character.creditState === 'waiting') {
        // 最後命中時間跟著往後推，距上次命中的時間維持不變 = 倒數暫停；暫停中不警告
        combo.lastKillTime += elapsed;
        combo.isWarning = false;
        continue;
      }
      const sinceLastHit = now - combo.lastKillTime;
      const timeout = streakTimeoutMs(combo.currentStreak);
      if (sinceLastHit >= timeout) {
        this.settle(character);
      } else {
        combo.isWarning = sinceLastHit >= timeout * cfg.WARNING_START_RATIO;
      }
    }
  }

  /**
   * 里程碑檢查：達到最高里程碑立即發獎並歸零（較低階的待發獎勵被取代）；
   * 剛好等於某個里程碑時記下待發獎勵（中斷時才發），並把下個目標更新為下一階
   */
  private checkMilestone(actor: Character): void {
    const combo = actor.comboState;
    const cfg = GameConfig.comboReward;
    const milestones: readonly number[] = cfg.MILESTONES;
    const lastIndex = milestones.length - 1;
    if (combo.currentStreak >= milestones[lastIndex]) {
      this.grant(actor, lastIndex);
      this.reset(combo);
      return;
    }
    const i = milestones.indexOf(combo.currentStreak);
    if (i < 0) return;
    combo.pendingRewardIndex = i;
    combo.nextMilestone = i + 1 < milestones.length ? milestones[i + 1] : milestones[lastIndex];
  }

  /**
   * 發獎：依達到的里程碑從連擊 buffer 發票（加到角色的彩票數），並在下方面板播放彩票噴發（數量 / 速度隨里程碑變化，
   * 保底報獎依目前連擊數）；buffer 還不到 1 張時不發、不播特效
   *
   * @param actor 獲得獎勵的角色
   * @param tierIndex 達成的里程碑索引（null = 沒達到里程碑的保底報獎）
   */
  private grant(actor: Character, tierIndex: number | null): void {
    const tickets = this.payReward(actor, tierIndex);
    if (tickets <= 0) return;
    const milestone = tierIndex === null ? actor.comboState.currentStreak : GameConfig.comboReward.MILESTONES[tierIndex];
    actor.comboState.ticketsEarned += tickets;
    const ui = this.scene.scene.get('UIScene') as unknown as ComboRewardFxScene | null;
    if (ui?.playComboRewardFx) {
      ui.playComboRewardFx(actor.index, tickets, milestone);
    } else {
      console.error('❌ UIScene.playComboRewardFx 不存在，COMBO 獎勵特效無法播放');
    }
  }

  /**
   * 角色被敵人打中：連擊立即中斷（先發待發獎勵再歸零）
   *
   * @param character 被打中的角色
   */
  interrupt(character: Character): void {
    if (character.comboState.currentStreak > 0) this.settle(character);
  }

  /** 小關卡通關：所有角色的連擊立即結算（發待發獎勵再歸零），不等中斷倒數 */
  settleAll(): void {
    for (const character of this.characters()) {
      if (character.comboState.currentStreak > 0) this.settle(character);
    }
  }

  /**
   * 結算一個角色的連擊：有待發獎勵就發，沒達到里程碑但連擊數 ≥ MIN_REWARD_HITS 就發保底報獎，再歸零
   *
   * @param character 角色
   */
  private settle(character: Character): void {
    const combo = character.comboState;
    if (combo.pendingRewardIndex !== undefined) this.grant(character, combo.pendingRewardIndex);
    else if (combo.currentStreak >= GameConfig.comboReward.MIN_REWARD_HITS) this.grant(character, null);
    this.reset(combo);
  }

  /** 連擊歸零：清除警告與待發獎勵，下個目標回到第一個里程碑 */
  private reset(combo: ComboState): void {
    combo.currentStreak = 0;
    combo.isWarning = false;
    combo.nextMilestone = GameConfig.comboReward.MILESTONES[0];
    combo.pendingRewardIndex = undefined;
  }
}
