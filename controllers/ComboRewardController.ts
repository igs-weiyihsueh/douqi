import type Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';

/** 角色的 COMBO 連擊狀態（頭上 UI 顯示用） */
type ComboState = Character['comboState'];

/** UIScene 播放 COMBO 報獎特效的入口 */
interface ComboRewardFxScene {
  playComboRewardFx?: (index: number, tickets: number, milestone: number) => void;
}

/**
 * COMBO 連擊獎勵：每次出手命中至少一隻敵人連擊 +1（普攻、衝刺、連段技、變身 AOE 各算一下，爆發整招算一下；
 * 打中幾隻都只算一下，擊殺不另外加），連擊達到里程碑時記下待發獎勵，中斷時才發；
 * 達到最高里程碑時立即發獎並歸零。
 *
 * 每幀依距上次命中的時間：超過 WARNING_START_MS 進入警告（頭上 UI 閃爍）、超過 STREAK_TIMEOUT_MS 中斷
 * （先發待發的獎勵再歸零）。獎勵的彩票加到該角色的 Credit，並在下方面板播放彩票噴發特效
 */
export class ComboRewardController {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly characters: () => ReadonlyArray<Character>
  ) {}

  /**
   * 一次命中：連擊 +1、更新最後命中時間並解除警告，再檢查里程碑
   *
   * @param actor 命中的角色
   */
  hit(actor: Character): void {
    const combo = actor.comboState;
    combo.currentStreak++;
    combo.lastKillTime = this.scene.time.now; // 欄位沿用舊名，實際記錄最後命中時間
    combo.isWarning = false;
    this.checkMilestone(actor);
  }

  /** 每幀：依距上次命中的時間切換警告狀態，或中斷連擊（先發待發獎勵） */
  update(): void {
    const now = this.scene.time.now;
    const cfg = GameConfig.comboReward;
    for (const character of this.characters()) {
      const combo = character.comboState;
      if (combo.currentStreak <= 0) continue;
      const sinceLastHit = now - combo.lastKillTime;
      if (sinceLastHit >= cfg.STREAK_TIMEOUT_MS) {
        if (combo.pendingRewardTickets !== undefined && combo.pendingRewardTickets > 0) {
          this.grant(character, combo.pendingRewardTickets, combo.pendingRewardMilestone!);
        }
        this.reset(combo);
      } else {
        combo.isWarning = sinceLastHit >= cfg.WARNING_START_MS;
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
      this.grant(actor, cfg.REWARDS[lastIndex], milestones[lastIndex]);
      this.reset(combo);
      return;
    }
    const i = milestones.indexOf(combo.currentStreak);
    if (i < 0) return;
    combo.pendingRewardIndex = i;
    combo.pendingRewardTickets = cfg.REWARDS[i];
    combo.pendingRewardMilestone = milestones[i];
    combo.nextMilestone = i + 1 < milestones.length ? milestones[i + 1] : milestones[lastIndex];
  }

  /**
   * 發獎：彩票加到 Credit，並在下方面板播放彩票噴發（數量 / 速度隨里程碑變化）
   *
   * @param actor 獲得獎勵的角色
   * @param tickets 彩票張數
   * @param milestone 達成的里程碑（連擊數）
   */
  private grant(actor: Character, tickets: number, milestone: number): void {
    actor.comboState.ticketsEarned += tickets;
    actor.credit += tickets;
    const ui = this.scene.scene.get('UIScene') as unknown as ComboRewardFxScene | null;
    if (ui?.playComboRewardFx) {
      ui.playComboRewardFx(actor.index, tickets, milestone);
    } else {
      console.error('❌ UIScene.playComboRewardFx 不存在，COMBO 獎勵特效無法播放');
    }
  }

  /** 連擊歸零：清除警告與待發獎勵，下個目標回到第一個里程碑 */
  private reset(combo: ComboState): void {
    combo.currentStreak = 0;
    combo.isWarning = false;
    combo.nextMilestone = GameConfig.comboReward.MILESTONES[0];
    combo.pendingRewardIndex = undefined;
    combo.pendingRewardTickets = undefined;
    combo.pendingRewardMilestone = undefined;
  }
}
