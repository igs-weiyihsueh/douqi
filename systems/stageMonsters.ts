import { GameConfig } from '../config';
import type { ChestTier } from './stageQueue';

/**
 * 關卡怪物配置（config.stageMonsters）的型別與查詢：
 * 小關卡開始時依寶箱階級抽一份配置，一關分數波（waves），出怪依「整關進度所在的階段」決定怪種比例與補怪節奏。
 * 資料格式即日後關卡編輯器編輯的內容
 */

/** 波次一般怪種類（配置可設定比例的怪） */
export type MonsterKind = 'normal' | 'tank' | 'bomber';

/** 一個階段：擊殺進度到 untilProgress 前套用 */
export interface MonsterPhase {
  /** 0 ~ 1，例如 0.4 = 擊殺數打到 40% 前 */
  untilProgress: number;
  /** 怪種比例（權重）：整體出現比例（近身組抽到它不能出的怪種時改出在場上，比例不變） */
  weights: Record<MonsterKind, number>;
  /** 補怪間隔（毫秒） */
  intervalMs: number;
  /** 近身組 / 場上組每批隻數 [最少, 最多] */
  nearBatch: readonly [number, number];
  fieldBatch: readonly [number, number];
  /** 近身組占比（其餘為場上組） */
  nearShare: number;
}

/** 即時補怪的一批：在玩家身旁環狀補 count 隻，不計擊殺數、不受同時在場上限限制 */
export interface SurgeBatch {
  /** 每次補幾隻 [最少, 最多] */
  count: readonly [number, number];
  /** 怪種比例（權重） */
  weights: Record<MonsterKind, number>;
}

/** 二段變身即時補怪 */
export interface MonsterSurge extends SurgeBatch {
  /** 每位玩家各自的冷卻（毫秒） */
  cooldownMs: number;
}

/** 一份關卡怪物配置 */
export interface MonsterProfile {
  id: string;
  /** 顯示名稱（除錯 / 編輯器） */
  name: string;
  /** 各波擊殺數（單人的份量；低階寶箱，高階再乘 chests.high.quotaMult；每波開始時乘上存活人數） */
  waves: readonly number[];
  /** 同時在場上限：單人值，每多一位存活玩家再加 perExtraPlayer */
  maxAlive: { solo: number; perExtraPlayer: number };
  phases: ReadonlyArray<MonsterPhase>;
  surge: MonsterSurge;
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
 * 第 wave 波（0 起算）的擊殺數：配置的單人份量 × 寶箱階級倍率 × 存活人數（至少 1 人）
 *
 * @param profile 配置
 * @param chest 寶箱階級
 * @param wave 第幾波（0 起算，超過最後一波時用最後一波）
 * @param alive 波次開始時的存活人數（BOT 也算）
 */
export function profileWaveQuota(profile: MonsterProfile, chest: ChestTier, wave: number, alive: number): number {
  const base = profile.waves[Math.min(wave, profile.waves.length - 1)];
  return Math.round(base * GameConfig.stageMonsters.chests[chest].quotaMult) * Math.max(1, alive);
}

/**
 * 目前整關進度所在的階段（超過最後一段的 untilProgress 時用最後一段）
 *
 * @param profile 配置
 * @param progress 整關進度 0 ~ 1
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
