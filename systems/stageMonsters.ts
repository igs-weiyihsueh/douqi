import { GameConfig } from '../config';
import type { ChestTier } from './stageQueue';

/**
 * 關卡怪物配置（config.stageMonsters）的型別與查詢：
 * 小關卡開始時依寶箱階級抽一份配置，出怪依「目前擊殺進度所在的階段」決定怪種比例與補怪節奏。
 * 資料格式即日後關卡編輯器編輯的內容
 */

/** 波次一般怪種類（配置可設定比例的怪） */
export type MonsterKind = 'normal' | 'tank' | 'bomber';

/** 一個階段：擊殺進度到 untilProgress 前套用 */
export interface MonsterPhase {
  /** 0 ~ 1，例如 0.4 = 擊殺數打到 40% 前 */
  untilProgress: number;
  /** 怪種比例（權重） */
  weights: Record<MonsterKind, number>;
  /** 補怪間隔（毫秒） */
  intervalMs: number;
  /** 近身組 / 場上組每批隻數 [最少, 最多] */
  nearBatch: readonly [number, number];
  fieldBatch: readonly [number, number];
  /** 近身組占比（其餘為場上組） */
  nearShare: number;
}

/** 一份關卡怪物配置 */
export interface MonsterProfile {
  id: string;
  /** 顯示名稱（除錯 / 編輯器） */
  name: string;
  /** 擊殺數（低階寶箱；高階再乘 chests.high.quotaMult） */
  quota: number;
  /** 同時在場上限：單人值，每多一位存活玩家再加 perExtraPlayer */
  maxAlive: { solo: number; perExtraPlayer: number };
  phases: ReadonlyArray<MonsterPhase>;
}

/**
 * 依 id 取得配置
 *
 * @param id 配置 id（config.stageMonsters.profiles 的 key）
 */
export function monsterProfile(id: string): MonsterProfile {
  const profiles = GameConfig.stageMonsters.profiles as Record<string, Omit<MonsterProfile, 'id'>>;
  const p = profiles[id];
  if (!p) throw new Error(`未知的關卡怪物配置：${id}`);
  return { id, ...p };
}

/**
 * 依寶箱階級隨機抽一份配置（等機率）
 *
 * @param chest 寶箱階級
 * @param rand 亂數來源（測試可替換）
 */
export function pickMonsterProfile(chest: ChestTier, rand: () => number = Math.random): MonsterProfile {
  const ids = GameConfig.stageMonsters.chests[chest].profiles;
  return monsterProfile(ids[Math.min(ids.length - 1, Math.floor(rand() * ids.length))]);
}

/**
 * 本關擊殺數：配置的 quota × 該寶箱階級的倍率
 *
 * @param profile 配置
 * @param chest 寶箱階級
 */
export function profileQuota(profile: MonsterProfile, chest: ChestTier): number {
  return Math.round(profile.quota * GameConfig.stageMonsters.chests[chest].quotaMult);
}

/**
 * 目前擊殺進度所在的階段（超過最後一段的 untilProgress 時用最後一段）
 *
 * @param profile 配置
 * @param progress 擊殺進度 0 ~ 1
 */
export function phaseAt(profile: MonsterProfile, progress: number): MonsterPhase {
  for (const phase of profile.phases) if (progress < phase.untilProgress) return phase;
  return profile.phases[profile.phases.length - 1];
}

/**
 * 配置在指定存活人數下的同時在場上限（不超過物件池上限 spawn.maxAlive）
 *
 * @param profile 配置
 * @param alive 存活人數
 */
export function profileMaxAlive(profile: MonsterProfile, alive: number): number {
  const cap = profile.maxAlive.solo + Math.max(0, alive - 1) * profile.maxAlive.perExtraPlayer;
  return Math.min(GameConfig.spawn.maxAlive, cap);
}

/**
 * 所有配置中、指定存活人數下最大的同時在場上限（物件池預熱用）
 *
 * @param alive 存活人數
 */
export function largestProfileMaxAlive(alive: number): number {
  return Math.max(...Object.keys(GameConfig.stageMonsters.profiles).map((id) => profileMaxAlive(monsterProfile(id), alive)));
}
