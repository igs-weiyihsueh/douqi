import { GameConfig } from '../config';

/**
 * 小關卡佇列（卷軸 HUD 右側的寶箱序列）的生成規則：純函式，不依賴場景狀態。
 *
 * - 每個節點是低階 / 高階 / 問號寶箱；問號在玩家進入該關時才揭曉為低階或高階
 * - 保證：任意連續 visibleStages(4) 個節點中至少有 1 個「確定的」高階（問號不算）
 * - 問號不連續出現
 */

/** 寶箱階級 */
export type ChestTier = 'low' | 'high';

/** 節點種類：確定的低階 / 高階，或尚未揭曉的問號 */
export type StageNodeKind = ChestTier | 'mystery';

/** 佇列中的一個小關卡節點 */
export interface StageNode {
  kind: StageNodeKind;
  /** 問號揭曉後的寶箱階級；非問號或尚未揭曉時為 null */
  revealed: ChestTier | null;
}

/** 隨機數來源（0 ≤ r < 1），預設 Math.random；可注入以便測試 */
export type RandomFn = () => number;

/**
 * 產生接在 prev 後面的下一個節點
 *
 * 規則：前 visibleStages-1 個節點都沒有確定高階 → 強制高階；否則依 chestOdds 抽
 * （抽到問號但上一個也是問號時改為低階）
 *
 * @param prev 目前佇列（最後一個是最右邊的節點）
 * @param rand 隨機數來源
 * @returns 新節點
 */
export function nextStageNode(prev: ReadonlyArray<StageNode>, rand: RandomFn = Math.random): StageNode {
  const windowSize = GameConfig.waveHud.visibleStages - 1;
  const window = prev.slice(-windowSize);
  if (window.length === windowSize && !window.some((n) => n.kind === 'high')) {
    return { kind: 'high', revealed: null };
  }
  const odds = GameConfig.stage.chestOdds;
  const r = rand();
  if (r < odds.high) return { kind: 'high', revealed: null };
  const lastIsMystery = prev.length > 0 && prev[prev.length - 1].kind === 'mystery';
  if (r < odds.high + odds.mystery && !lastIsMystery) return { kind: 'mystery', revealed: null };
  return { kind: 'low', revealed: null };
}

/**
 * 建立一條新的佇列（開局用）
 *
 * @param count 節點數
 * @param rand 隨機數來源
 */
export function createStageQueue(count: number, rand: RandomFn = Math.random): StageNode[] {
  const queue: StageNode[] = [];
  for (let i = 0; i < count; i++) queue.push(nextStageNode(queue, rand));
  return queue;
}

/**
 * 揭曉問號節點（已揭曉或非問號時不變）：依 stage.mysteryHighChance 決定高階或低階
 *
 * @param node 要揭曉的節點（就地修改）
 * @param rand 隨機數來源
 * @returns 揭曉後的寶箱階級
 */
export function revealStageNode(node: StageNode, rand: RandomFn = Math.random): ChestTier {
  if (node.kind !== 'mystery') return node.kind;
  if (!node.revealed) node.revealed = rand() < GameConfig.stage.mysteryHighChance ? 'high' : 'low';
  return node.revealed;
}

/**
 * 節點在 HUD 上的顯示：已揭曉的問號顯示揭曉結果，其餘照種類
 *
 * @param node 節點
 */
export function displayKindOf(node: StageNode): StageNodeKind {
  return node.revealed ?? node.kind;
}
